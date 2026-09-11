import { describe, expect, it } from "vitest";
import { AnalysisReportSchema, type AnalyzeRequest, type SimulationResult } from "@cognitia/shared";
import { SimulationError } from "@cognitia/simulator";
import { baselineEngine } from "../src/engine";
import { analyze, type AnalyzerDeps } from "../src/pipeline/analyze";

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const req: AnalyzeRequest = {
  requestId: "r1",
  origin: "https://claim.example",
  chainId: 11155111,
  account: ACCOUNT,
  method: "eth_sendTransaction",
  params: [{ from: ACCOUNT, to: "0x5FbDB2315678afecb367f032d93F642f64180aa3", data: "0xa9059cbb" + "0".repeat(128) }],
};

function deps(simulate: () => Promise<SimulationResult>, timeoutMs = 5_000): AnalyzerDeps {
  return {
    engine: baselineEngine,
    timeoutMs,
    simulator: {
      simulateTransaction: simulate,
      simulateConditional: simulate,
      supportedChains: [{ chainId: 11155111, name: "Sepolia", rpcUrl: "http://x" }],
    } as unknown as AnalyzerDeps["simulator"],
  };
}

const partialSim = (over: Partial<SimulationResult>): SimulationResult => ({
  mode: "transaction",
  fork: { chainId: 11155111, blockNumber: "1", blockHash: `0x${"ab".repeat(32)}`, verified: true },
  outcome: "success",
  steps: [],
  immediateChanges: [],
  assetFlows: [],
  exposures: [],
  calls: [],
  accounts: [],
  tokens: [],
  assumptions: [],
  coverage: { checked: [], missing: [], complete: true },
  durationMs: 1,
  ...over,
});

describe("analyze pipeline guarantees", () => {
  it("returns a failed, unknown-severity report when simulation throws", async () => {
    const r = await analyze(req, deps(() => Promise.reject(new SimulationError("UPSTREAM_UNAVAILABLE", "rpc down"))));
    expect(AnalysisReportSchema.parse(r)).toBeTruthy();
    expect(r).toMatchObject({ status: "failed", severity: "unknown" });
    expect(r.summary).toMatch(/ANALYSIS UNAVAILABLE/);
    expect(r.findings.some((f) => f.ruleId === "analysis.unavailable")).toBe(true);
  });

  it("times out to 'Analysis unavailable', never to a green result", async () => {
    const r = await analyze(req, deps(() => new Promise(() => {}), 200));
    expect(r).toMatchObject({ status: "failed", severity: "unknown" });
    expect(r.summary).toMatch(/timed out/);
  });

  it("never reports low severity when coverage is incomplete", async () => {
    const r = await analyze(req, deps(async () => partialSim({ coverage: { checked: [], missing: ["balance read failed"], complete: false } })));
    expect(r.status).toBe("partial");
    expect(r.severity).toBe("unknown");
  });

  it("reports low observed risk only for complete simulations", async () => {
    const r = await analyze(req, deps(async () => partialSim({})));
    expect(r).toMatchObject({ status: "complete", severity: "low" });
  });

  it("names supported chains when a chain is not configured", async () => {
    const r = await analyze({ ...req, chainId: 999 }, deps(() => Promise.reject(new SimulationError("UNSUPPORTED_CHAIN", "chain 999 is not configured"))));
    expect(r.summary).toMatch(/Sepolia \(11155111\)/);
  });

  it("binds the report to the request hash", async () => {
    const a = await analyze(req, deps(async () => partialSim({})));
    const b = await analyze({ ...req, params: [{ ...(req.params[0] as object), value: "0x1" }] }, deps(async () => partialSim({})));
    expect(a.requestHash).not.toBe(b.requestHash);
  });

  it("fails unsupported methods without calling the simulator", async () => {
    let called = false;
    const r = await analyze({ ...req, method: "wallet_sendCalls" }, deps(async () => ((called = true), partialSim({}))));
    expect(called).toBe(false);
    expect(r).toMatchObject({ status: "failed", severity: "unknown" });
  });
});
