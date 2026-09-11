import { maxSeverity, severityRank, type AccountInfo, type Assessment, type AssessInput, type Evidence, type Finding, type SimulationResult, type StateChange } from "@cognitia/shared";
import { amount, eth, short, tokenLabel } from "./format";

const lc = (a?: string | null) => (a ?? "").toLowerCase();

/** Top-level calls where the user is knowingly sending their own assets. */
const EXPLICIT_TRANSFERS = new Set(["transfer", "transferFrom", "safeTransferFrom", "safeBatchTransferFrom", "withdraw"]);

function accountKind(accounts: AccountInfo[], address: string) {
  const a = accounts.find((x) => lc(x.address) === lc(address));
  if (!a) return "unknown account";
  return a.isContract ? "a contract" : "a regular account (not a contract)";
}

function changeEvidence(c: StateChange, summary: string): Evidence {
  return { kind: "state-change", summary, data: c as unknown as Record<string, unknown> };
}

function outflowsOf(sim: SimulationResult, user: string) {
  const out: { change: StateChange; recipients: string[]; text: string }[] = [];
  const flowsFrom = (token: string, tokenId?: string) =>
    sim.assetFlows.filter((f) => lc(f.from) === lc(user) && lc(f.token) === lc(token) && (tokenId === undefined || f.tokenId === tokenId)).map((f) => f.to);
  for (const c of sim.immediateChanges) {
    if (c.kind === "erc20-balance" && lc(c.account) === lc(user) && c.delta.startsWith("-")) {
      out.push({ change: c, recipients: flowsFrom(c.token), text: amount(c.delta.slice(1), c.token, sim.tokens) });
    } else if (c.kind === "erc1155-balance" && lc(c.account) === lc(user) && c.delta.startsWith("-")) {
      out.push({ change: c, recipients: flowsFrom(c.token, c.tokenId), text: `${c.delta.slice(1)} × ${tokenLabel(c.token, sim.tokens)} #${c.tokenId}` });
    } else if (c.kind === "erc721-owner" && lc(c.before) === lc(user) && lc(c.after) !== lc(user)) {
      out.push({ change: c, recipients: c.after ? [c.after] : [], text: `${tokenLabel(c.token, sim.tokens)} #${c.tokenId}` });
    } else if (c.kind === "native-balance" && lc(c.account) === lc(user) && c.delta.startsWith("-")) {
      out.push({ change: c, recipients: sim.assetFlows.filter((f) => f.standard === "native" && lc(f.from) === lc(user)).map((f) => f.to), text: eth(c.delta.slice(1)) });
    }
  }
  return out;
}

function inflowsOf(sim: SimulationResult, user: string) {
  return sim.immediateChanges.filter(
    (c) =>
      ((c.kind === "erc20-balance" || c.kind === "erc1155-balance" || c.kind === "native-balance") && lc(c.account) === lc(user) && !c.delta.startsWith("-")) ||
      (c.kind === "erc721-owner" && lc(c.after) === lc(user)),
  );
}

/**
 * Baseline severity rules over decoded intent + simulated state. Deliberately conservative; the
 * full rule set and threat-database matching live in @cognitia/risk-engine.
 */
