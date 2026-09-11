/**
 * Runs Swastik's RiskEngine (threat database, calldata rules, ERC-2612 checks) on top of Asif's
 * fork simulator, exposed through the shared `RiskEngine` interface the API already uses.
 *
 * - Swastik's own simulator is replaced by a provider that hands his engine the real fork
 *   result (mapped to his schema), so his rules see genuine balances, allowances and traces.
 * - Baseline simulation-derived rules he does not have (hidden outflows, reverts, single-NFT
 *   approvals, …) are merged in; overlapping rules are deduplicated in his favour.
 */
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import {
  maxSeverity,
  severityRank,
  type AssessInput,
  type Assessment,
  type Evidence,
  type Finding,
  type NormalizedRequest,
  type RiskEngine,
  type Severity,
  type SimulationResult,
} from "@cognitia/shared";
import { chainsFromEnv, type ChainConfig } from "@cognitia/simulator";
import { baselineAssess } from "../../services/api/src/engine/assess";
import { baselineDecode } from "../../services/api/src/engine/decode";
import { RiskEngine as SwastikRiskEngine } from "../swastik-risk-engine/src/engine/riskEngine";
import { VersionedThreatStore } from "../swastik-risk-engine/src/providers/threatProvider";
import type { ChainReadProvider, SimulationProvider } from "../swastik-risk-engine/src/providers/types";
import type { AnalysisReport as SwastikReport } from "../swastik-risk-engine/src/schemas/report";
import type { AnalysisRequest as SwastikRequest } from "../swastik-risk-engine/src/schemas/request";
import type { SimulationResult as SwastikSimulation } from "../swastik-risk-engine/src/schemas/simulation";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const READ_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

/** Swastik's ChainReadProvider backed by the same upstream RPCs the simulator forks from. */
class ChainReader implements ChainReadProvider {
  readonly chainId: number;
  private readonly client: PublicClient;
  constructor(cfg: ChainConfig) {
    this.chainId = cfg.chainId;
    this.client = createPublicClient({ transport: http(cfg.rpcUrl, { timeout: 15_000 }) });
  }
  getBalance(account: string) { return this.client.getBalance({ address: account as Address }); }
  getTokenBalance(token: string, account: string) { return this.client.readContract({ address: token as Address, abi: READ_ABI, functionName: "balanceOf", args: [account as Address] }); }
  getTokenAllowance(token: string, owner: string, spender: string) { return this.client.readContract({ address: token as Address, abi: READ_ABI, functionName: "allowance", args: [owner as Address, spender as Address] }); }
  getTokenNonce(token: string, owner: string) { return this.client.readContract({ address: token as Address, abi: READ_ABI, functionName: "nonces", args: [owner as Address] }); }
  getDomainSeparator(token: string) { return this.client.readContract({ address: token as Address, abi: READ_ABI, functionName: "DOMAIN_SEPARATOR" }).then((x) => x as string).catch(() => null); }
  getBlockTimestamp() { return this.client.getBlock().then((b) => b.timestamp); }
  getBytecode(address: string) { return this.client.getCode({ address: address as Address }).then((c) => c ?? null); }
  getBlockNumber() { return this.client.getBlockNumber({ cacheTime: 0 }); }
}

function toSwastikRequest(input: AssessInput): SwastikRequest | undefined {
  const { request, normalized } = input;
  switch (normalized.kind) {
    case "transaction":
      if (!normalized.tx.to) return undefined; // his schema has no contract-creation shape
      return {
        type: "transaction",
        chainId: request.chainId,
        from: normalized.tx.from,
        to: normalized.tx.to,
        value: normalized.tx.value ?? "0",
        calldata: normalized.tx.data ?? "0x",
        metadata: { origin: request.origin },
      };
    case "typed-data":
      return {
        type: "eip712",
        expectedSigner: normalized.signer,
        selectedChainId: request.chainId,
        payload: normalized.typedData as SwastikRequest extends { payload: infer P } ? P : never,
        domainOrOrigin: request.origin,
      } as SwastikRequest;
    case "personal-sign":
      return { type: "personal_sign", expectedSigner: normalized.signer, rawMessage: normalized.message, chainId: request.chainId, domainOrOrigin: request.origin };
    default:
      return undefined;
  }
}

