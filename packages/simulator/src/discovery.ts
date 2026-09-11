import type { Address } from "viem";
import type { AssetFlow, SimulationHints, Timing, TokenInfo } from "@cognitia/shared";
import { decodeTokenCall, type CallHint } from "./calldata";
import type { DecodedLog } from "./logs";
import { ProbeSet } from "./probes";
import type { StandardHint } from "./tokens";
import type { FlatFrame } from "./trace";
import { addr, isZeroAddress, sameAddress, ZERO_ADDRESS } from "./util";

/** Relationship worth reading; turned into concrete probes once token standards are known. */
type Fact =
  | { t: "holder"; token: Address; account: Address }
  | { t: "approve"; token: Address; owner: Address; spender: Address; amountOrId: bigint }
  | { t: "allowance"; token: Address; owner: Address; spender: Address }
  | { t: "pull"; token: Address; caller: Address; from: Address; amountOrId: bigint }
  | { t: "nft"; token: Address; tokenId: bigint }
  | { t: "operator"; token: Address; owner: Address; operator: Address }
  | { t: "erc1155"; token: Address; account: Address; tokenId: bigint };

export type ExecutedStep = {
  label: string;
  from: Address;
  to?: Address;
  data?: `0x${string}`;
  frames: FlatFrame[];
  logs: DecodedLog[];
  /** Contract deployed by this step, if any. */
  createdAddress?: Address;
};

export type Discovery = {
  tokenCandidates: Map<Address, StandardHint | undefined>;
  facts: Fact[];
  nativeAccounts: Set<Address>;
  /** Addresses whose code we record (for bytecode matching and proxy detection). */
  interestingAddresses: Address[];
  flows: AssetFlow[];
};

const NON_CONTEXT_CALLS = new Set(["DELEGATECALL", "CALLCODE", "STATICCALL"]);

