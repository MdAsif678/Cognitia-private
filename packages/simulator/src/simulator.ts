import { createPublicClient, fallback, hexToBigInt, http, type Address, type Hex, type PublicClient } from "viem";
import type {
  ConditionalAuthorization,
  ConditionalScenario,
  Exposure,
  ForkInfo,
  GasInfo,
  SimulationHints,
  SimulationResult,
  StepResult,
  TokenInfo,
  TxRequest,
} from "@cognitia/shared";
import { ERC20_READ_ABI } from "./abi";
import { resolveAnvilPath, type ForkBlock } from "./anvil";
import { authorizationSetupStep, buildFollowUpSteps, checkPermit } from "./conditional";
import { computeExposures } from "./diff";
import { SimulationError } from "./errors";
import { ForkPool } from "./pool";
import { prefetchSystemState, prefetchTransactionState, stepTimestamp } from "./prefetch";
import { describeProbe, probeKey } from "./probes";
import { ForkRpc } from "./rpc";
import { runScenario, type ScenarioResult, type StepExecution, type StepSpec } from "./scenario";
import { enumerateOwnedTokenIds, holdingsFromLogs } from "./tokens";
import { isUpstreamFailure, UpstreamRotation, upstreamLabel, upstreamsOf } from "./upstreams";
import { addr, errorMessage, isUnlimitedAmount, minBigInt, short } from "./util";

export type ChainConfig = {
  chainId: number;
  name: string;
  /** Upstream RPC the fork reads state from. Never used to send transactions. */
  rpcUrl: string;
  /**
   * Further upstreams for the same chain, tried in order when `rpcUrl` is rate-limited or down.
   * Keyless public endpoints make this the difference between a slow demo and a failed one.
   */
  fallbackRpcUrls?: string[];
  /** Fork this many blocks behind the head, so the block is settled and state is served. */
  blockLag?: number;
  /** Seconds between blocks; simulated blocks are timestamped fork block + n × blockTime. */
  blockTimeSec?: number;
};

export type SimulatorOptions = {
  chains: ChainConfig[];
  anvilPath?: string;
  maxConcurrentForks?: number;
  maxQueuedForks?: number;
  forkStartupTimeoutMs?: number;
  /** How long a failing upstream is skipped before it is tried again. */
  upstreamCooldownMs?: number;
  readConcurrency?: number;
  /** After a request grants authority, also simulate the spender using it (conditional). */
  simulateFollowUps?: boolean;
  maxFollowUpSteps?: number;
  anvilExtraArgs?: string[];
  /** Idle pre-started forks kept per chain, so requests skip fork start-up (0 = off). */
  warmForksPerChain?: number;
  /** Warm forks older than this are recycled (their pinned block would be stale). */
  warmForkMaxAgeMs?: number;
  /** How far back to scan transfer logs to find an owner's NFTs / ERC-1155 IDs (0 = off). */
  ownershipScanBlocks?: number;
};

export type SimulateTransactionInput = {
  chainId: number;
  tx: TxRequest;
  /** Pin a specific block (e.g. to replay a historical transaction). Default: head − blockLag. */
  blockNumber?: bigint;
  hints?: SimulationHints;
  signal?: AbortSignal;
};

export type SimulateConditionalInput = {
  chainId: number;
  authorization: ConditionalAuthorization;
  blockNumber?: bigint;
  hints?: SimulationHints;
  signal?: AbortSignal;
};

type PinnedBlock = { number: bigint; hash: Hex; timestamp: bigint; baseFeePerGas?: bigint; gasLimit: bigint };

type ForkContext = {
  chain: ChainConfig;
  rpc: ForkRpc;
  block: PinnedBlock;
  /** Resolves to true once the pinned block hash is confirmed against the upstream RPC. */
  verification: Promise<boolean>;
  priorityFee: Promise<bigint | undefined>;
  timings: Record<string, number>;
  blockTimestamp: (stepIndex: number) => bigint;
};

type RawBlock = { number: Hex; hash: Hex; timestamp: Hex; baseFeePerGas?: Hex; gasLimit: Hex };

const MAX_GAS = 50_000_000n;