function describeChange(c: SimulationResult["immediateChanges"][number]): string {
  switch (c.kind) {
    case "native-balance": return `native balance of ${c.account}: ${c.before} → ${c.after}`;
    case "erc20-balance": return `ERC-20 ${c.token} balance of ${c.account}: ${c.before} → ${c.after}`;
    case "erc20-allowance": return `ERC-20 ${c.token} allowance ${c.owner} → ${c.spender}: ${c.before} → ${c.after}`;
    case "erc721-owner": return `ERC-721 ${c.token} #${c.tokenId} owner: ${c.before ?? "none"} → ${c.after ?? "none"}`;
    case "erc721-token-approval": return `ERC-721 ${c.token} #${c.tokenId} approved: ${c.before ?? "none"} → ${c.after ?? "none"}`;
    case "operator-approval": return `${c.standard} ${c.token} operator ${c.owner} → ${c.operator}: ${c.before} → ${c.after}`;
    case "erc1155-balance": return `ERC-1155 ${c.token} #${c.tokenId} balance of ${c.account}: ${c.before} → ${c.after}`;
  }
}

/** Map Asif's SimulationResult onto Swastik's simulation schema. */
export function toSwastikSimulation(sim: SimulationResult, input: AssessInput): SwastikSimulation {
  const conditional = sim.mode === "conditional-signature";
  const changes = conditional ? (sim.conditional?.changes ?? []) : sim.immediateChanges;
  const symbol = (t: string) => sim.tokens.find((x) => x.address.toLowerCase() === t.toLowerCase())?.symbol;
  const sc: NonNullable<SwastikSimulation["stateChanges"]> = { nativeBalances: [], erc20Balances: [], erc20Allowances: [], erc721Ownership: [], erc721Approvals: [], erc1155Balances: [], erc1155Approvals: [] };
  const assetDeltas: SwastikSimulation["assetDeltas"] = [];

  for (const c of changes) {
    switch (c.kind) {
      case "native-balance":
        sc.nativeBalances.push({ account: c.account, pre: c.before, post: c.after, delta: c.delta });
        assetDeltas.push({ account: c.account, token: ZERO, symbol: "ETH", amountDelta: c.delta });
        break;
      case "erc20-balance":
        sc.erc20Balances.push({ token: c.token, account: c.account, pre: c.before, post: c.after, delta: c.delta });
        assetDeltas.push({ account: c.account, token: c.token, symbol: symbol(c.token), amountDelta: c.delta });
        break;
      case "erc20-allowance":
        sc.erc20Allowances.push({ token: c.token, owner: c.owner, spender: c.spender, pre: c.before, post: c.after, delta: (BigInt(c.after) - BigInt(c.before)).toString() });
        break;
      case "erc721-owner":
        sc.erc721Ownership.push({ token: c.token, tokenId: c.tokenId, preOwner: c.before ?? ZERO, postOwner: c.after ?? ZERO });
        if (c.before) assetDeltas.push({ account: c.before, token: c.token, symbol: symbol(c.token), amountDelta: "-1" });
        if (c.after) assetDeltas.push({ account: c.after, token: c.token, symbol: symbol(c.token), amountDelta: "1" });
        break;
      case "operator-approval":
        (c.standard === "erc1155" ? sc.erc1155Approvals : sc.erc721Approvals).push({ token: c.token, owner: c.owner, operator: c.operator, preApproved: c.before, postApproved: c.after });
        break;
      case "erc1155-balance":
        sc.erc1155Balances.push({ token: c.token, account: c.account, id: c.tokenId, pre: c.before, post: c.after, delta: c.delta });
        assetDeltas.push({ account: c.account, token: c.token, symbol: symbol(c.token), amountDelta: c.delta });
        break;
      case "erc721-token-approval":
        break; // no equivalent in his schema; covered by the merged baseline finding
    }
  }

  const callType = (t: string): "call" | "delegatecall" | "staticcall" => (t === "DELEGATECALL" ? "delegatecall" : t === "STATICCALL" ? "staticcall" : "call");
  const from = input.normalized.kind === "transaction" ? input.normalized.tx.from : input.request.account;
  return {
    success: sim.outcome === "success",
    executionContext: conditional ? "conditional_modeling" : "observed_simulation",
    conditionalLabel: conditional ? "Conditional outcome if this permit is signed and accepted." : undefined,
    assumptions: [...sim.assumptions, ...(sim.conditional?.assumptions ?? [])],
    assetDeltas,
    gasUsed: sim.gas?.used,
    revertReason: sim.revertReason ?? sim.error,
    pinnedSnapshot: { chainId: sim.fork.chainId, blockNumber: sim.fork.blockNumber, blockHash: sim.fork.blockHash },
    disclosedOverrides: [{ type: "impersonation", target: from, details: `Impersonated ${from} on a private Anvil fork pinned to block #${sim.fork.blockNumber}; nothing was broadcast.` }],
    callTraces: sim.calls.filter((c) => c.to).map((c) => ({ from: c.from, to: c.to!, value: c.value, callType: callType(c.type), depth: c.depth, error: c.error })),
    delegatecallTargets: [...new Set(sim.calls.filter((c) => c.type === "DELEGATECALL" && c.to).map((c) => c.to!))],
    stateChanges: sc,
    discoveryLimits: [...sim.coverage.missing, "Only assets referenced by calldata, logs or the execution trace were inspected."],
    separatedEffects: {
      decodedRequestedActions: [input.decoded.intent.summary],
      observedEffects: changes.map(describeChange),
      unresolvedEffects: sim.coverage.missing,
    },
    misleadingEvents: [],
    coverageImpact: { status: sim.coverage.complete === false ? "partial" : "complete", reasons: sim.coverage.missing },
  };
}

