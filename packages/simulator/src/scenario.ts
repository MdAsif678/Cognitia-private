import { hexToBigInt, keccak256, toHex, type Address, type Hex } from "viem";
import type { AccountInfo, AssetFlow, CallFrameSummary, SimulationHints, StepResult, Timing, TokenInfo } from "@cognitia/shared";
import { BEACON_ABI, EIP1967_BEACON_SLOT, PROXY_IMPLEMENTATION_SLOTS } from "./abi";
import { decodeTokenCall } from "./calldata";
import { diffProbes, ownedKey, type DiffOutput } from "./diff";
import { buildProbes, discover, type ExecutedStep } from "./discovery";
import { decodeTokenLog, type DecodedLog } from "./logs";
import { probeKey, readProbes, type Probe, type ProbeReadings } from "./probes";
import type { ForkRpc, RawReceipt } from "./rpc";
import { detectTokens } from "./tokens";
import { decodeRevertReason, fetchCallTrace, type FlatFrame } from "./trace";
import { addr, errorMessage, isZeroAddress, mapLimit, sameAddress } from "./util";

export type StepSpec = {
  label: string;
  role: StepResult["role"];
  from: Address;
  to?: Address;
  data?: Hex;
  value: bigint;
  gas?: bigint;
};

export type StepExecution = {
  spec: StepSpec;
  outcome: "success" | "revert" | "not-executed";
  revertReason?: string;
  error?: string;
  hash?: Hex;
  gasUsed?: bigint;
  gasLimit?: bigint;
  frames: FlatFrame[];
  logs: DecodedLog[];
  traceError?: string;
  createdAddress?: Address;
  /** Sender's native balance on the fork before the step ran (read only when the step sends value). */
  senderBalanceWei?: bigint;
  /** Wei added to the sender on the fork so the step could execute, because the real balance was short. */
  fundedShortfallWei?: bigint;
};

// Mining on a cold fork fetches every touched slot from the upstream RPC; slow public
// endpoints can take well over 15 s. The analysis-level timeout still bounds the whole run.
async function waitForReceipt(rpc: ForkRpc, hash: Hex, timeoutMs = 60_000): Promise<RawReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc.request<RawReceipt | null>("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no receipt for ${hash} on fork after ${timeoutMs}ms`);
}

/** Executes one unsigned transaction on the fork as `from` (impersonated, zero gas price). */
export async function executeStep(rpc: ForkRpc, spec: StepSpec, gasCap: bigint, timestamp?: bigint): Promise<StepExecution> {
  const tx: Record<string, string> = { from: spec.from, value: toHex(spec.value), gasPrice: "0x0" };
  if (spec.to) tx.to = spec.to;
  if (spec.data && spec.data !== "0x") tx.data = spec.data;

  await rpc.request("anvil_impersonateAccount", [spec.from]).catch(() => undefined);
  await rpc.request("anvil_setNextBlockBaseFeePerGas", ["0x0"]).catch(() => undefined);
  if (timestamp !== undefined) await rpc.request("evm_setNextBlockTimestamp", [toHex(timestamp)]).catch(() => undefined);

  // Gas is free on the fork, so without a dapp-supplied limit we run with the block cap rather
  // than eth_estimateGas (which re-executes many times and is slow on remote forks).
  const gas = spec.gas ?? gasCap;
  tx.gas = toHex(gas);

  let hash: Hex;
  try {
    hash = await rpc.request<Hex>("eth_sendTransaction", [tx]);
  } catch (err) {
    return { spec, outcome: "not-executed", error: errorMessage(err), gasLimit: gas, frames: [], logs: [] };
  }

  const receipt = await waitForReceipt(rpc, hash);
  const success = receipt.status === "0x1";
  const logs = receipt.logs.map(decodeTokenLog).filter((l): l is DecodedLog => !!l);

  let frames: FlatFrame[] = [];
  let traceError: string | undefined;
  let rootOutput: Hex | undefined;
  let rootError: string | undefined;
  try {
    const trace = await fetchCallTrace(rpc, hash);
    frames = trace.frames;
    rootOutput = trace.root?.output as Hex | undefined;
    rootError = trace.root?.error;
  } catch (err) {
    traceError = errorMessage(err);
  }

  return {
    spec,
    outcome: success ? "success" : "revert",
    revertReason: success ? undefined : (decodeRevertReason(rootOutput, rootError) ?? "execution reverted"),
    hash,
    gasUsed: hexToBigInt(receipt.gasUsed),
    gasLimit: gas,
    frames,
    logs,
    traceError,
    createdAddress: receipt.contractAddress ? addr(receipt.contractAddress) : undefined,
  };
}