export class Simulator {
  private readonly chains = new Map<number, ChainConfig>();
  private readonly rotations = new Map<number, UpstreamRotation>();
  private readonly upstream = new Map<number, PublicClient>();
  private readonly pool: ForkPool;
  private readonly readConcurrency: number;
  private readonly simulateFollowUps: boolean;
  private readonly maxFollowUpSteps: number;
  private readonly ownershipScanBlocks: bigint;

  constructor(opts: SimulatorOptions) {
    this.ownershipScanBlocks = BigInt(opts.ownershipScanBlocks ?? 100_000);
    for (const c of opts.chains) {
      this.chains.set(c.chainId, c);
      this.rotations.set(c.chainId, new UpstreamRotation(upstreamsOf(c), opts.upstreamCooldownMs));
    }
    this.pool = new ForkPool({
      anvilPath: resolveAnvilPath(opts.anvilPath),
      maxConcurrent: opts.maxConcurrentForks ?? 4,
      maxQueue: opts.maxQueuedForks ?? 16,
      startupTimeoutMs: opts.forkStartupTimeoutMs ?? 30_000,
      extraArgs: opts.anvilExtraArgs,
      warmPerUpstream: opts.warmForksPerChain ?? 0,
      warmMaxAgeMs: opts.warmForkMaxAgeMs ?? 30_000,
      prepareWarm: async (instance) => {
        const rpc = new ForkRpc(instance.rpcUrl);
        const [id, raw] = await Promise.all([rpc.client.getChainId(), rpc.request<RawBlock>("eth_getBlockByNumber", ["latest", false])]);
        const chain = this.chains.get(id);
        await this.prefetchSystem(rpc, hexToBigInt(raw.number), hexToBigInt(raw.timestamp), chain);
      },
    });
    this.readConcurrency = opts.readConcurrency ?? 12;
    this.simulateFollowUps = opts.simulateFollowUps ?? true;
    this.maxFollowUpSteps = opts.maxFollowUpSteps ?? 6;
  }

  get supportedChains(): ChainConfig[] {
    return [...this.chains.values()];
  }

  get poolStats() {
    return this.pool.stats;
  }

  /** Start warm forks for every configured chain (no-op unless warmForksPerChain > 0). */
  prewarm() {
    for (const chain of this.chains.values()) {
      this.pool.keepWarm({ forkUrl: this.rotation(chain.chainId).current(), forkBlock: { behindHead: chain.blockLag ?? 2 } });
    }
  }

  async close() {
    await this.pool.close();
  }

  private blockTime(chain: ChainConfig | undefined) {
    return BigInt(chain?.blockTimeSec ?? 12);
  }

  /** Warm the per-block system-contract slots for every block a scenario may mine. */
  private prefetchSystem(rpc: ForkRpc, forkBlock: bigint, forkTimestamp: bigint, chain: ChainConfig | undefined) {
    const bt = this.blockTime(chain);
    return prefetchSystemState(rpc, forkBlock + 1n, forkTimestamp + bt, this.maxFollowUpSteps + 2, bt);
  }

  /**
   * Token IDs `owner` holds in `token`: ERC721Enumerable when available, otherwise transfer logs
   * from the upstream RPC over the last `ownershipScanBlocks` blocks. Candidates only — probes
   * verify ownership afterwards.
   */
  private async enumerateOwned(
    chain: ChainConfig,
    rpc: ForkRpc,
    pinnedBlock: bigint,
    token: Address,
    owner: Address,
    standard: "erc721" | "erc1155",
  ): Promise<{ ids: bigint[]; note?: string }> {
    const limit = 20;
    if (standard === "erc721") {
      const ids = await enumerateOwnedTokenIds(rpc.client, token, owner, limit).catch(() => undefined);
      if (ids?.length) return { ids };
    }
    if (this.ownershipScanBlocks === 0n) return { ids: [], note: `holdings of ${short(token)} were not enumerated (log scan disabled)` };
    const fromBlock = pinnedBlock > this.ownershipScanBlocks ? pinnedBlock - this.ownershipScanBlocks : 0n;
    try {
      const ids = await holdingsFromLogs(this.upstreamClient(chain), token, owner, standard, fromBlock, pinnedBlock, limit);
      return ids.length
        ? { ids }
        : { ids, note: `no ${standard.toUpperCase()} transfers to ${short(owner)} found in ${short(token)} over the last ${pinnedBlock - fromBlock} blocks; holdings may be older` };
    } catch (err) {
      return { ids: [], note: `could not scan ${short(token)} transfer logs for ${short(owner)}'s holdings: ${errorMessage(err)}` };
    }
  }

