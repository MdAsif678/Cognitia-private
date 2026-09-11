import { maxUint256, pad, toHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../../src/abi";
import { buildFollowUpSteps } from "../../src/conditional";
import { computeExposures, diffProbes, ownedKey } from "../../src/diff";
import { buildProbes, discover } from "../../src/discovery";
import { decodeTokenLog } from "../../src/logs";
import { probeKey, type Probe, type ProbeReadings } from "../../src/probes";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const NFT = "0x4444444444444444444444444444444444444444" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;
const SPENDER = "0x3333333333333333333333333333333333333333" as Address;

function readings(entries: [Probe, bigint | boolean | Address | null][]): ProbeReadings {
  return new Map(entries.map(([p, v]) => [probeKey(p), { ok: true as const, value: v }]));
}

describe("diffProbes", () => {
  const allowance: Probe = { type: "erc20-allowance", token: TOKEN, owner: OWNER, spender: SPENDER };
  const balance: Probe = { type: "erc20-balance", token: TOKEN, account: OWNER };
  const operator: Probe = { type: "operator-approval", token: NFT, standard: "erc721", owner: OWNER, operator: SPENDER };

  it("emits only changed values, with signed deltas", () => {
    const before = readings([[allowance, 0n], [balance, 100n], [operator, false]]);
    const after = readings([[allowance, maxUint256], [balance, 100n], [operator, true]]);
    const { changes, failed } = diffProbes([allowance, balance, operator], before, after, "immediate");
    expect(failed).toHaveLength(0);
    expect(changes.map((c) => c.kind).sort()).toEqual(["erc20-allowance", "operator-approval"]);
    expect(changes.find((c) => c.kind === "erc20-allowance")).toMatchObject({ unlimitedAfter: true, unlimitedBefore: false });
  });

  it("reports failed reads instead of guessing", () => {
    const before: ProbeReadings = new Map([[probeKey(balance), { ok: false, error: "rpc down" }]]);
    const after = readings([[balance, 5n]]);
    const { changes, failed } = diffProbes([balance], before, after, "immediate");
    expect(changes).toHaveLength(0);
    expect(failed[0]?.error).toMatch(/rpc down/);
  });

  it("builds exposures and a sized follow-up from granted authority", () => {
    const before = readings([[allowance, 0n], [balance, 100n], [operator, false]]);
    const after = readings([
      [allowance, maxUint256],
      [balance, 100n],
      [operator, true],
      [{ type: "erc721-count", token: NFT, account: OWNER }, 2n],
    ]);
    const { changes } = diffProbes([allowance, balance, operator], before, after, "immediate");
    const exposures = computeExposures(changes, {
      after,
      probes: [allowance, balance, operator],
      tokens: new Map([[TOKEN.toLowerCase(), { address: TOKEN, standard: "erc20", totalSupply: "1000" }]]),
      ownedTokenIds: new Map([[ownedKey(NFT, OWNER), [5n, 9n]]]),
      pullers: new Set(),
      basis: "granted",
    });
    expect(exposures).toHaveLength(2);
    expect(exposures[0]).toMatchObject({ kind: "erc20-allowance", unlimited: true, exceedsTotalSupply: true, atRisk: { erc20Balance: "100" } });
    expect(exposures[1]).toMatchObject({ kind: "operator-approval", atRisk: { nftCount: "2", tokenIds: ["5", "9"] } });

    const steps = buildFollowUpSteps(exposures, [], 10);
    expect(steps).toHaveLength(3); // one ERC-20 pull + two NFTs
    expect(steps.every((s) => s.from === SPENDER && s.role === "follow-up")).toBe(true);
  });
});

describe("discover + buildProbes", () => {
  it("turns an ERC-20 Transfer log into balance probes for both parties", () => {
    const log = decodeTokenLog({
      address: TOKEN,
      topics: [TOPICS.transfer, pad(OWNER, { size: 32 }) as Hex, pad(SPENDER, { size: 32 }) as Hex],
      data: toHex(1n, { size: 32 }),
    })!;
    const d = discover([{ label: "request", from: OWNER, to: TOKEN, frames: [], logs: [log] }], [OWNER], undefined, "immediate");
    const { probes } = buildProbes(d, new Map([[TOKEN.toLowerCase(), { address: TOKEN, standard: "erc20" }]]));
    const keys = probes.values().map(probeKey);
    expect(keys).toContain(probeKey({ type: "erc20-balance", token: TOKEN, account: OWNER }));
    expect(keys).toContain(probeKey({ type: "erc20-balance", token: TOKEN, account: SPENDER }));
    expect(d.flows).toHaveLength(1);
  });

  it("marks tokens whose standard cannot be determined", () => {
    const d = discover([{ label: "request", from: OWNER, to: TOKEN, data: "0x095ea7b3" + "0".repeat(128) as Hex, frames: [], logs: [] }], [OWNER], undefined, "immediate");
    const { unresolved } = buildProbes(d, new Map());
    expect(unresolved).toContain(TOKEN);
  });
});
