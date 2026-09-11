import type { FastifyInstance } from "fastify";
import { encodeFunctionData, maxUint256, parseEther, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalysisReportSchema, type AnalysisReport, type AnalyzeRequest } from "@cognitia/shared";
import { Simulator } from "@cognitia/simulator";
import { anvilAvailable, ATTACKER, FRIEND, startUpstream, type Upstream } from "@cognitia/simulator/testing";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { baselineEngine } from "../src/engine";

describe.skipIf(!anvilAvailable())("POST /v1/analyze end to end (local upstream chain)", () => {
  let up: Upstream;
  let sim: Simulator;
  let app: FastifyInstance;
  let n = 0;

  const request = (method: string, params: unknown[], chainId = 31337): AnalyzeRequest => ({
    requestId: `t${++n}`,
    origin: "https://claim-rewards.example",
    chainId,
    account: up.victim,
    method,
    params,
  });
  const sendTx = (to: Address, data: Hex, value?: bigint) =>
    request("eth_sendTransaction", [{ from: up.victim, to, data, ...(value ? { value: `0x${value.toString(16)}` } : {}) }]);
  const call = (abi: string, fn: string, args: unknown[] = []) => encodeFunctionData({ abi: up.abis[abi]!, functionName: fn, args });

  async function analyze(body: AnalyzeRequest): Promise<AnalysisReport> {
    const res = await app.inject({ method: "POST", url: "/v1/analyze", payload: body });
    expect(res.statusCode).toBe(200);
    return AnalysisReportSchema.parse(res.json());
  }

  beforeAll(async () => {
    up = await startUpstream();
    const config = { ...loadConfig({}), logLevel: "warn", chains: [{ chainId: 31337, name: "Local upstream", rpcUrl: up.url, blockLag: 0 }] };
    sim = new Simulator({ chains: config.chains });
    app = await buildApp({ config, simulator: sim, engine: baselineEngine });
  });

  afterAll(async () => {
    await app?.close();
    await sim?.close();
    up?.stop();
  });

  it("benign transfer: low observed risk, complete", async () => {
    const r = await analyze(sendTx(up.addresses.token, call("TestERC20", "transfer", [FRIEND, parseEther("25")])));
    expect(r).toMatchObject({ status: "complete", severity: "low" });
    expect(r.findings[0]?.ruleId).toBe("transfer.expected");
    expect(r.summary).toMatch(/Sends 25 TUSD/);
  });

  it("fake NFT claim (setApprovalForAll): high, operator false → true, conditional takeover", async () => {
    const r = await analyze(sendTx(up.addresses.nft, call("TestERC721", "setApprovalForAll", [ATTACKER, true])));
    expect(r.severity).toBe("high");
    expect(r.findings[0]?.ruleId).toBe("approval.operator-all");
    expect(r.immediateChanges).toEqual([expect.objectContaining({ kind: "operator-approval", before: false, after: true, timing: "immediate" })]);
    expect(r.conditionalChanges.filter((c) => c.kind === "erc721-owner")).toHaveLength(3);
    expect(r.conditionalChanges.every((c) => c.timing === "conditional")).toBe(true);
  });

  it("unlimited ERC-20 approval: zero immediate loss, high exposure", async () => {
    const r = await analyze(sendTx(up.addresses.token, call("TestERC20", "approve", [ATTACKER, maxUint256])));
    expect(r.severity).toBe("high");
    expect(r.immediateChanges.some((c) => c.kind === "erc20-balance")).toBe(false);
    expect(r.potentialExposure[0]).toMatchObject({ unlimited: true, atRisk: { erc20Balance: parseEther("1000").toString() } });
  });

  it("misleading claim(): hidden outflow flagged critical", async () => {
    const r = await analyze(sendTx(up.addresses.drainer, call("TestDrainer", "claim", [up.addresses.token])));
    expect(r.severity).toBe("critical");
    const f = r.findings.find((x) => x.ruleId === "transfer.hidden-outflow");
    expect(f?.title).toMatch(/500 TUSD/);
    expect(r.intent?.known).toBe(false);
  });

  it("unsigned ERC-2612 permit: conditional outcome, clearly labelled", async () => {
    const typed = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      domain: { name: "Test USD", version: "1", chainId: 31337, verifyingContract: up.addresses.token },
      message: { owner: up.victim, spender: ATTACKER, value: maxUint256.toString(), nonce: "0", deadline: "99999999999" },
    };
    const r = await analyze(request("eth_signTypedData_v4", [up.victim, JSON.stringify(typed)]));
    expect(r.simulation.mode).toBe("conditional-signature");
    expect(r.simulation.assumptions.join(" ")).toMatch(/Conditional outcome if this signature is signed and accepted/);
    expect(r.immediateChanges).toHaveLength(0);
    expect(r.conditionalChanges.find((c) => c.kind === "erc20-balance" && c.account.toLowerCase() === up.victim.toLowerCase())).toMatchObject({
      delta: (-parseEther("1000")).toString(),
    });
    expect(r.severity).toBe("high");
    expect(r.simulation.signatureChecks?.every((c) => c.status === "pass")).toBe(true);
  });

  it("revert: reported as expected failure", async () => {
    const r = await analyze(sendTx(up.addresses.drainer, call("TestDrainer", "claimClosed")));
    expect(r.simulation).toMatchObject({ outcome: "revert", revertReason: "Rewards period has ended" });
    expect(r.severity).toBe("medium");
  });

  it("personal_sign: partial, never low", async () => {
    const r = await analyze(request("personal_sign", ["0x48656c6c6f", up.victim]));
    expect(r.status).toBe("partial");
    expect(r.severity).toBe("unknown");
  });

  it("unconfigured chain: Analysis unavailable", async () => {
    const r = await analyze(request("eth_sendTransaction", [{ from: up.victim, to: up.addresses.token, data: "0x" }], 1));
    expect(r).toMatchObject({ status: "failed", severity: "unknown", fork: null });
  });

  it("replays a mined transaction against the state before it", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/replay", payload: { chainId: 31337, txHash: up.seedApprovalTx } });
    expect(res.statusCode).toBe(200);
    const { report } = res.json() as { report: AnalysisReport };
    expect(report.immediateChanges).toEqual([expect.objectContaining({ kind: "erc20-allowance", before: "0", after: parseEther("500").toString() })]);
    expect(report.simulation.assumptions[0]).toMatch(/Replay of mined transaction/);
  });

  it("rejects malformed bodies with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/analyze", payload: { requestId: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