export function discover(
  steps: ExecutedStep[],
  owners: Address[],
  hints: SimulationHints | undefined,
  timing: Timing,
): Discovery {
  const tokenCandidates = new Map<Address, StandardHint | undefined>();
  const facts: Fact[] = [];
  const native = new Set<Address>();
  const priority = new Set<Address>();
  const other = new Set<Address>();
  const flows: AssetFlow[] = [];

  const token = (a: Address, hint?: StandardHint) => {
    const key = addr(a);
    if (!tokenCandidates.has(key) || (hint && !tokenCandidates.get(key))) tokenCandidates.set(key, hint);
  };
  const note = (a: Address | undefined, important = false) => {
    if (!a || isZeroAddress(a)) return;
    (important ? priority : other).add(addr(a));
  };

  const fromCall = (h: CallHint) => {
    switch (h.kind) {
      case "approve":
        token(h.token);
        facts.push({ t: "approve", token: h.token, owner: h.owner, spender: h.spender, amountOrId: h.amountOrId });
        facts.push({ t: "holder", token: h.token, account: h.owner });
        note(h.spender, true);
        break;
      case "allowance-delta":
      case "permit":
        token(h.token, "erc20");
        facts.push({ t: "allowance", token: h.token, owner: h.owner, spender: h.spender });
        facts.push({ t: "holder", token: h.token, account: h.owner });
        note(h.spender, true);
        break;
      case "transfer":
        token(h.token, "erc20");
        facts.push({ t: "holder", token: h.token, account: h.from }, { t: "holder", token: h.token, account: h.to });
        note(h.to, true);
        break;
      case "transferFrom":
        token(h.token);
        facts.push({ t: "pull", token: h.token, caller: h.caller, from: h.from, amountOrId: h.amountOrId });
        facts.push({ t: "holder", token: h.token, account: h.from }, { t: "holder", token: h.token, account: h.to });
        note(h.to, true);
        note(h.caller, true);
        break;
      case "setApprovalForAll":
        token(h.token);
        facts.push({ t: "operator", token: h.token, owner: h.owner, operator: h.operator });
        facts.push({ t: "holder", token: h.token, account: h.owner });
        note(h.operator, true);
        break;
      case "erc721-safeTransferFrom":
        token(h.token, "erc721");
        facts.push({ t: "nft", token: h.token, tokenId: h.tokenId });
        facts.push({ t: "holder", token: h.token, account: h.from }, { t: "holder", token: h.token, account: h.to });
        if (!sameAddress(h.caller, h.from)) facts.push({ t: "operator", token: h.token, owner: h.from, operator: h.caller });
        note(h.to, true);
        break;
      case "erc1155-transfer":
        token(h.token, "erc1155");
        for (const id of h.ids) {
          facts.push({ t: "erc1155", token: h.token, account: h.from, tokenId: id });
          facts.push({ t: "erc1155", token: h.token, account: h.to, tokenId: id });
        }
        if (!sameAddress(h.caller, h.from)) facts.push({ t: "operator", token: h.token, owner: h.from, operator: h.caller });
        note(h.to, true);
        break;
      case "wrapped-native":
        token(h.token, "erc20");
        facts.push({ t: "holder", token: h.token, account: h.account });
        break;
    }
  };

  const fromLog = (log: DecodedLog, step: string) => {
    switch (log.kind) {
      case "erc20-transfer":
        token(log.token, "erc20");
        facts.push({ t: "holder", token: log.token, account: log.from }, { t: "holder", token: log.token, account: log.to });
        flows.push({ timing, standard: "erc20", token: log.token, from: log.from, to: log.to, amount: log.amount.toString(), source: "log", step });
        note(log.to, true);
        note(log.from, true);
        break;
      case "erc721-transfer":
        token(log.token, "erc721");
        facts.push({ t: "nft", token: log.token, tokenId: log.tokenId });
        facts.push({ t: "holder", token: log.token, account: log.from }, { t: "holder", token: log.token, account: log.to });
        flows.push({ timing, standard: "erc721", token: log.token, from: log.from, to: log.to, amount: "1", tokenId: log.tokenId.toString(), source: "log", step });
        note(log.to, true);
        note(log.from, true);
        break;
      case "erc20-approval":
        token(log.token, "erc20");
        facts.push({ t: "allowance", token: log.token, owner: log.owner, spender: log.spender });
        facts.push({ t: "holder", token: log.token, account: log.owner });
        note(log.spender, true);
        break;
      case "erc721-approval":
        token(log.token, "erc721");
        facts.push({ t: "nft", token: log.token, tokenId: log.tokenId });
        facts.push({ t: "holder", token: log.token, account: log.owner });
        note(log.approved, true);
        break;
      case "approval-for-all":
        token(log.token);
        facts.push({ t: "operator", token: log.token, owner: log.owner, operator: log.operator });
        facts.push({ t: "holder", token: log.token, account: log.owner });
        note(log.operator, true);
        break;
      case "erc1155-transfer":
        token(log.token, "erc1155");
        log.ids.forEach((id, i) => {
          facts.push({ t: "erc1155", token: log.token, account: log.from, tokenId: id });
          facts.push({ t: "erc1155", token: log.token, account: log.to, tokenId: id });
          flows.push({
            timing,
            standard: "erc1155",
            token: log.token,
            from: log.from,
            to: log.to,
            amount: (log.amounts[i] ?? 0n).toString(),
            tokenId: id.toString(),
            operator: log.operator,
            source: "log",
            step,
          });
        });
        note(log.to, true);
        note(log.operator, true);
        break;
      case "wrapped-native":
        token(log.token, "erc20");
        facts.push({ t: "holder", token: log.token, account: log.account });
        break;
    }
  };

  for (const step of steps) {
    native.add(step.from);
    note(step.from, true);
    if (step.to) {
      native.add(step.to);
      note(step.to, true);
    }
    note(step.createdAddress, true);

    if (step.frames.length === 0) {
      const hint = decodeTokenCall(step.to, step.data, step.from);
      if (hint) fromCall(hint);
    }
    for (const f of step.frames) {
      note(f.to);
      if (!NON_CONTEXT_CALLS.has(f.type)) {
        const hint = decodeTokenCall(f.to, f.input, f.from);
        if (hint) fromCall(hint);
      }
      if (f.value > 0n && !f.reverted && f.to) {
        native.add(f.from);
        native.add(f.to);
        flows.push({ timing, standard: "native", token: ZERO_ADDRESS, from: f.from, to: f.to, amount: f.value.toString(), source: "trace", step: step.label });
      }
    }
    for (const log of step.logs) fromLog(log, step.label);
  }

  for (const t of hints?.tokens ?? []) token(addr(t.address), t.standard === "native" || t.standard === "unknown" ? undefined : t.standard);
  for (const t of hints?.tokenIds ?? []) facts.push({ t: "nft", token: addr(t.token), tokenId: BigInt(t.tokenId) });
  for (const a of hints?.allowances ?? []) {
    token(addr(a.token));
    facts.push({ t: "allowance", token: addr(a.token), owner: addr(a.owner), spender: addr(a.spender) });
  }
  for (const o of hints?.operators ?? []) {
    token(addr(o.token));
    facts.push({ t: "operator", token: addr(o.token), owner: addr(o.owner), operator: addr(o.operator) });
  }
  for (const a of hints?.accounts ?? []) {
    native.add(addr(a));
    note(addr(a), true);
  }

  // The signer's own position in every discovered token.
  for (const t of tokenCandidates.keys()) for (const o of owners) facts.push({ t: "holder", token: t, account: o });
  for (const t of hints?.tokenIds ?? []) for (const o of owners) facts.push({ t: "erc1155", token: addr(t.token), account: o, tokenId: BigInt(t.tokenId) });

  for (const t of tokenCandidates.keys()) other.delete(t);
  const interestingAddresses = [...priority, ...[...other].filter((a) => !priority.has(a))].slice(0, 64);
  return { tokenCandidates, facts, nativeAccounts: native, interestingAddresses, flows };
}