  private chain(chainId: number): ChainConfig {
    const chain = this.chains.get(chainId);
    if (!chain) throw new SimulationError("UNSUPPORTED_CHAIN", `chain ${chainId} is not configured for simulation`);
    return chain;
  }

  private rotation(chainId: number): UpstreamRotation {
    const rotation = this.rotations.get(chainId);
    if (!rotation) throw new SimulationError("UNSUPPORTED_CHAIN", `chain ${chainId} is not configured for simulation`);
    return rotation;
  }

  /**
   * Direct reads (block verification, priority fee, log scans) go through viem's fallback
   * transport, so these rotate per request rather than per fork.
   */
  private upstreamClient(chain: ChainConfig): PublicClient {
    let client = this.upstream.get(chain.chainId);
    if (!client) {
      const transports = this.rotation(chain.chainId).endpoints.map((url) => http(url, { timeout: 15_000, retryCount: 2 }));
      client = createPublicClient({ transport: transports.length > 1 ? fallback(transports) : transports[0]! });
      this.upstream.set(chain.chainId, client);
    }
    return client;
  }

  /**
   * Checks that at least one configured upstream is reachable and serves this chain, trying them
   * in rotation order and parking the ones that fail. Only the host is reported, never the full
   * URL, which may carry an API key.
   */
  async checkUpstream(chainId: number): Promise<{ ok: boolean; head?: string; endpoint?: string; endpoints: number; error?: string }> {
    const rotation = this.rotation(chainId);
    const endpoints = rotation.endpoints.length;
    const failures: string[] = [];
    for (const url of rotation.order()) {
      try {
        const client = createPublicClient({ transport: http(url, { timeout: 10_000, retryCount: 0 }) });
        const [id, head] = await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]);
        if (id !== chainId) throw new Error(`serves chain ${id}`);
        rotation.clear(url);
        return { ok: true, head: head.toString(), endpoint: upstreamLabel(url), endpoints };
      } catch (err) {
        rotation.park(url);
        failures.push(`${upstreamLabel(url)}: ${errorMessage(err)}`);
      }
    }
    return { ok: false, endpoints, error: failures.join("; ") };
  }

  /**
   * Lease a private fork pinned to one upstream block. Anvil resolves "head − lag" itself; the
   * pinned block is read back from the fork and its hash verified against upstream in parallel.
   */
  private async withPinnedFork<T>(
    chainId: number,
    blockNumber: bigint | undefined,
    signal: AbortSignal | undefined,
    fn: (ctx: ForkContext) => Promise<T>,
  ): Promise<T> {
    const chain = this.chain(chainId);
    const rotation = this.rotation(chainId);
    const relative: ForkBlock = { behindHead: chain.blockLag ?? 2 };
    const forkBlock: ForkBlock = blockNumber !== undefined ? { number: blockNumber } : relative;
    const attempts = rotation.order();
    const failures: string[] = [];

    for (const [index, endpoint] of attempts.entries()) {
      // Only fork acquisition rotates. Once the analysis is running its reads are bound to this
      // fork, so restarting it on another upstream would blow the request budget instead.
      let handedOff = false;
      this.pool.keepWarm({ forkUrl: endpoint, forkBlock: relative });
      const requested = Date.now();
      try {
        return await this.pool.withFork(
          { forkUrl: endpoint, forkBlock },
          async (instance) => {
            const timings: Record<string, number> = { forkStart: Date.now() - requested };
            const rpc = new ForkRpc(instance.rpcUrl);
            const [forkChainId, raw] = await Promise.all([
              rpc.client.getChainId(),
              rpc.request<RawBlock>("eth_getBlockByNumber", ["latest", false]),
            ]);
            if (forkChainId !== chain.chainId) {
              throw new SimulationError("CHAIN_MISMATCH", `upstream for ${chain.name} serves chain ${forkChainId}, expected ${chain.chainId}`);
            }
            const block: PinnedBlock = {
              number: hexToBigInt(raw.number),
              hash: raw.hash,
              timestamp: hexToBigInt(raw.timestamp),
              baseFeePerGas: raw.baseFeePerGas ? hexToBigInt(raw.baseFeePerGas) : undefined,
              gasLimit: hexToBigInt(raw.gasLimit),
            };
            const verification = this.upstreamClient(chain)
              .getBlock({ blockNumber: block.number })
              .then((b) => b.hash?.toLowerCase() === block.hash.toLowerCase())
              .catch(() => false);
            const priorityFee = this.upstreamClient(chain)
              .estimateMaxPriorityFeePerGas()
              .catch(() => undefined);
            timings.pinBlock = Date.now() - requested - timings.forkStart!;
            const bt = this.blockTime(chain);
            rotation.clear(endpoint);
            handedOff = true;
            return fn({
              chain,
              rpc,
              block,
              verification,
              priorityFee,
              timings,
              blockTimestamp: (i) => stepTimestamp(block.timestamp, i, bt),
            });
          },
          signal,
        );
      } catch (err) {
        if (handedOff || !isUpstreamFailure(err)) throw err;
        rotation.park(endpoint);
        this.pool.dropWarm({ forkUrl: endpoint, forkBlock: relative });
        failures.push(`${upstreamLabel(endpoint)}: ${errorMessage(err)}`);
        if (index === attempts.length - 1) {
          if (failures.length === 1) throw err;
          throw new SimulationError("UPSTREAM_UNAVAILABLE", `every upstream for ${chain.name} failed — ${failures.join("; ")}`);
        }
      }
    }
    throw new SimulationError("UPSTREAM_UNAVAILABLE", `no upstream is configured for ${chain.name}`);
  }

  private async forkInfo(ctx: ForkContext): Promise<ForkInfo> {
    return {
      chainId: ctx.chain.chainId,
      blockNumber: ctx.block.number.toString(),
      blockHash: ctx.block.hash,
      blockTimestamp: ctx.block.timestamp.toString(),
      verified: await ctx.verification,
    };
  }

  /** Simulate an unsigned transaction on a private fork of live state. Nothing is broadcast. */
  async simulateTransaction(input: SimulateTransactionInput): Promise<SimulationResult> {
    const started = Date.now();
    const tx = input.tx;
    const from = addr(tx.from);

    return this.withPinnedFork(input.chainId, input.blockNumber, input.signal, async (ctx) => {
      const { chain, rpc, block, timings } = ctx;
      const gasCap = minBigInt(block.gasLimit, MAX_GAS);
      const request: StepSpec = {
        label: "request",
        role: "request",
        from,
        to: tx.to ? addr(tx.to) : undefined,
        data: tx.data as Hex | undefined,
        value: BigInt(tx.value ?? "0"),
        gas: tx.gas !== undefined ? BigInt(tx.gas) : undefined,
      };

      const prefetchStarted = Date.now();
      await Promise.all([
        this.prefetchSystem(rpc, block.number, block.timestamp, chain),
        prefetchTransactionState(rpc, this.upstreamClient(chain), block.number, request),
      ]);
      timings.prefetch = Date.now() - prefetchStarted;

      const main = await runScenario(rpc, {
        steps: [request],
        baselineIndex: 0,
        owners: [from],
        hints: input.hints,
        timing: "immediate",
        readConcurrency: this.readConcurrency,
        gasCap,
        enumerateLimit: 10, enumerateOwned: (t, o, s) => this.enumerateOwned(chain, rpc, block.number, t, o, s),
        blockTimestamp: ctx.blockTimestamp,
        timings,
        timingPrefix: "request",
      });
      const exec = main.executions[0]!;
      const exposures = computeExposures(main.diff.changes, {
        after: main.after,
        probes: main.probes,
        tokens: main.tokens,
        ownedTokenIds: main.ownedTokenIds,
        pullers: main.pullers,
        basis: "granted",
      });

      let conditional: ConditionalScenario | undefined;
      let followUp: ScenarioResult | undefined;
      const followUpNotes: string[] = [];
      if (this.simulateFollowUps && exec.outcome === "success") {
        const drains = buildFollowUpSteps(exposures, main.accounts, this.maxFollowUpSteps);
        if (drains.length) {
          try {
            await Promise.all(drains.map((d) => prefetchTransactionState(rpc, this.upstreamClient(chain), block.number, d)));
            followUp = await runScenario(rpc, {
              steps: [request, ...drains],
              baselineIndex: 1,
              owners: [from],
              hints: input.hints,
              timing: "conditional",
              readConcurrency: this.readConcurrency,
              gasCap,
              enumerateLimit: 10, enumerateOwned: (t, o, s) => this.enumerateOwned(chain, rpc, block.number, t, o, s),
              blockTimestamp: ctx.blockTimestamp,
              timings,
              timingPrefix: "followUp",
            });
            conditional = {
              description: "Conditional outcome if the approved spender uses the authority granted by this request",
              steps: followUp.executions.slice(1).map(stepResult),
              changes: followUp.diff.changes,
              assetFlows: followUp.flows,
              assumptions: [
                "Nothing in this section happens when you sign; it shows what the approved address could do afterwards.",
                "Modeled by impersonating the spender on the same fork right after your request.",
              ],
            };
          } catch (err) {
            followUpNotes.push(`follow-up simulation failed: ${errorMessage(err)}`);
          }
        }
      }

      const fork = await this.forkInfo(ctx);
      const tokens = mergeTokens(main, followUp);
      const coverage = buildCoverage(chain, fork, [main, followUp], tokens, exposures);
      coverage.missing.push(...followUpNotes);

      const senderAfter = main.after.get(probeKey({ type: "native-balance", account: from }));
      const gas = gasInfo(exec, tx, block, await ctx.priorityFee, senderAfter?.ok ? (senderAfter.value as bigint) : undefined);

      const assumptions = [
        `Executed on a private Anvil fork of ${chain.name} pinned to block #${block.number} (${block.hash}); nothing was broadcast.`,
        "The sender was impersonated on the fork, so no signature was needed to execute the unsigned transaction.",
        "Gas is priced at zero on the fork: native balance changes exclude the network fee, which is estimated separately.",
        "Transactions that land before this one on the real chain could change the outcome.",
        "Only assets referenced by the calldata, logs or execution trace were compared; the wallet's other holdings were not enumerated.",
      ];
      if (tx.nonce !== undefined) assumptions.push(`The supplied nonce (${tx.nonce}) was not enforced; the account's next nonce on the fork was used.`);
      if (exec.fundedShortfallWei !== undefined) {
        assumptions.push(
          `The sender holds ${exec.senderBalanceWei ?? 0n} wei but this request sends ${exec.spec.value} wei, so the fork balance was topped up by ${exec.fundedShortfallWei} wei to measure the effects. On the real chain the request would fail for insufficient funds.`,
        );
      }

      return {
        mode: "transaction",
        fork,
        outcome: exec.outcome,
        revertReason: exec.revertReason,
        error: exec.error,
        gas,
        steps: [stepResult(exec)],
        immediateChanges: main.diff.changes,
        conditional,
        assetFlows: main.flows,
        exposures,
        calls: main.calls,
        accounts: main.accounts,
        tokens: [...tokens.values()],
        assumptions,
        coverage,
        durationMs: Date.now() - started,
        timingsMs: timings,
      } satisfies SimulationResult;
    });
  }

  /**
   * Model what a signature would allow once signed and submitted by someone else. The unsigned
   * signature itself is never "executed": its authority is granted by impersonating the owner,
   * then the spender's follow-up transfer is simulated. Everything is labelled conditional.
   */
  async simulateConditional(input: SimulateConditionalInput): Promise<SimulationResult> {
    const started = Date.now();
    const auth = input.authorization;
    const owner = addr(auth.owner);
    const spender = addr(auth.kind === "erc20-allowance" ? auth.spender : auth.operator);

    return this.withPinnedFork(input.chainId, input.blockNumber, input.signal, async (ctx) => {
      const { chain, rpc, block, timings } = ctx;
      const gasCap = minBigInt(block.gasLimit, MAX_GAS);

      const signatureChecks =
        auth.kind === "erc20-allowance" ? await checkPermit(rpc.client, auth, chain.chainId, block.timestamp) : undefined;

      // Size the follow-up from the owner's balance at the pinned block.
      const steps: StepSpec[] = [authorizationSetupStep(auth)];
      let ownerBalance: bigint | undefined;
      if (auth.kind === "erc20-allowance") {
        ownerBalance = await rpc.client
          .readContract({ address: auth.token, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [owner] })
          .catch(() => undefined);
        const amount = minBigInt(BigInt(auth.amount), ownerBalance ?? 0n);
        if (amount > 0n) {
          const drain: Exposure = {
            kind: "erc20-allowance",
            basis: "granted",
            token: auth.token,
            standard: "erc20",
            owner,
            spender,
            amount: auth.amount,
            unlimited: false,
            atRisk: { erc20Balance: amount.toString() },
            scope: "",
          };
          steps.push(...buildFollowUpSteps([drain], [], 1));
        }
      }

      await Promise.all([
        this.prefetchSystem(rpc, block.number, block.timestamp, chain),
        ...steps.map((s) => prefetchTransactionState(rpc, this.upstreamClient(chain), block.number, s)),
      ]);
      const scen = await runScenario(rpc, {
        steps,
        baselineIndex: 0,
        owners: [owner],
        hints: input.hints,
        timing: "conditional",
        readConcurrency: this.readConcurrency,
        gasCap,
        enumerateLimit: 10, enumerateOwned: (t, o, s) => this.enumerateOwned(chain, rpc, block.number, t, o, s),
        blockTimestamp: ctx.blockTimestamp,
        timings,
        timingPrefix: "conditional",
      });

      const setup = scen.executions[0]!;
      const last = scen.executions[scen.executions.length - 1]!;
      const tokenInfo = scen.tokens.get(auth.token.toLowerCase());
      const exposures: Exposure[] = [];
      if (auth.kind === "erc20-allowance") {
        const amount = BigInt(auth.amount);
        const supply = tokenInfo?.totalSupply ? BigInt(tokenInfo.totalSupply) : undefined;
        exposures.push({
          kind: "erc20-allowance",
          basis: "conditional-signature",
          token: addr(auth.token),
          standard: "erc20",
          owner,
          spender,
          amount: auth.amount,
          unlimited: isUnlimitedAmount(amount),
          exceedsTotalSupply: supply !== undefined && supply > 0n ? amount >= supply : undefined,
          atRisk: { erc20Balance: ownerBalance?.toString() },
          scope: isUnlimitedAmount(amount)
            ? "Unlimited amount of this token once the signature is submitted"
            : "Up to the signed amount of this token once the signature is submitted",
        });
      } else {
        exposures.push(
          ...computeExposures(scen.diff.changes, {
            after: scen.after,
            probes: scen.probes,
            tokens: scen.tokens,
            ownedTokenIds: scen.ownedTokenIds,
            pullers: scen.pullers,
            basis: "conditional-signature",
          }),
        );
      }

      const assumptions = [
        "Conditional outcome if this signature is signed and accepted — signing alone moves nothing on-chain.",
        `The unsigned signature was NOT executed. Its authority was modeled by impersonating the owner and calling ${auth.kind === "erc20-allowance" ? "approve(spender, amount)" : "setApprovalForAll(operator, true)"} on a private fork of ${chain.name} at block #${block.number}.`,
        steps.length > 1
          ? "The spender was then impersonated and immediately transferred the maximum it could (min(allowance, balance))."
          : "No follow-up transfer was simulated because the owner holds none of this token at the pinned block.",
        "Only the permit's token was inspected; the wallet's other holdings were not enumerated.",
      ];

      const fork = await this.forkInfo(ctx);
      const coverage = buildCoverage(chain, fork, [scen], scen.tokens, exposures);
      return {
        mode: "conditional-signature",
        fork,
        outcome: setup.outcome !== "success" ? setup.outcome : last.outcome,
        revertReason: setup.revertReason ?? last.revertReason,
        error: setup.error ?? last.error,
        steps: [],
        immediateChanges: [],
        conditional: {
          description: "Conditional outcome if this signature is signed and accepted",
          steps: scen.executions.map(stepResult),
          changes: scen.diff.changes,
          assetFlows: scen.flows,
          assumptions,
        },
        assetFlows: [],
        exposures,
        calls: scen.calls,
        accounts: scen.accounts,
        tokens: [...scen.tokens.values()],
        signatureChecks,
        assumptions,
        coverage,
        durationMs: Date.now() - started,
        timingsMs: timings,
      } satisfies SimulationResult;
    });
  }
}

