import { encodeFunctionData, parseEther } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Simulator } from "../../src";
import { SimulationError } from "../../src/errors";
import { anvilAvailable, FRIEND, startUpstream, type Upstream } from "./harness";

const hasAnvil = anvilAvailable();

/** A port nothing is listening on, so the fork's first upstream fails the way a dead RPC does. */
const DEAD = "http://127.0.0.1:1";
const ALSO_DEAD = "http://127.0.0.1:2";

describe.skipIf(!hasAnvil)("upstream failover", () => {
  let up: Upstream;
  let sim: Simulator;

  const transfer = () =>
    encodeFunctionData({ abi: up.abis.TestERC20!, functionName: "transfer", args: [FRIEND, parseEther("100")] });

  beforeAll(async () => {
    up = await startUpstream();
    sim = new Simulator({
      chains: [{ chainId: up.chainId, name: "local upstream", rpcUrl: DEAD, fallbackRpcUrls: [up.url], blockLag: 0 }],
      maxConcurrentForks: 2,
      forkStartupTimeoutMs: 10_000,
    });
  }, 120_000);

  afterAll(async () => {
    await sim?.close();
    up?.stop();
  });

  it("analyses through the fallback when the primary upstream is unreachable", async () => {
    const r = await sim.simulateTransaction({
      chainId: up.chainId,
      tx: { from: up.victim, to: up.addresses.token, data: transfer() },
    });
    expect(r.outcome).toBe("success");
    expect(r.fork.verified).toBe(true);
    expect(r.immediateChanges.some((c) => c.kind === "erc20-balance")).toBe(true);
  }, 120_000);

  it("keeps using the healthy upstream once the primary is parked", async () => {
    const started = Date.now();
    const r = await sim.simulateTransaction({
      chainId: up.chainId,
      tx: { from: up.victim, to: up.addresses.token, data: transfer() },
    });
    expect(r.outcome).toBe("success");
    // The dead endpoint is in cooldown, so this run must not pay for it again.
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it("reports the reachable endpoint from a readiness check", async () => {
    const check = await sim.checkUpstream(up.chainId);
    expect(check.ok).toBe(true);
    expect(check.endpoints).toBe(2);
    expect(check.endpoint).toBe(new URL(up.url).host);
  }, 60_000);

  it("fails with every upstream named once none of them work", async () => {
    const broken = new Simulator({
      chains: [{ chainId: up.chainId, name: "broken chain", rpcUrl: DEAD, fallbackRpcUrls: [ALSO_DEAD], blockLag: 0 }],
      maxConcurrentForks: 1,
      forkStartupTimeoutMs: 5_000,
    });
    try {
      const err = await broken
        .simulateTransaction({ chainId: up.chainId, tx: { from: up.victim, to: up.addresses.token, data: transfer() } })
        .then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(SimulationError);
      expect((err as SimulationError).code).toBe("UPSTREAM_UNAVAILABLE");
      expect((err as SimulationError).message).toContain("127.0.0.1:1");
      expect((err as SimulationError).message).toContain("127.0.0.1:2");
    } finally {
      await broken.close();
    }
  }, 180_000);
});