const EVIDENCE_KIND: Record<string, Evidence["kind"]> = {
  address_match: "threat-record", codehash_match: "bytecode", domain_match: "domain", behavioral: "calldata",
  rpc_trace: "trace", state_override_simulation: "simulation", ast_analysis: "calldata",
};
const EVIDENCE_TYPE: Record<string, Finding["evidenceType"]> = {
  address_match: "threat-address", codehash_match: "threat-bytecode", domain_match: "threat-domain", behavioral: "behavioral",
  rpc_trace: "simulated-state", state_override_simulation: "simulated-state", ast_analysis: "decoded-calldata",
};

function toFinding(f: SwastikReport["findings"][number], report: SwastikReport): Finding {
  const ev = f.evidenceIds.map((id) => report.evidence[id]).filter((e): e is NonNullable<typeof e> => !!e);
  const primary = ev[0]?.type;
  return {
    id: f.id,
    ruleId: `swastik.${f.ruleId}`,
    severity: f.severity,
    title: f.title,
    description: f.plainEnglishExplanation,
    explanation: f.remediation ? `${f.plainEnglishExplanation} Recommendation: ${f.remediation}` : f.plainEnglishExplanation,
    confidence: f.confidence.level,
    evidenceType: (primary && EVIDENCE_TYPE[primary]) ?? (f.executionContext === "decoded_intent" ? "decoded-calldata" : "simulated-state"),
    evidence: ev.map((e) => ({ kind: EVIDENCE_KIND[e.type] ?? "simulation", summary: `${e.type} (${e.provenance})`, data: e.rawSupportingData })),
  };
}

/** Baseline rules Swastik's engine already covers; his version wins. */
const COVERED_BY_SWASTIK = new Set(["approval.erc20-unlimited", "approval.operator-all", "decode.unknown-function", "simulation.no-risk-observed"]);
/** His catch-all "nothing suspicious" findings; dropped when anything above low is present. */
const GENERIC_LOW = new Set(["swastik.expected_transfer_no_suspicious_findings", "swastik.incomplete_analysis_coverage"]);
const PREFIX: Record<Severity, string> = { critical: "CRITICAL RISK", high: "HIGH RISK", medium: "CAUTION", unknown: "UNKNOWN RISK", low: "LOW OBSERVED RISK" };

