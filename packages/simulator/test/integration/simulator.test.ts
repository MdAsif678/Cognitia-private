import { encodeFunctionData, maxUint256, parseEther, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimulationResultSchema, type SimulationResult, type StateChange } from "@cognitia/shared";
import { Simulator } from "../../src";
import { anvilAvailable, ATTACKER, FRIEND, startUpstream, type Upstream } from "./harness";

const hasAnvil = anvilAvailable();

describe.skipIf(!hasAnvil)("simulator against a forked chain", () => {
  let up: Upstream;
  let sim: Simulator;
  let headAfterSetup: bigint;

  const call = (contract: keyof Upstream["addresses"], abiName: string, functionName: string, args: unknown[] = []): Hex =>
    encodeFunctionData({ abi: up.abis[abiName]!, functionName, args });

  const simulate = (to: Address, data: Hex, extra: { value?: bigint; blockNumber?: bigint } = {}) =>
    sim.simulateTransaction({
      chainId: up.chainId,
      tx: { from: up.victim, to, data, value: extra.value?.toString() },
      blockNumber: extra.blockNumber,
    });

  const find = <K extends StateChange["kind"]>(r: SimulationResult | StateChange[], kind: K, pred: (c: Extract<StateChange, { kind: K }>) => boolean = () => true) =>
    (Array.isArray(r) ? r : r.immediateChanges).filter((c): c is Extract<StateChange, { kind: K }> => c.kind === kind && pred(c as Extract<StateChange, { kind: K }>));

  const lc = (a: string) => a.toLowerCase();

  beforeAll(async () => {
    up = await startUpstream();
    headAfterSetup = await up.publicClient.getBlockNumber({ cacheTime: 0 });
    sim = new Simulator({ chains: [{ chainId: up.chainId, name: "local upstream", rpcUrl: up.url, blockLag: 0 }], maxConcurrentForks: 4 });
  }, 120_000);

  afterAll(async () => {
    await sim?.close();
    up?.stop();
  });

  it("reports an ERC-20 transfer as balance changes with an outflow", async () => {
    const r = await simulate(up.addresses.token, call("token", "TestERC20", "transfer", [FRIEND, parseEther("100")]));
    expect(SimulationResultSchema.parse(r)).toBeTruthy();
    expect(r.outcome).toBe("success");
    expect(r.fork.verified).toBe(true);
    const bal = find(r, "erc20-balance");
    expect(bal.find((c) => lc(c.account) === lc(up.victim))?.delta).toBe((-parseEther("100")).toString());
    expect(bal.find((c) => lc(c.account) === lc(FRIEND))?.delta).toBe(parseEther("100").toString());
    expect(r.assetFlows).toHaveLength(1);
    expect(r.exposures).toHaveLength(0);
    expect(r.tokens.find((t) => lc(t.address) === lc(up.addresses.token))).toMatchObject({ standard: "erc20", symbol: "TUSD", decimals: 18 });
  });

  it("reports an unlimited approval: zero immediate loss, full exposure, conditional drain", async () => {
    const r = await simulate(up.addresses.token, call("token", "TestERC20", "approve", [ATTACKER, maxUint256]));
    expect(find(r, "erc20-balance")).toHaveLength(0);
    const allowance = find(r, "erc20-allowance")[0]!;
    expect(allowance).toMatchObject({ before: "0", after: maxUint256.toString(), unlimitedAfter: true, timing: "immediate" });
    expect(r.exposures[0]).toMatchObject({ kind: "erc20-allowance", basis: "granted", unlimited: true, exceedsTotalSupply: true });
    expect(r.exposures[0]!.atRisk.erc20Balance).toBe(parseEther("1000").toString());

    expect(r.conditional).toBeDefined();
    expect(r.conditional!.steps[0]!.outcome).toBe("success");
    const loss = find(r.conditional!.changes, "erc20-balance", (c) => lc(c.account) === lc(up.victim))[0]!;
    expect(loss).toMatchObject({ delta: (-parseEther("1000")).toString(), timing: "conditional" });
  });

  it("reports setApprovalForAll as an operator approval with enumerated NFTs at risk", async () => {
    const r = await simulate(up.addresses.nft, call("nft", "TestERC721", "setApprovalForAll", [ATTACKER, true]));
    expect(find(r, "operator-approval")[0]).toMatchObject({ standard: "erc721", before: false, after: true });
    expect(find(r, "erc721-owner")).toHaveLength(0);
    const exposure = r.exposures[0]!;
    expect(exposure).toMatchObject({ kind: "operator-approval", unlimited: true });
    expect(exposure.atRisk.nftCount).toBe("3");
    expect(exposure.atRisk.tokenIds?.sort()).toEqual(["1", "2", "3"]);

    const moved = find(r.conditional!.changes, "erc721-owner");
    expect(moved).toHaveLength(3);
    for (const m of moved) expect(lc(m.after!)).toBe(lc(ATTACKER));
  });

  it("simulates the follow-up when the approved spender is a contract", async () => {
    const r = await simulate(up.addresses.token, call("token", "TestERC20", "approve", [up.addresses.drainer, maxUint256]));
    expect(r.accounts.find((a) => lc(a.address) === lc(up.addresses.drainer))?.isContract).toBe(true);
    expect(r.conditional!.steps[0]!.outcome).toBe("success");
    expect(find(r.conditional!.changes, "erc20-balance", (c) => lc(c.account) === lc(up.addresses.drainer))[0]?.delta).toBe(parseEther("1000").toString());
  });

  it("reports a single ERC-721 approve", async () => {
    const r = await simulate(up.addresses.nft, call("nft", "TestERC721", "approve", [ATTACKER, 2n]));
    expect(find(r, "erc721-token-approval")[0]).toMatchObject({ tokenId: "2", before: null });
    expect(r.exposures[0]).toMatchObject({ kind: "erc721-token-approval", tokenId: "2" });
    expect(find(r.conditional!.changes, "erc721-owner")[0]).toMatchObject({ tokenId: "2" });
  });

  it("reports an ERC-1155 batch transfer per token id", async () => {
    const r = await simulate(up.addresses.multi, call("multi", "TestERC1155", "safeBatchTransferFrom", [up.victim, FRIEND, [7n, 8n], [10n, 5n], "0x"]));
    const changes = find(r, "erc1155-balance");
    expect(changes).toHaveLength(4);
    expect(changes.find((c) => c.tokenId === "7" && lc(c.account) === lc(up.victim))?.delta).toBe("-10");
    expect(changes.find((c) => c.tokenId === "8" && lc(c.account) === lc(FRIEND))?.delta).toBe("5");
    expect(r.assetFlows.filter((f) => f.standard === "erc1155")).toHaveLength(2);
  });

  it("finds a hidden transferFrom inside a misleading claim() via the trace", async () => {
    const r = await simulate(up.addresses.drainer, call("drainer", "TestDrainer", "claim", [up.addresses.token]));
    expect(r.outcome).toBe("success");
    const bal = find(r, "erc20-balance");
    expect(bal.find((c) => lc(c.account) === lc(up.victim))?.delta).toBe((-parseEther("500")).toString());
    expect(bal.find((c) => lc(c.account) === lc(ATTACKER))?.delta).toBe(parseEther("500").toString());
    // No Approval event is emitted: the allowance change is found from the trace.
    expect(find(r, "erc20-allowance")[0]).toMatchObject({ before: parseEther("500").toString(), after: "0" });
    expect(r.calls.some((c) => c.selector === "0x23b872dd" && c.depth === 1)).toBe(true);
  });

  it("reports a revert with its reason and no state changes", async () => {
    const r = await simulate(up.addresses.drainer, call("drainer", "TestDrainer", "claimClosed"));
    expect(r.outcome).toBe("revert");
    expect(r.revertReason).toBe("Rewards period has ended");
    expect(r.immediateChanges).toHaveLength(0);
  });

  it("separates transferred native value from gas", async () => {
    const r = await simulate(up.addresses.drainer, call("drainer", "TestDrainer", "claimWithFee"), { value: parseEther("1") });
    const native = find(r, "native-balance");
    expect(native.find((c) => lc(c.account) === lc(up.victim))?.delta).toBe((-parseEther("1")).toString());
    expect(native.find((c) => lc(c.account) === lc(ATTACKER))?.delta).toBe(parseEther("1").toString());
    expect(r.assetFlows.filter((f) => f.standard === "native")).toHaveLength(2);
    expect(BigInt(r.gas!.used)).toBeGreaterThan(21_000n);
    expect(r.gas!.estimatedFeeWei).toBeDefined();
  });

  it("surfaces delegatecalls in the call list", async () => {
    const r = await simulate(up.addresses.delegator, call("drainer", "TestDrainer", "claimWithFee"), { value: 1n });
    const dc = r.calls.find((c) => c.type === "DELEGATECALL");
    expect(dc && lc(dc.to!)).toBe(lc(up.addresses.drainer));
    expect(find(r, "native-balance", (c) => lc(c.account) === lc(ATTACKER))[0]?.delta).toBe("1");
  });

  it("pins the fork to a requested historical block", async () => {
    const r = await simulate(up.addresses.drainer, call("drainer", "TestDrainer", "claim", [up.addresses.token]), { blockNumber: up.blockBeforeSeed });
    expect(r.fork.blockNumber).toBe(up.blockBeforeSeed.toString());
    // Before the allowance was seeded, claim() pulls 0 tokens.
    expect(find(r, "erc20-balance")).toHaveLength(0);
  });

  it("models an unsigned ERC-2612 permit as a labelled conditional outcome", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const r = await sim.simulateConditional({
      chainId: up.chainId,
      authorization: {
        kind: "erc20-allowance",
        source: "erc2612-permit",
        token: up.addresses.token,
        owner: up.victim,
        spender: ATTACKER,
        amount: maxUint256.toString(),
        nonce: "0",
        deadline: deadline.toString(),
        domain: { name: "Test USD", version: "1", chainId: up.chainId, verifyingContract: up.addresses.token },
      },
    });
    expect(SimulationResultSchema.parse(r)).toBeTruthy();
    expect(r.mode).toBe("conditional-signature");
    expect(r.immediateChanges).toHaveLength(0);
    expect(r.assumptions[0]).toMatch(/Conditional outcome/);
    expect(r.signatureChecks?.every((c) => c.status === "pass")).toBe(true);
    expect(r.exposures[0]).toMatchObject({ basis: "conditional-signature", unlimited: true });
    const loss = find(r.conditional!.changes, "erc20-balance", (c) => lc(c.account) === lc(up.victim))[0]!;
    expect(loss.delta).toBe((-parseEther("1000")).toString());
  });

  it("flags permit messages that do not match live state", async () => {
    const r = await sim.simulateConditional({
      chainId: up.chainId,
      authorization: {
        kind: "erc20-allowance",
        source: "erc2612-permit",
        token: up.addresses.token,
        owner: up.victim,
        spender: ATTACKER,
        amount: "1",
        nonce: "5",
        deadline: "1",
        domain: { name: "Fake Name", version: "1", chainId: 1, verifyingContract: up.addresses.token },
      },
    });
    const status = Object.fromEntries(r.signatureChecks!.map((c) => [c.name, c.status]));
    expect(status).toMatchObject({ nonce: "fail", deadline: "fail", "chain-id": "fail", "domain-separator": "fail" });
  });

  it("keeps concurrent simulations isolated", async () => {
    const [a, b, c] = await Promise.all([
      simulate(up.addresses.token, call("token", "TestERC20", "approve", [FRIEND, 1n])),
      simulate(up.addresses.token, call("token", "TestERC20", "transfer", [FRIEND, parseEther("7")])),
      simulate(up.addresses.drainer, call("drainer", "TestDrainer", "claim", [up.addresses.token])),
    ]);
    expect(find(a!, "erc20-balance")).toHaveLength(0);
    expect(find(a!, "erc20-allowance")[0]?.after).toBe("1");
    expect(find(b!, "erc20-allowance")).toHaveLength(0);
    expect(find(b!, "erc20-balance", (x) => lc(x.account) === lc(up.victim))[0]?.delta).toBe((-parseEther("7")).toString());
    expect(find(c!, "erc20-balance", (x) => lc(x.account) === lc(up.victim))[0]?.delta).toBe((-parseEther("500")).toString());
  });

  it("never changes the upstream chain", async () => {
    expect(await up.publicClient.getBlockNumber({ cacheTime: 0 })).toBe(headAfterSetup);
    const balance = await up.publicClient.readContract({ address: up.addresses.token, abi: up.abis.TestERC20!, functionName: "balanceOf", args: [up.victim] });
    expect(balance).toBe(parseEther("1000"));
  });
});