/**
 * Ensures every sender can afford the value its step sends. Gas is priced at zero on the fork, so a
 * shortfall can only come from `value`, and the node would otherwise refuse the transaction and
 * dead-end the analysis at "not-executed" without telling the user what the request does.
 *
 * This must run BEFORE the diff baseline is captured: funding afterwards would make the sender's
 * balance identical before and after, hiding the very outflow being measured.
 *
 * Returns the shortfall per step index; solvent senders are absent from the map.
 */
async function fundSenders(rpc: ForkRpc, steps: StepSpec[]): Promise<Map<number, { balanceWei: bigint; shortfallWei: bigint }>> {
  const out = new Map<number, { balanceWei: bigint; shortfallWei: bigint }>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.value <= 0n) continue;
    const balance = await rpc
      .request<Hex>("eth_getBalance", [step.from, "latest"])
      .then(hexToBigInt)
      .catch(() => undefined);
    if (balance === undefined || balance >= step.value) continue;
    const funded = await rpc
      .request("anvil_setBalance", [step.from, toHex(step.value)])
      .then(() => true)
      .catch(() => false);
    if (funded) out.set(i, { balanceWei: balance, shortfallWei: step.value - balance });
  }
  return out;
}

export type ScenarioOptions = {
  steps: StepSpec[];
  /** Diff baseline = state after this many steps (0 = the pinned fork block). */
  baselineIndex: number;
  /** Accounts whose position in every discovered token is read. */
  owners: Address[];
  hints?: SimulationHints;
  timing: Timing;
  readConcurrency: number;
  gasCap: bigint;
  enumerateLimit: number;
  /** Token IDs an owner holds in a collection that just received an operator approval. */
  enumerateOwned?: (token: Address, owner: Address, standard: "erc721" | "erc1155") => Promise<{ ids: bigint[]; note?: string }>;
  /** Extra probes the caller needs regardless of discovery. */
  extraProbes?: Probe[];
  /** Timestamp for the block mined by step i (deterministic, so re-runs reuse cached state). */
  blockTimestamp?: (stepIndex: number) => bigint;
  /** Stage timings are written here as `${timingPrefix}.${stage}`. */
  timings?: Record<string, number>;
  timingPrefix?: string;
};

export type ScenarioResult = {
  executions: StepExecution[];
  probes: Probe[];
  before: ProbeReadings;
  after: ProbeReadings;
  diff: DiffOutput;
  flows: AssetFlow[];
  tokens: Map<string, TokenInfo>;
  accounts: AccountInfo[];
  ownedTokenIds: Map<string, bigint[]>;
  unresolvedTokens: string[];
  /** Why holdings of an approved collection could not be enumerated (coverage gaps). */
  enumerationNotes: string[];
  calls: CallFrameSummary[];
  /** Accounts that moved someone else's assets via transferFrom/safeTransferFrom. */
  pullers: Set<string>;
};

type CodeReading = { code?: Hex; implementation?: Address };

const MINIMAL_PROXY = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;

function slotAddress(word: Hex | undefined): Address | undefined {
  if (!word || /^0x0*$/.test(word)) return undefined;
  const a = addr(`0x${word.slice(-40)}`);
  return isZeroAddress(a) ? undefined : a;
}

/** Implementation behind a proxy: EIP-1167 bytecode, known implementation slots, or an EIP-1967 beacon. */
async function proxyImplementation(rpc: ForkRpc, address: Address, code: Hex): Promise<Address | undefined> {
  const minimal = MINIMAL_PROXY.exec(code);
  if (minimal) return addr(`0x${minimal[1]}`);
  const words = await Promise.all(
    [...PROXY_IMPLEMENTATION_SLOTS, EIP1967_BEACON_SLOT].map((slot) => rpc.client.getStorageAt({ address, slot }).catch(() => undefined)),
  );
  const direct = words.slice(0, -1).map(slotAddress).find(Boolean);
  if (direct) return direct;
  const beacon = slotAddress(words[words.length - 1]);
  if (!beacon) return undefined;
  return rpc.client.readContract({ address: beacon, abi: BEACON_ABI, functionName: "implementation" }).catch(() => undefined);
}

