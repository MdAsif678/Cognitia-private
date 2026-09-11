import { BaseError, ContractFunctionRevertedError, type Address, type PublicClient } from "viem";
import { ERC1155_READ_ABI, ERC20_READ_ABI, ERC721_READ_ABI } from "./abi";
import { errorMessage, isZeroAddress, mapLimit, short } from "./util";

/** One piece of state read before and after execution. */
export type Probe =
  | { type: "native-balance"; account: Address }
  | { type: "erc20-balance"; token: Address; account: Address }
  | { type: "erc20-allowance"; token: Address; owner: Address; spender: Address }
  | { type: "erc721-owner"; token: Address; tokenId: bigint }
  | { type: "erc721-approved"; token: Address; tokenId: bigint }
  | { type: "erc721-count"; token: Address; account: Address }
  | { type: "operator-approval"; token: Address; standard: "erc721" | "erc1155" | "unknown"; owner: Address; operator: Address }
  | { type: "erc1155-balance"; token: Address; account: Address; tokenId: bigint };

export type ProbeValue = bigint | boolean | Address | null;
export type ProbeResult = { ok: true; value: ProbeValue } | { ok: false; error: string };
export type ProbeReadings = Map<string, ProbeResult>;

export function probeKey(p: Probe): string {
  const l = (a: string) => a.toLowerCase();
  switch (p.type) {
    case "native-balance":
      return `native:${l(p.account)}`;
    case "erc20-balance":
      return `erc20-bal:${l(p.token)}:${l(p.account)}`;
    case "erc20-allowance":
      return `erc20-allow:${l(p.token)}:${l(p.owner)}:${l(p.spender)}`;
    case "erc721-owner":
      return `721-owner:${l(p.token)}:${p.tokenId}`;
    case "erc721-approved":
      return `721-approved:${l(p.token)}:${p.tokenId}`;
    case "erc721-count":
      return `721-count:${l(p.token)}:${l(p.account)}`;
    case "operator-approval":
      return `operator:${l(p.token)}:${l(p.owner)}:${l(p.operator)}`;
    case "erc1155-balance":
      return `1155-bal:${l(p.token)}:${l(p.account)}:${p.tokenId}`;
  }
}

export class ProbeSet {
  private readonly map = new Map<string, Probe>();

  add(p: Probe) {
    // Zero-address holders are mint/burn sinks, not accounts.
    if ("account" in p && isZeroAddress(p.account)) return;
    if ("owner" in p && isZeroAddress(p.owner)) return;
    const key = probeKey(p);
    if (!this.map.has(key)) this.map.set(key, p);
  }

  values(): Probe[] {
    return [...this.map.values()];
  }

  get size() {
    return this.map.size;
  }
}

function isRevert(err: unknown): boolean {
  return err instanceof BaseError && !!err.walk((e) => e instanceof ContractFunctionRevertedError);
}

async function readOne(client: PublicClient, p: Probe): Promise<ProbeResult> {
  try {
    switch (p.type) {
      case "native-balance":
        return { ok: true, value: await client.getBalance({ address: p.account }) };
      case "erc20-balance":
        return { ok: true, value: await client.readContract({ address: p.token, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [p.account] }) };
      case "erc20-allowance":
        return { ok: true, value: await client.readContract({ address: p.token, abi: ERC20_READ_ABI, functionName: "allowance", args: [p.owner, p.spender] }) };
      case "erc721-count":
        return { ok: true, value: await client.readContract({ address: p.token, abi: ERC721_READ_ABI, functionName: "balanceOf", args: [p.account] }) };
      case "operator-approval":
        return { ok: true, value: await client.readContract({ address: p.token, abi: ERC721_READ_ABI, functionName: "isApprovedForAll", args: [p.owner, p.operator] }) };
      case "erc1155-balance":
        return { ok: true, value: await client.readContract({ address: p.token, abi: ERC1155_READ_ABI, functionName: "balanceOf", args: [p.account, p.tokenId] }) };
      case "erc721-owner":
      case "erc721-approved":
        try {
          const value = await client.readContract({
            address: p.token,
            abi: ERC721_READ_ABI,
            functionName: p.type === "erc721-owner" ? "ownerOf" : "getApproved",
            args: [p.tokenId],
          });
          return { ok: true, value: isZeroAddress(value) ? null : value };
        } catch (err) {
          // ownerOf/getApproved revert for tokens that do not exist (not minted yet, or burned).
          if (isRevert(err)) return { ok: true, value: null };
          throw err;
        }
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function readProbes(client: PublicClient, probes: Probe[], concurrency: number): Promise<ProbeReadings> {
  const results = await mapLimit(probes, concurrency, (p) => readOne(client, p));
  const out: ProbeReadings = new Map();
  probes.forEach((p, i) => out.set(probeKey(p), results[i]!));
  return out;
}

export function describeProbe(p: Probe, label: (token: Address) => string): string {
  switch (p.type) {
    case "native-balance":
      return `native balance of ${p.account}`;
    case "erc20-balance":
      return `${label(p.token)} balance of ${p.account}`;
    case "erc20-allowance":
      return `${label(p.token)} allowance ${short(p.owner)} → ${short(p.spender)}`;
    case "erc721-owner":
      return `owner of ${label(p.token)} #${p.tokenId}`;
    case "erc721-approved":
      return `approved address for ${label(p.token)} #${p.tokenId}`;
    case "erc721-count":
      return `${label(p.token)} NFT count of ${p.account}`;
    case "operator-approval":
      return `${label(p.token)} operator approval ${short(p.owner)} → ${short(p.operator)}`;
    case "erc1155-balance":
      return `${label(p.token)} #${p.tokenId} balance of ${p.account}`;
  }
}
