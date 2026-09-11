import {
  computeRequestHash,
  type AnalysisReport,
  type AnalyzeRequest,
  type Assessment,
  type DecodeResult,
  type NormalizedRequest,
  type RiskEngine,
  type SimulationResult,
} from "@cognitia/shared";
import { SIMULATOR_VERSION, SimulationError, type Simulator } from "@cognitia/simulator";
import { normalizeRequest } from "./normalize";
import { wireChange, wireExposure, wireFinding } from "./wire";

export type AnalyzerDeps = {
  simulator: Pick<Simulator, "simulateTransaction" | "simulateConditional" | "supportedChains">;
  engine: RiskEngine;
  timeoutMs: number;
};

export type AnalyzeOptions = {
  /** Pin the fork to this block instead of head − lag (replays, reproducible demos). */
  blockNumber?: bigint;
  extraAssumptions?: string[];
};

class Timeout extends Error {}

function withDeadline<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Timeout());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Timeout());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function describeSimulationError(err: unknown, deps: AnalyzerDeps, timeoutMs: number): string {
  if (err instanceof Timeout || (err instanceof SimulationError && err.code === "ABORTED")) {
    return `analysis timed out after ${Math.round(timeoutMs / 1000)}s`;
  }
  if (err instanceof SimulationError) {
    if (err.code === "UNSUPPORTED_CHAIN") {
      const names = deps.simulator.supportedChains.map((c) => `${c.name} (${c.chainId})`).join(", ");
      return `${err.message}; supported: ${names || "none"}`;
    }
    if (err.code === "BUSY") return "the simulator is at capacity — try again in a moment";
    return err.message;
  }
  return (err as Error)?.message ?? String(err);
}

/** normalize → decode → simulate → compare → assess → report. Never throws; failures become reports. */
export async function analyze(req: AnalyzeRequest, deps: AnalyzerDeps, opts: AnalyzeOptions = {}): Promise<AnalysisReport> {
  const started = Date.now();
  const requestHash = computeRequestHash(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const engineName = `${deps.engine.name}@${deps.engine.version}`;

  try {
    const normalized = normalizeRequest(req);
    const decoded = await withDeadline(deps.engine.decode(req, normalized), controller.signal);

    let simulation: SimulationResult | undefined;
    let simulationError: string | undefined;
    try {
      if (normalized.kind === "transaction") {
        simulation = await withDeadline(
          deps.simulator.simulateTransaction({
            chainId: req.chainId,
            tx: normalized.tx,
            blockNumber: opts.blockNumber,
            hints: decoded.hints,
            signal: controller.signal,
          }),
          controller.signal,
        );
      } else if (decoded.conditional) {
        simulation = await withDeadline(
          deps.simulator.simulateConditional({
            chainId: req.chainId,
            authorization: decoded.conditional,
            blockNumber: opts.blockNumber,
            hints: decoded.hints,
            signal: controller.signal,
          }),
          controller.signal,
        );
      }
    } catch (err) {
      simulationError = describeSimulationError(err, deps, deps.timeoutMs);
    }

    const assessment = await deps.engine.assess({ request: req, normalized, decoded, simulation, simulationError });
    return buildReport({ req, requestHash, normalized, decoded, simulation, simulationError, assessment, started, engineName, extraAssumptions: opts.extraAssumptions });
  } catch (err) {
    return failedReport(req, requestHash, describeSimulationError(err, deps, deps.timeoutMs), started, engineName);
  } finally {
    clearTimeout(timer);
  }
}

type BuildInput = {
  req: AnalyzeRequest;
  requestHash: `0x${string}`;
  normalized: NormalizedRequest;
  decoded: DecodeResult;
  simulation?: SimulationResult;
  simulationError?: string;
  assessment: Assessment;
  started: number;
  engineName: string;
  extraAssumptions?: string[];
};

export function buildReport(b: BuildInput): AnalysisReport {
  const { simulation: sim, normalized, decoded } = b;
  const needsSimulation = normalized.kind === "transaction" || !!decoded.conditional;

  let status: AnalysisReport["status"];
  if (normalized.kind === "unsupported" || (needsSimulation && !sim)) status = "failed";
  else if (!sim || sim.outcome === "not-executed" || sim.coverage.complete === false) status = "partial";
  else status = "complete";

  // A report that is not complete must never read as "low risk".
  let severity = b.assessment.severity;
  if (status !== "complete" && severity === "low") severity = "unknown";
  const summary = severity === b.assessment.severity ? b.assessment.summary : `UNKNOWN RISK — ${b.assessment.summary.replace(/^[A-Z ]+ — /, "")}`;
  const tokens = sim?.tokens ?? [];

  return {
    requestId: b.req.requestId,
    requestHash: b.requestHash,
    status,
    severity,
    summary: status === "failed" && !sim ? `ANALYSIS UNAVAILABLE — ${b.simulationError ?? (normalized.kind === "unsupported" ? normalized.reason : "not simulated")}` : summary,
    fork: sim?.fork ?? null,
    simulation: {
      mode: sim?.mode ?? "unsupported",
      outcome: sim?.outcome ?? "not-executed",
      assumptions: [...(b.extraAssumptions ?? []), ...normalized.warnings, ...(sim?.assumptions ?? [])],
      revertReason: sim?.revertReason,
      error: b.simulationError ?? sim?.error,
      gas: sim?.gas,
      signatureChecks: sim?.signatureChecks,
    },
    intent: decoded.intent,
    findings: b.assessment.findings.map(wireFinding),
    immediateChanges: (sim?.immediateChanges ?? []).map((c) => wireChange(c, tokens)),
    conditionalChanges: (sim?.conditional?.changes ?? []).map((c) => wireChange(c, tokens)),
    potentialExposure: (sim?.exposures ?? []).map((e) => wireExposure(e, tokens)),
    assetFlows: [...(sim?.assetFlows ?? []), ...(sim?.conditional?.assetFlows ?? [])],
    tokens,
    coverage: sim?.coverage ?? { checked: [], missing: [b.simulationError ?? "request was not simulated"], complete: false },
    analyzedAt: new Date().toISOString(),
    durationMs: Date.now() - b.started,
    engine: { simulator: `simulator@${SIMULATOR_VERSION}`, riskEngine: b.engineName },
  };
}

export function failedReport(req: AnalyzeRequest, requestHash: `0x${string}`, reason: string, started: number, engineName: string): AnalysisReport {
  return {
    requestId: req.requestId,
    requestHash,
    status: "failed",
    severity: "unknown",
    summary: `ANALYSIS UNAVAILABLE — ${reason}`,
    fork: null,
    simulation: { mode: "unsupported", outcome: "not-executed", assumptions: [], error: reason },
    findings: [
      {
        id: "analysis.unavailable#0",
        ruleId: "analysis.unavailable",
        severity: "unknown",
        title: "Analysis unavailable",
        description: `The request could not be analysed: ${reason}`,
        explanation: `The request could not be analysed (${reason}). Nothing about its effect is known — do not treat it as safe.`,
        confidence: "high",
        evidenceType: "analysis-gap",
        evidence: [{ kind: "simulation", summary: reason }],
      },
    ],
    immediateChanges: [],
    conditionalChanges: [],
    potentialExposure: [],
    assetFlows: [],
    tokens: [],
    coverage: { checked: [], missing: [reason], complete: false },
    analyzedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    engine: { simulator: `simulator@${SIMULATOR_VERSION}`, riskEngine: engineName },
  };
}
