import { describe, expect, it } from "vitest";
import { chainsFromEnv } from "../../src/chains";
import { SimulationError } from "../../src/errors";
import { UpstreamRotation, isUpstreamFailure, parseUpstreamList, upstreamLabel, upstreamsOf } from "../../src/upstreams";

const A = "https://a.example/rpc";
const B = "https://b.example/rpc";
const C = "https://c.example/rpc";

describe("UpstreamRotation", () => {
  it("prefers the configured order while every endpoint is healthy", () => {
    const r = new UpstreamRotation([A, B, C]);
    expect(r.order()).toEqual([A, B, C]);
    expect(r.current()).toBe(A);
  });

  it("moves a parked endpoint behind the healthy ones without dropping it", () => {
    const r = new UpstreamRotation([A, B, C], 60_000);
    r.park(A);
    expect(r.current()).toBe(B);
    expect(r.order()).toEqual([B, C, A]);
  });

  it("restores an endpoint once its cooldown expires", () => {
    const r = new UpstreamRotation([A, B], 1_000);
    const t0 = 10_000;
    r.park(A, t0);
    expect(r.current(t0 + 500)).toBe(B);
    expect(r.current(t0 + 1_500)).toBe(A);
  });

  it("clears a park when the endpoint succeeds again", () => {
    const r = new UpstreamRotation([A, B]);
    r.park(A);
    r.clear(A);
    expect(r.current()).toBe(A);
  });

  it("still returns every endpoint when all of them are parked", () => {
    const r = new UpstreamRotation([A, B]);
    r.park(A);
    r.park(B);
    expect(r.allParked()).toBe(true);
    expect(r.order()).toEqual([A, B]);
  });

  it("refuses an empty endpoint list", () => {
    expect(() => new UpstreamRotation([])).toThrow(/at least one endpoint/);
  });
});

describe("upstream helpers", () => {
  it("puts the primary first and drops duplicates", () => {
    expect(upstreamsOf({ rpcUrl: A, fallbackRpcUrls: [B, A] })).toEqual([A, B]);
    expect(upstreamsOf({ rpcUrl: A })).toEqual([A]);
  });

  it("parses comma- and whitespace-separated endpoint lists", () => {
    expect(parseUpstreamList(` ${A} , ${B} `)).toEqual([A, B]);
    expect(parseUpstreamList(`${A}\n${B}`)).toEqual([A, B]);
    expect(parseUpstreamList("")).toEqual([]);
  });

  it("reports the host only, so a keyed URL is never logged whole", () => {
    expect(upstreamLabel("https://eth-mainnet.g.alchemy.com/v2/secret-key")).toBe("eth-mainnet.g.alchemy.com");
    expect(upstreamLabel("not a url")).toBe("invalid-url");
  });
});

describe("isUpstreamFailure", () => {
  it("rotates on upstream faults", () => {
    expect(isUpstreamFailure(new SimulationError("FORK_FAILED", "anvil exited"))).toBe(true);
    expect(isUpstreamFailure(new SimulationError("UPSTREAM_UNAVAILABLE", "down"))).toBe(true);
    expect(isUpstreamFailure(new SimulationError("CHAIN_MISMATCH", "serves chain 5"))).toBe(true);
    expect(isUpstreamFailure(new Error("HTTP 429 Too Many Requests"))).toBe(true);
    expect(isUpstreamFailure(new Error("request timed out"))).toBe(true);
    expect(isUpstreamFailure(new Error("connect ECONNREFUSED 1.2.3.4:443"))).toBe(true);
  });

  it("does not rotate on local faults", () => {
    expect(isUpstreamFailure(new SimulationError("ANVIL_NOT_FOUND", "no anvil"))).toBe(false);
    expect(isUpstreamFailure(new SimulationError("BUSY", "at capacity"))).toBe(false);
    expect(isUpstreamFailure(new SimulationError("ABORTED", "timeout"))).toBe(false);
    expect(isUpstreamFailure(new SimulationError("INVALID_INPUT", "bad calldata"))).toBe(false);
    expect(isUpstreamFailure(new Error("execution reverted"))).toBe(false);
  });
});

describe("chainsFromEnv", () => {
  it("ships keyless fallbacks for the public chains", () => {
    const mainnet = chainsFromEnv({} as NodeJS.ProcessEnv).find((c) => c.chainId === 1)!;
    expect(mainnet.rpcUrl).toMatch(/^https:/);
    expect(upstreamsOf(mainnet).length).toBeGreaterThan(1);
    // The local chain has no public alternative, so it stays a single endpoint.
    const local = chainsFromEnv({} as NodeJS.ProcessEnv).find((c) => c.chainId === 31337)!;
    expect(upstreamsOf(local)).toEqual(["http://127.0.0.1:8545"]);
  });

  it("takes a whole ordered list from one RPC_URL_<id>", () => {
    const [chain] = chainsFromEnv({ SIM_CHAINS: "1", RPC_URL_1: `${A},${B}` } as NodeJS.ProcessEnv);
    expect(upstreamsOf(chain!)).toEqual([A, B]);
  });

  it("replaces the built-in fallbacks when a single URL is configured", () => {
    const [chain] = chainsFromEnv({ SIM_CHAINS: "1", RPC_URL_1: A } as NodeJS.ProcessEnv);
    expect(upstreamsOf(chain!)).toEqual([A]);
  });

  it("adds an unknown chain and keeps its overrides", () => {
    const chains = chainsFromEnv({ RPC_URL_137: `${A} ${B}`, CHAIN_NAME_137: "Polygon", BLOCK_LAG_137: "5" } as NodeJS.ProcessEnv);
    const polygon = chains.find((c) => c.chainId === 137)!;
    expect(polygon.name).toBe("Polygon");
    expect(polygon.blockLag).toBe(5);
    expect(upstreamsOf(polygon)).toEqual([A, B]);
  });

  it("ignores an empty override", () => {
    const [chain] = chainsFromEnv({ SIM_CHAINS: "1", RPC_URL_1: "  " } as NodeJS.ProcessEnv);
    expect(chain!.rpcUrl).toMatch(/publicnode/);
  });
});
