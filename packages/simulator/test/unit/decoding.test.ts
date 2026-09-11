import { encodeAbiParameters, encodeFunctionData, maxUint256, pad, parseAbi, toHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../../src/abi";
import { decodeTokenCall } from "../../src/calldata";
import { decodeTokenLog } from "../../src/logs";
import { ProbeSet } from "../../src/probes";
import { decodeRevertReason } from "../../src/trace";
import { isUnlimitedAmount } from "../../src/util";

const TOKEN = "0x1111111111111111111111111111111111111111" as Address;
const ALICE = "0x2222222222222222222222222222222222222222" as Address;
const BOB = "0x3333333333333333333333333333333333333333" as Address;
const topic = (a: Address) => pad(a, { size: 32 }) as Hex;

describe("decodeTokenLog", () => {
  it("tells ERC-20 and ERC-721 Transfer apart by indexed topics", () => {
    const erc20 = decodeTokenLog({ address: TOKEN, topics: [TOPICS.transfer, topic(ALICE), topic(BOB)], data: toHex(5n, { size: 32 }) });
    expect(erc20).toMatchObject({ kind: "erc20-transfer", amount: 5n, from: ALICE, to: BOB });

    const erc721 = decodeTokenLog({ address: TOKEN, topics: [TOPICS.transfer, topic(ALICE), topic(BOB), toHex(42n, { size: 32 })], data: "0x" });
    expect(erc721).toMatchObject({ kind: "erc721-transfer", tokenId: 42n });
  });

  it("decodes approvals and operator approvals", () => {
    expect(decodeTokenLog({ address: TOKEN, topics: [TOPICS.approval, topic(ALICE), topic(BOB)], data: toHex(maxUint256, { size: 32 }) })).toMatchObject({
      kind: "erc20-approval",
      amount: maxUint256,
    });
    expect(decodeTokenLog({ address: TOKEN, topics: [TOPICS.approvalForAll, topic(ALICE), topic(BOB)], data: toHex(1n, { size: 32 }) })).toMatchObject({
      kind: "approval-for-all",
      approved: true,
      operator: BOB,
    });
  });

  it("decodes ERC-1155 batch transfers", () => {
    const data = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], [[1n, 2n], [10n, 20n]]);
    const log = decodeTokenLog({ address: TOKEN, topics: [TOPICS.transferBatch, topic(BOB), topic(ALICE), topic(BOB)], data });
    expect(log).toMatchObject({ kind: "erc1155-transfer", ids: [1n, 2n], amounts: [10n, 20n] });
  });

  it("ignores unknown or malformed logs", () => {
    expect(decodeTokenLog({ address: TOKEN, topics: [TOPICS.transfer], data: "0x" })).toBeUndefined();
    expect(decodeTokenLog({ address: TOKEN, topics: [pad("0x01", { size: 32 })], data: "0x" })).toBeUndefined();
  });
});

describe("decodeTokenCall", () => {
  const abi = parseAbi([
    "function approve(address,uint256)",
    "function setApprovalForAll(address,bool)",
    "function transferFrom(address,address,uint256)",
    "function safeTransferFrom(address,address,uint256,uint256,bytes)",
    "function claim()",
  ]);

  it("decodes approvals with the caller as owner", () => {
    const h = decodeTokenCall(TOKEN, encodeFunctionData({ abi, functionName: "approve", args: [BOB, 7n] }), ALICE);
    expect(h).toMatchObject({ kind: "approve", owner: ALICE, spender: BOB, amountOrId: 7n });
  });

  it("decodes setApprovalForAll and 1155 transfers", () => {
    expect(decodeTokenCall(TOKEN, encodeFunctionData({ abi, functionName: "setApprovalForAll", args: [BOB, true] }), ALICE)).toMatchObject({
      kind: "setApprovalForAll",
      operator: BOB,
      approved: true,
    });
    expect(decodeTokenCall(TOKEN, encodeFunctionData({ abi, functionName: "safeTransferFrom", args: [ALICE, BOB, 3n, 4n, "0x"] }), BOB)).toMatchObject({
      kind: "erc1155-transfer",
      caller: BOB,
      ids: [3n],
      amounts: [4n],
    });
  });

  it("returns undefined for unknown selectors", () => {
    expect(decodeTokenCall(TOKEN, encodeFunctionData({ abi, functionName: "claim" }), ALICE)).toBeUndefined();
    expect(decodeTokenCall(TOKEN, "0x", ALICE)).toBeUndefined();
  });
});

describe("helpers", () => {
  it("treats common max values as unlimited", () => {
    expect(isUnlimitedAmount(maxUint256)).toBe(true);
    expect(isUnlimitedAmount((1n << 96n) - 1n)).toBe(true);
    expect(isUnlimitedAmount(1n << 255n)).toBe(true);
    expect(isUnlimitedAmount(10n ** 24n)).toBe(false);
  });

  it("decodes revert reasons", () => {
    const err = encodeFunctionData({ abi: parseAbi(["function Error(string)"]), functionName: "Error", args: ["nope"] });
    expect(decodeRevertReason(err)).toBe("nope");
    const panic = encodeFunctionData({ abi: parseAbi(["function Panic(uint256)"]), functionName: "Panic", args: [17n] });
    expect(decodeRevertReason(panic)).toBe("panic: arithmetic overflow/underflow");
    expect(decodeRevertReason("0xdeadbeef", "execution reverted")).toMatch(/custom error 0xdeadbeef/);
    expect(decodeRevertReason("0x", "execution reverted")).toBe("execution reverted");
  });

  it("deduplicates probes case-insensitively and skips the zero address", () => {
    const set = new ProbeSet();
    set.add({ type: "erc20-balance", token: TOKEN, account: ALICE });
    set.add({ type: "erc20-balance", token: TOKEN.toUpperCase().replace("0X", "0x") as Address, account: ALICE });
    set.add({ type: "erc20-balance", token: TOKEN, account: "0x0000000000000000000000000000000000000000" });
    expect(set.size).toBe(1);
  });
});