function stepResult(e: StepExecution): StepResult {
  return {
    label: e.spec.label,
    role: e.spec.role,
    from: e.spec.from,
    to: e.spec.to,
    selector: e.spec.data && e.spec.data.length >= 10 ? (e.spec.data.slice(0, 10) as Hex) : undefined,
    outcome: e.outcome,
    revertReason: e.revertReason ?? e.error,
    gasUsed: e.gasUsed?.toString(),
    forkTxHash: e.hash,
  };
}

function mergeTokens(...scenarios: (ScenarioResult | undefined)[]): Map<string, TokenInfo> {
  const out = new Map<string, TokenInfo>();
  for (const s of scenarios) for (const [k, v] of s?.tokens ?? []) if (!out.has(k) || out.get(k)!.standard === "unknown") out.set(k, v);
  return out;
}

function gasInfo(exec: StepExecution, tx: TxRequest, block: PinnedBlock, priorityFee: bigint | undefined, senderAfter: bigint | undefined): GasInfo | undefined {
  if (exec.gasUsed === undefined) return undefined;
  let price: bigint | undefined;
  if (tx.gasPrice !== undefined) price = BigInt(tx.gasPrice);
  else if (block.baseFeePerGas !== undefined) {
    const tip = tx.maxPriorityFeePerGas !== undefined ? BigInt(tx.maxPriorityFeePerGas) : (priorityFee ?? 0n);
    price = block.baseFeePerGas + tip;
    if (tx.maxFeePerGas !== undefined) price = minBigInt(price, BigInt(tx.maxFeePerGas));
  }
  const fee = price !== undefined ? exec.gasUsed * price : undefined;
  return {
    used: exec.gasUsed.toString(),
    limit: tx.gas,
    effectiveGasPrice: price?.toString(),
    estimatedFeeWei: fee?.toString(),
    balanceCoversFee: fee !== undefined && senderAfter !== undefined ? senderAfter >= fee : undefined,
    senderBalanceWei: exec.senderBalanceWei?.toString(),
    fundedShortfallWei: exec.fundedShortfallWei?.toString(),
  };
}