async function readCodes(rpc: ForkRpc, addresses: Address[], concurrency: number, withProxy: boolean): Promise<Map<string, CodeReading>> {
  const out = new Map<string, CodeReading>();
  await mapLimit(addresses, concurrency, async (address) => {
    try {
      const code = (await rpc.client.getCode({ address })) ?? "0x";
      const implementation = withProxy && code !== "0x" ? await proxyImplementation(rpc, address, code) : undefined;
      out.set(address.toLowerCase(), { code, implementation });
    } catch {
      out.set(address.toLowerCase(), {});
    }
  });
  return out;
}

function toAccountInfo(address: Address, before: CodeReading | undefined, after: CodeReading | undefined): AccountInfo {
  const code = before?.code && before.code !== "0x" ? before.code : after?.code && after.code !== "0x" ? after.code : undefined;
  const created = (!before?.code || before.code === "0x") && !!after?.code && after.code !== "0x";
  return {
    address,
    isContract: !!code,
    codeHash: code ? keccak256(code) : undefined,
    codeSize: code ? (code.length - 2) / 2 : 0,
    createdDuringSimulation: created || undefined,
    proxyImplementation: after?.implementation ?? before?.implementation,
  };
}

function summarizeCalls(executions: StepExecution[]): CallFrameSummary[] {
  const out: CallFrameSummary[] = [];
  for (const e of executions) {
    for (const f of e.frames) {
      if (out.length >= 200) return out;
      out.push({
        depth: f.depth,
        type: f.type,
        from: f.from,
        to: f.to,
        value: f.value.toString(),
        selector: f.input.length >= 10 ? (f.input.slice(0, 10) as Hex) : undefined,
        input: f.input.length > 2 + 2048 ? (f.input.slice(0, 2 + 2048) as Hex) : f.input,
        error: f.error,
        step: e.spec.label,
      });
    }
  }
  return out;
}

/**
 * Run `steps` in order on the fork, then compare state after the last step with state after the
 * first `baselineIndex` steps. Entities are discovered from calldata, logs and the trace AFTER
 * execution; their baseline values are then read from the reverted (clean) snapshot of the same
 * block, so internal transfers and approvals are compared correctly. The fork is always reverted
 * to its starting snapshot before returning.
 */