function finish(findings: Finding[], floor?: Severity): Assessment {
  const nonLow = findings.some((f) => f.severity !== "low");
  const kept = (nonLow ? findings.filter((f) => !GENERIC_LOW.has(f.ruleId)) : findings).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const severity = maxSeverity([...kept.map((f) => f.severity), ...(floor ? [floor] : [])], "unknown");
  const top = kept[0];
  return { severity, summary: top ? `${PREFIX[severity]} — ${top.title}` : PREFIX[severity], findings: kept };
}

export type SwastikEngineOptions = { chains?: ChainConfig[]; includeDemo?: boolean };

export function createSwastikEngine(opts: SwastikEngineOptions = {}): RiskEngine {
  const chains = new Map((opts.chains ?? chainsFromEnv()).map((c) => [c.chainId, c]));
  const threats = new VersionedThreatStore({ includeDemo: opts.includeDemo });
  const readers = new Map<number, ChainReader>();
  const reader = (chainId: number) => {
    const cfg = chains.get(chainId);
    if (!cfg) return undefined;
    let r = readers.get(chainId);
    if (!r) readers.set(chainId, (r = new ChainReader(cfg)));
    return r;
  };

  return {
    name: "swastik-risk-engine+baseline",
    version: "1.0.0",
    decode: async (request, normalized: NormalizedRequest) => baselineDecode(request, normalized),
    assess: async (input) => {
      const his = toSwastikRequest(input);
      const mine = baselineAssess(input);
      if (!his) return mine;

      const provider: SimulationProvider = {
        name: "cognitia-fork-simulator",
        isAvailable: async () => true,
        simulateTransaction: async () => {
          if (!input.simulation) throw new Error(input.simulationError ?? "fork simulation unavailable");
          return toSwastikSimulation(input.simulation, input);
        },
        simulateConditionalPermit: async () => {
          if (!input.simulation) throw new Error(input.simulationError ?? "fork simulation unavailable");
          return toSwastikSimulation(input.simulation, input);
        },
      };

      let report: SwastikReport;
      try {
        const engine = new SwastikRiskEngine({ simulationProvider: provider, chainProvider: reader(input.request.chainId), includeDemo: opts.includeDemo });
        report = await engine.analyze(his);
      } catch (err) {
        mine.findings.unshift({
          id: "swastik.engine-error",
          ruleId: "analysis.risk-engine-error",
          severity: "unknown",
          title: "Threat-database rules could not run",
          description: `Risk engine error: ${(err as Error).message}`,
          explanation: `The threat-database and calldata rules failed (${(err as Error).message}); only simulation-based findings are shown.`,
          confidence: "high",
          evidenceType: "analysis-gap",
          evidence: [{ kind: "simulation", summary: String((err as Error).message) }],
        });
        return finish(mine.findings);
      }

      const theirs = report.findings.map((f) => toFinding(f, report));
      // His engine only matches the origin domain for signature requests; do it for transactions too.
      if (his.type === "transaction" && !theirs.some((f) => f.ruleId === "swastik.documented_phishing_domain")) {
        for (const m of threats.matchDomain(input.request.origin)) {
          theirs.unshift({
            id: `swastik.phishing-domain.${m.id}`,
            ruleId: "swastik.documented_phishing_domain",
            severity: "critical",
            title: `${m.isDemo ? "[DEMO ONLY] " : ""}Request comes from a documented phishing domain`,
            description: `${input.request.origin} matches "${m.matchValue}" (${m.label}).`,
            explanation: `The website making this request (${input.request.origin}) is listed as a phishing domain (${m.label}, source: ${m.sourceUrl}). Close the page and do not sign anything from it.`,
            confidence: m.confidence,
            evidenceType: "threat-domain",
            evidence: [{ kind: "domain", summary: `origin matches ${m.matchValue}`, data: { record: m.record } }],
          });
        }
      }
      const extra = mine.findings.filter((f) => !COVERED_BY_SWASTIK.has(f.ruleId));
      return finish([...theirs, ...extra], report.overallSeverity);
    },
  };
}
