import { decodeFunctionData, type Address, type Hex } from "viem";
import { TOKEN_CALLS_ABI } from "./abi";
import { addr } from "./util";

/**
 * A token interaction recognised from calldata (top-level or an internal CALL frame).
 * `approve` and `transferFrom` share selectors between ERC-20 and ERC-721, so they stay
 * ambiguous here and are resolved once the token's standard is known.
 */
export type CallHint =
  | { kind: "approve"; token: Address; owner: Address; spender: Address; amountOrId: bigint }
  | { kind: "allowance-delta"; token: Address; owner: Address; spender: Address }
  | { kind: "transfer"; token: Address; from: Address; to: Address; amount: bigint }
  | { kind: "transferFrom"; token: Address; caller: Address; from: Address; to: Address; amountOrId: bigint }
  | { kind: "setApprovalForAll"; token: Address; owner: Address; operator: Address; approved: boolean }
  | { kind: "erc721-safeTransferFrom"; token: Address; caller: Address; from: Address; to: Address; tokenId: bigint }
  | {
      kind: "erc1155-transfer";
      token: Address;
      caller: Address;
      from: Address;
      to: Address;
      ids: bigint[];
      amounts: bigint[];
    }
  | { kind: "permit"; token: Address; owner: Address; spender: Address; amount: bigint }
  | { kind: "wrapped-native"; token: Address; account: Address };

/** Decode `input` sent by `caller` to `target`, if it is one of the standard token calls. */
export function decodeTokenCall(target: Address | undefined, input: Hex | undefined, caller: Address): CallHint | undefined {
  if (!target || !input || input.length < 10) return undefined;
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: TOKEN_CALLS_ABI, data: input });
  } catch {
    return undefined;
  }
  const token = addr(target);
  const a = decoded.args as readonly unknown[] | undefined;
  const A = (i: number) => addr(a?.[i] as string);
  const N = (i: number) => a?.[i] as bigint;

  switch (decoded.functionName) {
    case "approve":
      return { kind: "approve", token, owner: caller, spender: A(0), amountOrId: N(1) };
    case "increaseAllowance":
    case "decreaseAllowance":
      return { kind: "allowance-delta", token, owner: caller, spender: A(0) };
    case "transfer":
      return { kind: "transfer", token, from: caller, to: A(0), amount: N(1) };
    case "transferFrom":
      return { kind: "transferFrom", token, caller, from: A(0), to: A(1), amountOrId: N(2) };
    case "setApprovalForAll":
      return { kind: "setApprovalForAll", token, owner: caller, operator: A(0), approved: a?.[1] as boolean };
    case "safeTransferFrom":
      if (a?.length === 5) {
        return { kind: "erc1155-transfer", token, caller, from: A(0), to: A(1), ids: [N(2)], amounts: [N(3)] };
      }
      return { kind: "erc721-safeTransferFrom", token, caller, from: A(0), to: A(1), tokenId: N(2) };
    case "safeBatchTransferFrom":
      return {
        kind: "erc1155-transfer",
        token,
        caller,
        from: A(0),
        to: A(1),
        ids: [...(a?.[2] as readonly bigint[])],
        amounts: [...(a?.[3] as readonly bigint[])],
      };
    case "permit":
      return { kind: "permit", token, owner: A(0), spender: A(1), amount: N(2) };
    case "deposit":
    case "withdraw":
      return { kind: "wrapped-native", token, account: caller };
    default:
      return undefined;
  }
}