function buildCoverage(
  chain: ChainConfig,
  fork: ForkInfo,
  scenarios: (ScenarioResult | undefined)[],
  tokens: Map<string, TokenInfo>,
  exposures: Exposure[],
): { checked: string[]; missing: string[]; complete: boolean } {
  const label = (t: Address) => {
    const info = tokens.get(t.toLowerCase());
    return info?.symbol ? `${info.symbol} (${short(t)})` : short(t);
  };
  const checked = [
    `${chain.name} state at block #${fork.blockNumber} ${fork.verified ? "(fork block hash verified against upstream)" : "(fork block hash NOT verified)"}`,
  ];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const s of scenarios) {
    if (!s) continue;
    for (const e of s.executions) {
      if (e.traceError) missing.push(`execution trace for "${e.spec.label}" unavailable: ${e.traceError}`);
      else if (e.hash && !seen.has(`trace:${e.spec.label}`)) {
        seen.add(`trace:${e.spec.label}`);
        checked.push(`execution trace for "${e.spec.label}" (${e.frames.length} call frames)`);
      }
    }
    const failedKeys = new Set(s.diff.failed.map((f) => probeKey(f.probe)));
    for (const f of s.diff.failed) {
      const k = `miss:${probeKey(f.probe)}`;
      if (!seen.has(k)) {
        seen.add(k);
        missing.push(`${describeProbe(f.probe, label)}: ${f.error}`);
      }
    }
    for (const p of s.probes) {
      const k = `chk:${probeKey(p)}`;
      if (failedKeys.has(probeKey(p)) || seen.has(k)) continue;
      seen.add(k);
      checked.push(describeProbe(p, label));
    }
    for (const t of s.unresolvedTokens) {
      const k = `unres:${t.toLowerCase()}`;
      if (!seen.has(k)) {
        seen.add(k);
        missing.push(`could not identify the token standard of ${t}; its balances were not compared`);
      }
    }
    for (const note of s.enumerationNotes) {
      if (!seen.has(`enum:${note}`)) {
        seen.add(`enum:${note}`);
        missing.push(note);
      }
    }
  }

  for (const e of exposures) {
    if (e.kind === "operator-approval" && !e.atRisk.tokenIds?.length && !e.atRisk.erc1155Balances?.length) {
      missing.push(
        `token IDs held in ${label(e.token)} could not be enumerated${e.atRisk.nftCount ? ` (owner holds ${e.atRisk.nftCount})` : ""}; the follow-up transfer was not simulated`,
      );
    }
  }
  return { checked, missing, complete: missing.length === 0 };
}