export function buildProbes(
  d: Discovery,
  tokens: Map<string, TokenInfo>,
): { probes: ProbeSet; unresolved: string[] } {
  const probes = new ProbeSet();
  const unresolved = new Set<string>();
  const std = (t: Address) => tokens.get(t.toLowerCase())?.standard ?? "unknown";

  for (const account of d.nativeAccounts) probes.add({ type: "native-balance", account });

  for (const f of d.facts) {
    const s = std(f.token);
    switch (f.t) {
      case "holder":
        if (s === "erc20") probes.add({ type: "erc20-balance", token: f.token, account: f.account });
        else if (s === "erc721") probes.add({ type: "erc721-count", token: f.token, account: f.account });
        else if (s === "unknown") unresolved.add(f.token);
        break;
      case "approve":
        if (s === "erc721") {
          probes.add({ type: "erc721-approved", token: f.token, tokenId: f.amountOrId });
          probes.add({ type: "erc721-owner", token: f.token, tokenId: f.amountOrId });
        } else if (s === "erc20") {
          probes.add({ type: "erc20-allowance", token: f.token, owner: f.owner, spender: f.spender });
        } else unresolved.add(f.token);
        break;
      case "allowance":
        if (s === "erc20" || s === "unknown") probes.add({ type: "erc20-allowance", token: f.token, owner: f.owner, spender: f.spender });
        break;
      case "pull":
        if (s === "erc20") {
          if (!sameAddress(f.caller, f.from)) probes.add({ type: "erc20-allowance", token: f.token, owner: f.from, spender: f.caller });
        } else if (s === "erc721") {
          probes.add({ type: "erc721-owner", token: f.token, tokenId: f.amountOrId });
          probes.add({ type: "erc721-approved", token: f.token, tokenId: f.amountOrId });
          if (!sameAddress(f.caller, f.from))
            probes.add({ type: "operator-approval", token: f.token, standard: "erc721", owner: f.from, operator: f.caller });
        } else unresolved.add(f.token);
        break;
      case "nft":
        if (s === "erc721") {
          probes.add({ type: "erc721-owner", token: f.token, tokenId: f.tokenId });
          probes.add({ type: "erc721-approved", token: f.token, tokenId: f.tokenId });
        }
        break;
      case "operator":
        probes.add({
          type: "operator-approval",
          token: f.token,
          standard: s === "erc721" || s === "erc1155" ? s : "unknown",
          owner: f.owner,
          operator: f.operator,
        });
        break;
      case "erc1155":
        if (s === "erc1155") probes.add({ type: "erc1155-balance", token: f.token, account: f.account, tokenId: f.tokenId });
        break;
    }
  }
  return { probes, unresolved: [...unresolved] };
}