export async function runScenario(rpc: ForkRpc, opts: ScenarioOptions): Promise<ScenarioResult> {
  let mark = Date.now();
  const lap = (stage: string) => {
    const now = Date.now();
    if (opts.timings) opts.timings[`${opts.timingPrefix ?? "scenario"}.${stage}`] = now - mark;
    mark = now;
  };
  // `pristine` is what the pooled fork is handed back as. Funding happens between it and `s0`, so
  // the diff baseline (`s0` when baselineIndex is 0) already sees the topped-up balance and the
  // sender's outflow is still measured, while the top-up itself never outlives this run.
  const pristine = await rpc.snapshot();
  let restored = false;
  try {
    const funding = await fundSenders(rpc, opts.steps);
    const s0 = funding.size > 0 ? await rpc.snapshot() : pristine;
    const executions: StepExecution[] = [];
    const run = async (i: number) => {
      const exec = await executeStep(rpc, opts.steps[i]!, opts.gasCap, opts.blockTimestamp?.(i));
      const funded = funding.get(i);
      return funded ? { ...exec, senderBalanceWei: funded.balanceWei, fundedShortfallWei: funded.shortfallWei } : exec;
    };
    for (let i = 0; i < opts.baselineIndex; i++) executions.push(await run(i));
    const baselineSnapshot = opts.baselineIndex > 0 ? await rpc.snapshot() : s0;
    for (let i = opts.baselineIndex; i < opts.steps.length; i++) executions.push(await run(i));
    lap("execute");

    const scoped = executions.slice(opts.baselineIndex);
    const executed: ExecutedStep[] = executions.map((e) => ({
      label: e.spec.label,
      from: e.spec.from,
      to: e.spec.to,
      data: e.spec.data,
      frames: e.frames,
      logs: e.logs,
      createdAddress: e.createdAddress,
    }));
    const discovery = discover(executed, opts.owners, opts.hints, opts.timing);
    const scopedLabels = new Set(scoped.map((e) => e.spec.label));
    const flows = discovery.flows.filter((f) => scopedLabels.has(f.step));

    const client = rpc.client;
    const tokens = await detectTokens(client, discovery.tokenCandidates, opts.readConcurrency);

    // A collection-wide approval puts every token the owner holds at risk: find them, so the
    // probes read them and the follow-up step can try to take them.
    const enumerationNotes: string[] = [];
    if (opts.enumerateOwned) {
      const seen = new Set<string>();
      for (const f of discovery.facts) {
        if (f.t !== "operator") continue;
        const std = tokens.get(f.token.toLowerCase())?.standard;
        if (std !== "erc721" && std !== "erc1155") continue;
        const key = ownedKey(f.token, f.owner);
        if (seen.has(key)) continue;
        seen.add(key);
        const { ids, note } = await opts.enumerateOwned(f.token, f.owner, std);
        if (note) enumerationNotes.push(note);
        for (const tokenId of ids.slice(0, opts.enumerateLimit)) {
          discovery.facts.push(std === "erc721" ? { t: "nft", token: f.token, tokenId } : { t: "erc1155", token: f.token, account: f.owner, tokenId });
        }
      }
    }

    const { probes: probeSet, unresolved } = buildProbes(discovery, tokens);
    for (const p of opts.extraProbes ?? []) probeSet.add(p);
    const probes = probeSet.values();
    lap("detectTokens");

    // --- state after the scenario ---
    const [after, codeAfter] = await Promise.all([
      readProbes(client, probes, opts.readConcurrency),
      readCodes(rpc, discovery.interestingAddresses, opts.readConcurrency, true),
    ]);

    // Verified ERC-721 holdings after the scenario, keyed by collection:owner.
    const ownedTokenIds = new Map<string, bigint[]>();
    for (const q of probes) {
      if (q.type !== "erc721-owner") continue;
      const v = after.get(probeKey(q));
      if (!v?.ok || typeof v.value !== "string") continue;
      const key = ownedKey(q.token, v.value);
      ownedTokenIds.set(key, [...(ownedTokenIds.get(key) ?? []), q.tokenId]);
    }

    lap("readAfter");

    // --- baseline state: same block, clean snapshot ---
    await rpc.revert(baselineSnapshot);
    const [before, codeBefore] = await Promise.all([
      readProbes(client, probes, opts.readConcurrency),
      readCodes(rpc, discovery.interestingAddresses, opts.readConcurrency, false),
    ]);
    if (baselineSnapshot !== s0) await rpc.revert(s0);
    if (s0 !== pristine) await rpc.revert(pristine);
    restored = true;
    lap("readBefore");

    const pullers = new Set<string>();
    for (const e of scoped) {
      for (const f of e.frames) {
        if (f.reverted || f.type !== "CALL") continue;
        const h = decodeTokenCall(f.to, f.input, f.from);
        if (h && (h.kind === "transferFrom" || h.kind === "erc721-safeTransferFrom" || h.kind === "erc1155-transfer") && !sameAddress(h.caller, h.from)) {
          pullers.add(h.caller.toLowerCase());
        }
      }
    }

    return {
      executions,
      probes,
      before,
      after,
      diff: diffProbes(probes, before, after, opts.timing),
      flows,
      tokens,
      accounts: discovery.interestingAddresses.map((a) =>
        toAccountInfo(a, codeBefore.get(a.toLowerCase()), codeAfter.get(a.toLowerCase())),
      ),
      ownedTokenIds,
      unresolvedTokens: unresolved,
      enumerationNotes,
      calls: summarizeCalls(scoped),
      pullers,
    };
  } finally {
    if (!restored) await rpc.revert(pristine).catch(() => undefined);
  }
}
