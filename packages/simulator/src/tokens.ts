import { decodeAbiParameters, hexToString, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import type { TokenInfo } from "@cognitia/shared";
import { ERC165_ABI, ERC20_READ_ABI, ERC721_READ_ABI, INTERFACE_IDS } from "./abi";
import { mapLimit } from "./util";

export type StandardHint = "erc20" | "erc721" | "erc1155";

async function supportsInterface(client: PublicClient, address: Address, id: Hex): Promise<boolean> {
  try {
    return (await client.readContract({ address, abi: ERC165_ABI, functionName: "supportsInterface", args: [id] })) === true;
  } catch {
    return false;
  }
}

/** name()/symbol() returning either `string` or legacy `bytes32` (e.g. MKR). */
async function readText(client: PublicClient, address: Address, selector: Hex): Promise<string | undefined> {
  try {
    const { data } = await client.call({ to: address, data: selector });
    if (!data || data === "0x") return undefined;
    try {
      const [s] = decodeAbiParameters([{ type: "string" }], data);
      return s.slice(0, 64) || undefined;
    } catch {
      if (data.length === 66) return hexToString(data as Hex).replace(/\0+$/, "").slice(0, 64) || undefined;
      return undefined;
    }
  } catch {
    return undefined;
  }
}

async function tryRead<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/**
 * Classify a contract as ERC-20/721/1155. ERC-165 wins, then the shape of the logs it emitted,
 * then an ERC-20 probe (decimals/totalSupply). Metadata is best effort.
 */
export async function detectToken(client: PublicClient, address: Address, hint?: StandardHint): Promise<TokenInfo> {
  // One parallel round: every read is cheap locally but may cost an upstream round-trip.
  const [code, is1155, is721, name, symbol, decimals, totalSupply] = await Promise.all([
    tryRead(() => client.getCode({ address })),
    supportsInterface(client, address, INTERFACE_IDS.erc1155),
    supportsInterface(client, address, INTERFACE_IDS.erc721),
    readText(client, address, "0x06fdde03"),
    readText(client, address, "0x95d89b41"),
    tryRead(() => client.readContract({ address, abi: ERC20_READ_ABI, functionName: "decimals" })),
    tryRead(() => client.readContract({ address, abi: ERC20_READ_ABI, functionName: "totalSupply" })),
  ]);
  if (!code || code === "0x") return { address, standard: "unknown" };

  let standard: TokenInfo["standard"] = is1155 ? "erc1155" : is721 ? "erc721" : (hint ?? "unknown");
  if (standard === "unknown" && (decimals !== undefined || (totalSupply !== undefined && symbol))) standard = "erc20";
  if (standard === "erc20") return { address, standard, name, symbol, decimals, totalSupply: totalSupply?.toString() };
  return { address, standard, name, symbol };
}

export async function detectTokens(
  client: PublicClient,
  candidates: Map<Address, StandardHint | undefined>,
  concurrency: number,
): Promise<Map<string, TokenInfo>> {
  const entries = [...candidates.entries()];
  const infos = await mapLimit(entries, concurrency, ([address, hint]) => detectToken(client, address, hint));
  return new Map(infos.map((t) => [t.address.toLowerCase(), t]));
}

const TRANSFER_721 = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const TRANSFER_SINGLE = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
const TRANSFER_BATCH = parseAbiItem("event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)");

/**
 * Candidate token IDs `owner` may hold, from transfer logs received in [fromBlock, toBlock].
 * Candidates only — current ownership/balances are verified by the probes afterwards.
 */
export async function holdingsFromLogs(
  client: PublicClient,
  token: Address,
  owner: Address,
  standard: "erc721" | "erc1155",
  fromBlock: bigint,
  toBlock: bigint,
  limit: number,
): Promise<bigint[]> {
  const ids = new Set<bigint>();
  if (standard === "erc721") {
    const logs = await client.getLogs({ address: token, event: TRANSFER_721, args: { to: owner }, fromBlock, toBlock });
    for (const l of logs.reverse()) {
      if (l.args.tokenId !== undefined) ids.add(l.args.tokenId);
      if (ids.size >= limit) break;
    }
  } else {
    const [single, batch] = await Promise.all([
      client.getLogs({ address: token, event: TRANSFER_SINGLE, args: { to: owner }, fromBlock, toBlock }),
      client.getLogs({ address: token, event: TRANSFER_BATCH, args: { to: owner }, fromBlock, toBlock }),
    ]);
    for (const l of single) if (l.args.id !== undefined) ids.add(l.args.id);
    for (const l of batch) for (const id of l.args.ids ?? []) ids.add(id);
  }
  return [...ids].slice(0, limit);
}

/** First `limit` token IDs held by `owner`, if the collection implements ERC721Enumerable. */
export async function enumerateOwnedTokenIds(
  client: PublicClient,
  token: Address,
  owner: Address,
  limit: number,
): Promise<bigint[] | undefined> {
  if (!(await supportsInterface(client, token, INTERFACE_IDS.erc721Enumerable))) return undefined;
  const count = await tryRead(() =>
    client.readContract({ address: token, abi: ERC721_READ_ABI, functionName: "balanceOf", args: [owner] }),
  );
  if (count === undefined) return undefined;
  const n = Number(count < BigInt(limit) ? count : BigInt(limit));
  const ids = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      tryRead(() =>
        client.readContract({ address: token, abi: ERC721_READ_ABI, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] }),
      ),
    ),
  );
  return ids.filter((x): x is bigint => x !== undefined);
}