export function baselineAssess(input: AssessInput): Assessment {
  const { decoded, simulation: sim, normalized } = input;
  const findings: Finding[] = [...decoded.findings];
  const add = (f: Omit<Finding, "id">) => findings.push({ id: `${f.ruleId}#${findings.length}`, ...f });

  if (!sim) {
    if (normalized.kind === "transaction" || decoded.conditional) {
      add({
        ruleId: "analysis.unavailable",
        severity: "unknown",
        title: "Analysis unavailable",
        explanation: `The request could not be simulated${input.simulationError ? ` (${input.simulationError})` : ""}. Nothing about its effect is known — do not treat it as safe.`,
        confidence: "high",
        evidenceType: "analysis-gap",
        evidence: [{ kind: "simulation", summary: input.simulationError ?? "simulation not run" }],
      });
    } else if (normalized.kind === "personal-sign") {
      add({
        ruleId: "signature.message",
        severity: "unknown",
        title: "Off-chain message signature",
        explanation: "Signing a plain message moves no assets by itself, but some apps use signed messages as logins or off-chain orders. Only sign messages you understand from sites you trust.",
        confidence: "medium",
        evidenceType: "signature",
        evidence: [{ kind: "signature", summary: decoded.intent.summary }],
      });
    } else if (normalized.kind === "typed-data" && findings.length === 0) {
      add({
        ruleId: "signature.unknown-typed-data",
        severity: "unknown",
        title: "Unrecognised structured signature",
        explanation: `${decoded.intent.summary}. This signature type is not decoded, so what it authorises is unknown.`,
        confidence: "medium",
        evidenceType: "analysis-gap",
        evidence: [{ kind: "signature", summary: decoded.intent.summary, data: decoded.intent.args }],
      });
    } else if (normalized.kind === "unsupported") {
      add({
        ruleId: "analysis.unsupported",
        severity: "unknown",
        title: "Request type not supported",
        explanation: `${normalized.reason}. Nothing about its effect is known.`,
        confidence: "high",
        evidenceType: "analysis-gap",
        evidence: [{ kind: "simulation", summary: normalized.reason }],
      });
    }
    return finish(findings);
  }

  const user = normalized.kind === "transaction" ? normalized.tx.from : input.request.account;

  if (sim.outcome === "revert" && sim.mode === "transaction") {
    add({
      ruleId: "simulation.revert",
      severity: "medium",
      title: "This transaction is expected to fail",
      explanation: `On current chain state the transaction reverts${sim.revertReason ? ` with "${sim.revertReason}"` : ""}. You would pay gas and nothing would happen.`,
      confidence: "high",
      evidenceType: "simulated-state",
      evidence: [{ kind: "simulation", summary: `reverted: ${sim.revertReason ?? "no reason"}` }],
    });
  } else if (sim.outcome === "not-executed") {
    add({
      ruleId: "simulation.not-executed",
      severity: "unknown",
      title: "Could not execute the request on the fork",
      explanation: `${sim.error ?? "The node refused the transaction"}. Its effect is unknown.`,
      confidence: "high",
      evidenceType: "analysis-gap",
      evidence: [{ kind: "simulation", summary: sim.error ?? "not executed" }],
    });
  }

  // --- authority granted to someone else ---
  for (const e of sim.exposures) {
    const spender = `${short(e.spender)} (${accountKind(sim.accounts, e.spender)})`;
    const conditional = e.basis === "conditional-signature";
    const evidence: Evidence[] = [
      { kind: conditional ? "signature" : "state-change", summary: `${e.kind} ${e.owner} → ${e.spender}`, data: e as unknown as Record<string, unknown> },
    ];
    if (e.kind === "erc20-allowance" && e.basis !== "existing-used") {
      const label = tokenLabel(e.token, sim.tokens);
      const held = e.atRisk.erc20Balance ? amount(e.atRisk.erc20Balance, e.token, sim.tokens) : `your ${label}`;
      add({
        ruleId: e.unlimited ? "approval.erc20-unlimited" : "approval.erc20",
        severity: e.unlimited || e.exceedsTotalSupply ? "high" : "medium",
        title: `${conditional ? "Signature grants" : "Grants"} ${e.unlimited ? "unlimited" : amount(e.amount ?? "0", e.token, sim.tokens)} ${e.unlimited ? label : ""} spending to ${short(e.spender)}`.replace(/\s+/g, " "),
        explanation: `${spender} could move ${e.unlimited ? "any amount of" : "up to the approved amount of"} your ${label} — you currently hold ${held} — at any time until the approval is revoked. ${conditional ? "Signing moves nothing by itself; the signature becomes an approval once anyone submits it." : "No tokens move when you confirm this."}`,
        confidence: "high",
        evidenceType: conditional ? "signature" : "simulated-state",
        evidence,
      });
    } else if (e.kind === "erc20-allowance" && e.basis === "existing-used") {
      add({
        ruleId: "approval.existing-still-open",
        severity: "medium",
        title: `An earlier ${tokenLabel(e.token, sim.tokens)} approval stays open after this`,
        explanation: `${spender} used an allowance you granted before, and ${amount(e.amount ?? "0", e.token, sim.tokens)} of it remains usable.`,
        confidence: "high",
        evidenceType: "simulated-state",
        evidence,
      });
    } else if (e.kind === "operator-approval") {
      const label = tokenLabel(e.token, sim.tokens);
      add({
        ruleId: "approval.operator-all",
        severity: "high",
        title: `Grants control of your entire ${label} collection`,
        explanation: `${spender} could transfer every ${label} you own${e.atRisk.nftCount ? ` (currently ${e.atRisk.nftCount})` : ""} and any you receive later, until the approval is revoked. No NFTs move when you confirm this.`,
        confidence: "high",
        evidenceType: conditional ? "signature" : "simulated-state",
        evidence,
      });
    } else if (e.kind === "erc721-token-approval") {
      add({
        ruleId: "approval.erc721-token",
        severity: "medium",
        title: `Lets ${short(e.spender)} take ${tokenLabel(e.token, sim.tokens)} #${e.tokenId}`,
        explanation: `${spender} could transfer this NFT at any time until the approval is cleared.`,
        confidence: "high",
        evidenceType: "simulated-state",
        evidence,
      });
    }
  }

  // --- approvals that the simulation shows as "no change" because they are already in force ---
  // Re-confirming an allowance that a spender already holds produces an empty diff, but the request
  // still asks the user to authorise that spender. Drainer sites re-prompt exactly this way, so the
  // finding is based on the decoded calldata and rated like a fresh approval.
  const args = decoded.intent.args ?? {};
  const target = decoded.intent.target ?? "";
  const isUnlimited = (v?: string) => !!v && (v.includes("max uint256") || (/^\d+$/.test(v) && BigInt(v) >= 1n << 255n));
  const amountOf = (v?: string) => (v ?? "0").replace(/\s*\(max uint256\)$/, "");
  const hasExposure = (spender: string) => sim.exposures.some((e) => lc(e.spender) === lc(spender) && lc(e.token) === lc(target));
  if (sim.outcome === "success" && sim.mode === "transaction") {
    if ((decoded.intent.functionName === "approve" || decoded.intent.functionName === "increaseAllowance") && args.spender && amountOf(args.amount ?? args.addedValue) !== "0" && !hasExposure(args.spender)) {
      const label = tokenLabel(target, sim.tokens);
      const unlimited = decoded.intent.functionName === "approve" && isUnlimited(args.amount);
      add({
        ruleId: unlimited ? "approval.erc20-unlimited" : "approval.erc20",
        severity: unlimited ? "high" : "medium",
        title: `${unlimited ? "Re-confirms unlimited" : "Re-confirms"} ${label} spending for ${short(args.spender)}`.replace(/\s+/g, " "),
        explanation: `${short(args.spender)} (${accountKind(sim.accounts, args.spender)}) can already spend ${unlimited ? "any amount of" : "this much of"} your ${label}; this request asks you to authorise it again. Sites that keep asking for the same approval are a drainer pattern � revoke the allowance instead of confirming.`,
        confidence: "high",
        evidenceType: "decoded-calldata",
        evidence: [
          { kind: "calldata", summary: decoded.intent.summary, data: args },
          { kind: "simulation", summary: "allowance unchanged by this transaction (already granted)" },
        ],
      });
    }
    if (decoded.intent.functionName === "setApprovalForAll" && args.operator && args.approved === "true" && !hasExposure(args.operator)) {
      const label = tokenLabel(target, sim.tokens);
      add({
        ruleId: "approval.operator-all",
        severity: "high",
        title: `Re-confirms control of your entire ${label} collection for ${short(args.operator)}`,
        explanation: `${short(args.operator)} (${accountKind(sim.accounts, args.operator)}) is already an approved operator for every ${label} you own; this request asks you to grant it again. Revoke the operator approval instead of confirming.`,
        confidence: "high",
        evidenceType: "decoded-calldata",
        evidence: [
          { kind: "calldata", summary: decoded.intent.summary, data: args },
          { kind: "simulation", summary: "operator approval unchanged by this transaction (already granted)" },
        ],
      });
    }
  }

  // --- revocations: protective, worth naming explicitly ---
  if (decoded.intent.functionName === "approve" && args.amount === "0" && args.spender) {
    add({
      ruleId: "approval.revoke",
      severity: "low",
      title: `Revokes ${short(args.spender)}'s allowance for ${tokenLabel(decoded.intent.target ?? "", sim.tokens)}`,
      explanation: "Sets the spender's allowance to zero, removing any spending authority it had. This is a protective action.",
      confidence: "high",
      evidenceType: "decoded-calldata",
      evidence: [{ kind: "calldata", summary: `approve(${args.spender}, 0)` }],
    });
  }
  if (decoded.intent.functionName === "setApprovalForAll" && args.approved === "false" && args.operator) {
    add({
      ruleId: "approval.revoke-operator",
      severity: "low",
      title: `Revokes ${short(args.operator)}'s operator approval for ${tokenLabel(decoded.intent.target ?? "", sim.tokens)}`,
      explanation: "Removes the operator's authority to transfer your tokens in this collection. This is a protective action.",
      confidence: "high",
      evidenceType: "decoded-calldata",
      evidence: [{ kind: "calldata", summary: `setApprovalForAll(${args.operator}, false)` }],
    });
  }

  // --- assets leaving the wallet now ---
  const fn = decoded.intent.functionName;
  const explicit = !!fn && EXPLICIT_TRANSFERS.has(fn);
  const inflows = inflowsOf(sim, user);
  const txValue = normalized.kind === "transaction" ? BigInt(normalized.tx.value ?? "0") : 0n;
  for (const o of outflowsOf(sim, user)) {
    const to = o.recipients.length ? o.recipients.map(short).join(", ") : "another account";
    const nativeAsSent = o.change.kind === "native-balance" && txValue > 0n && BigInt(o.change.delta) === -txValue;
    if (explicit || (nativeAsSent && !decoded.intent.selector)) {
      add({
        ruleId: "transfer.expected",
        severity: "low",
        title: `Sends ${o.text} to ${to}`,
        explanation: "This matches what the request says it does. Check the amount and recipient.",
        confidence: "high",
        evidenceType: "simulated-state",
        evidence: [changeEvidence(o.change, `${o.text} leaves your wallet`)],
      });
    } else if (inflows.length > 0 || nativeAsSent) {
      add({
        ruleId: "transfer.exchange",
        severity: "medium",
        title: `Spends ${o.text}${nativeAsSent ? ` via ${decoded.intent.functionName ?? "a contract call"}` : ""}`,
        explanation: `${o.text} leaves your wallet${inflows.length ? " and you receive assets in return" : ""}. Confirm the site is the one you intend to use.`,
        confidence: "medium",
        evidenceType: "simulated-state",
        evidence: [changeEvidence(o.change, `${o.text} leaves your wallet`)],
      });
    } else {
      const usedAllowance = sim.immediateChanges.find(
        (c) => c.kind === "erc20-allowance" && lc(c.owner) === lc(user) && "token" in o.change && lc(c.token) === lc(o.change.token) && BigInt(c.after) < BigInt(c.before),
      );
      const via = usedAllowance && usedAllowance.kind === "erc20-allowance" ? ` It spends an approval you granted earlier to ${short(usedAllowance.spender)}.` : "";
      add({
        ruleId: "transfer.hidden-outflow",
        // Assets leave the wallet now, with nothing received, under a function that does not say so:
        // this is theft in progress, not a future risk, so it outranks approvals.
        severity: "critical",
        title: `Moves ${o.text} out of your wallet`,
        explanation: `The site presents this as ${fn ? `"${fn}"` : "an unrecognised function"}, but simulation shows ${o.text} leaving your wallet to ${to} with nothing received in return.${via}`,
        confidence: "high",
        evidenceType: "simulated-state",
        evidence: [
          changeEvidence(o.change, `${o.text} leaves your wallet`),
          { kind: "calldata", summary: decoded.intent.summary },
        ],
      });
    }
  }

  // --- delegatecalls to code that is not the caller's declared proxy implementation ---
  const requestCalls = sim.calls.filter((x) => x.step === "request");
  const seenDelegate = new Set<string>();
  requestCalls.forEach((c, i) => {
    if (c.type !== "DELEGATECALL") return;
    const pair = `${lc(c.from)}->${lc(c.to)}`;
    if (seenDelegate.has(pair)) return; // same proxy → implementation hop, reported once
    seenDelegate.add(pair);
    const caller = sim.accounts.find((a) => lc(a.address) === lc(c.from));
    if (caller?.proxyImplementation && lc(caller.proxyImplementation) === lc(c.to)) return;
    // A proxy forwards its own calldata verbatim to the implementation.
    const parent = requestCalls.slice(0, i).reverse().find((p) => p.depth === c.depth - 1);
    if (parent && lc(parent.to) === lc(c.from) && parent.input && parent.input === c.input) return;
    add({
      ruleId: "trace.delegatecall",
      severity: "medium",
      title: `Runs external code from ${short(c.to)} with ${short(c.from)}'s permissions`,
      explanation: "A delegatecall executes another contract's code inside the caller's storage and balance. That is normal for proxies and multicall routers, but worth checking when the target is not a known implementation.",
      confidence: "low",
      evidenceType: "behavioral",
      evidence: [{ kind: "trace", summary: `DELEGATECALL ${c.from} → ${c.to}`, data: c as unknown as Record<string, unknown> }],
    });
  });

  if (sim.mode === "transaction" && !decoded.intent.known && decoded.intent.selector) {
    const unresolved = sim.coverage.complete === false;
    add({
      ruleId: "decode.unknown-function",
      severity: unresolved ? "medium" : "low",
      title: `Unrecognised function ${decoded.intent.selector}`,
      explanation: unresolved
        ? "The function could not be decoded and some of its effects could not be measured."
        : "The function could not be decoded; the findings above come from simulating it on current chain state.",
      confidence: "medium",
      evidenceType: "decoded-calldata",
      evidence: [{ kind: "calldata", summary: decoded.intent.summary }],
    });
  }

  for (const check of sim.signatureChecks ?? []) {
    if (check.status !== "fail") continue;
    add({
      ruleId: `signature.check-${check.name}`,
      severity: check.name === "nonce" || check.name === "deadline" ? "low" : "medium",
      title: `Permit check failed: ${check.name}`,
      explanation: check.detail,
      confidence: "high",
      evidenceType: "signature",
      evidence: [{ kind: "signature", summary: check.detail }],
    });
  }

  if (sim.gas?.balanceCoversFee === false) {
    add({
      ruleId: "gas.insufficient",
      severity: "low",
      title: "Balance may not cover the network fee",
      explanation: `The estimated fee is ${eth(sim.gas.estimatedFeeWei ?? "0")}, more than the native balance left after this transaction.`,
      confidence: "medium",
      evidenceType: "simulated-state",
      evidence: [{ kind: "simulation", summary: `fee ≈ ${sim.gas.estimatedFeeWei} wei` }],
    });
  }

  if (findings.length === 0 && sim.outcome === "success") {
    add({
      ruleId: "simulation.no-risk-observed",
      severity: "low",
      title: "No risky changes observed",
      explanation: "Simulation found no approvals granted and no unexpected asset movements.",
      confidence: "medium",
      evidenceType: "simulated-state",
      evidence: [{ kind: "simulation", summary: `${sim.immediateChanges.length} state changes checked` }],
    });
  }
  return finish(findings);
}

function finish(findings: Finding[]): Assessment {
  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const severity = maxSeverity(findings.map((f) => f.severity), "unknown");
  const top = findings[0];
  const prefix = { critical: "CRITICAL RISK", high: "HIGH RISK", medium: "CAUTION", unknown: "UNKNOWN RISK", low: "LOW OBSERVED RISK" }[severity];
  return { severity, summary: top ? `${prefix} — ${top.title}` : `${prefix}`, findings };
}
