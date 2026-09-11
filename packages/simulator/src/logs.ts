import { decodeAbiParameters, hexToBigInt, type Address, type Hex } from "viem";
import { TOPICS } from "./abi";
import type { RawLog } from "./rpc";
import { addr } from "./util";

export type DecodedLog =
  | { kind: "erc20-transfer"; token: Address; from: Address; to: Address; amount: bigint }
  | { kind: "erc721-transfer"; token: Address; from: Address; to: Address; tokenId: bigint }
  | { kind: "erc20-approval"; token: Address; owner: Address; spender: Address; amount: bigint }
  | { kind: "erc721-approval"; token: Address; owner: Address; approved: Address; tokenId: bigint }
  | { kind: "approval-for-all"; token: Address; owner: Address; operator: Address; approved: boolean }
  | {
      kind: "erc1155-transfer";
      token: Address;
      operator: Address;
      from: Address;
      to: Address;
      ids: bigint[];
      amounts: bigint[];
    }
  | { kind: "wrapped-native"; token: Address; account: Address };

function topicAddress(topic: Hex | undefined): Address | undefined {
  if (!topic || topic.length !== 66) return undefined;
  return addr(`0x${topic.slice(26)}`);
}

function wordCount(data: Hex): number {
  return (data.length - 2) / 64;
}

/**
 * Decodes the standard token events. ERC-20 and ERC-721 share Transfer/Approval signatures and
 * are told apart by how many topics are indexed (3 vs 4). Unrecognised shapes are ignored.
 */
export function decodeTokenLog(log: RawLog): DecodedLog | undefined {
  const [t0, t1, t2, t3] = log.topics;
  const token = addr(log.address);
  try {
    switch (t0?.toLowerCase()) {
      case TOPICS.transfer: {
        const from = topicAddress(t1);
        const to = topicAddress(t2);
        if (!from || !to) return undefined;
        if (log.topics.length === 4 && t3) return { kind: "erc721-transfer", token, from, to, tokenId: hexToBigInt(t3) };
        if (log.topics.length === 3 && wordCount(log.data) === 1)
          return { kind: "erc20-transfer", token, from, to, amount: hexToBigInt(log.data) };
        return undefined;
      }
      case TOPICS.approval: {
        const owner = topicAddress(t1);
        const other = topicAddress(t2);
        if (!owner || !other) return undefined;
        if (log.topics.length === 4 && t3)
          return { kind: "erc721-approval", token, owner, approved: other, tokenId: hexToBigInt(t3) };
        if (log.topics.length === 3 && wordCount(log.data) === 1)
          return { kind: "erc20-approval", token, owner, spender: other, amount: hexToBigInt(log.data) };
        return undefined;
      }
      case TOPICS.approvalForAll: {
        const owner = topicAddress(t1);
        const operator = topicAddress(t2);
        if (!owner || !operator || wordCount(log.data) !== 1) return undefined;
        return { kind: "approval-for-all", token, owner, operator, approved: hexToBigInt(log.data) !== 0n };
      }
      case TOPICS.transferSingle: {
        const operator = topicAddress(t1);
        const from = topicAddress(t2);
        const to = topicAddress(t3);
        if (!operator || !from || !to) return undefined;
        const [id, value] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], log.data);
        return { kind: "erc1155-transfer", token, operator, from, to, ids: [id], amounts: [value] };
      }
      case TOPICS.transferBatch: {
        const operator = topicAddress(t1);
        const from = topicAddress(t2);
        const to = topicAddress(t3);
        if (!operator || !from || !to) return undefined;
        const [ids, values] = decodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], log.data);
        return { kind: "erc1155-transfer", token, operator, from, to, ids: [...ids], amounts: [...values] };
      }
      case TOPICS.deposit:
      case TOPICS.withdrawal: {
        // WETH-style wrap/unwrap changes a token balance without a Transfer event.
        const account = topicAddress(t1);
        if (!account || log.topics.length !== 2 || wordCount(log.data) !== 1) return undefined;
        return { kind: "wrapped-native", token, account };
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
