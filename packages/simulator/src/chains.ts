import type { ChainConfig } from "./simulator";
import { parseUpstreamList } from "./upstreams";

/**
 * Keyless public endpoints, in preference order. No account or API key is required to run the
 * analysis API against live chains; the extra entries exist because public RPCs rate-limit, and
 * the simulator rotates to the next one when the current endpoint starts failing.
 *
 * Every endpoint here was checked to serve `eth_getStorageAt` at a recent block, which is what an
 * anvil fork actually needs — answering `eth_chainId` is not sufficient (cloudflare-eth.com, for
 * example, answers the latter and fails the former).
 */
const DEFAULTS: ChainConfig[] = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    fallbackRpcUrls: ["https://eth.drpc.org", "https://1rpc.io/eth"],
    blockLag: 2,
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    fallbackRpcUrls: ["https://1rpc.io/sepolia"],
    blockLag: 2,
  },
  { chainId: 31337, name: "Local Anvil", rpcUrl: "http://127.0.0.1:8545", blockLag: 0 },
];

/**
 * Chains the simulator may fork. SIM_CHAINS="1,11155111" limits the set; RPC_URL_<id> replaces the
 * upstream list for that chain; any RPC_URL_<id> for an unknown id adds that chain (named
 * CHAIN_NAME_<id>).
 *
 * RPC_URL_<id> accepts several endpoints separated by commas, highest preference first — e.g.
 * `RPC_URL_1=https://my-keyed-endpoint,https://ethereum-rpc.publicnode.com` keeps a public backup
 * behind a private one. A single URL replaces the built-in list outright, fallbacks included.
 */
export function chainsFromEnv(env: NodeJS.ProcessEnv = process.env): ChainConfig[] {
  const byId = new Map(DEFAULTS.map((c) => [c.chainId, { ...c }]));
  for (const [key, value] of Object.entries(env)) {
    const m = /^RPC_URL_(\d+)$/.exec(key);
    if (!m || !value) continue;
    const chainId = Number(m[1]);
    const existing = byId.get(chainId);
    const [primary, ...fallbacks] = parseUpstreamList(value);
    if (!primary) continue;
    byId.set(chainId, {
      chainId,
      name: env[`CHAIN_NAME_${chainId}`] ?? existing?.name ?? `Chain ${chainId}`,
      rpcUrl: primary,
      fallbackRpcUrls: fallbacks.length ? fallbacks : undefined,
      blockLag: env[`BLOCK_LAG_${chainId}`] !== undefined ? Number(env[`BLOCK_LAG_${chainId}`]) : (existing?.blockLag ?? 2),
    });
  }
  const only = env.SIM_CHAINS?.split(",").map((s) => Number(s.trim())).filter(Boolean);
  const chains = [...byId.values()];
  return only?.length ? chains.filter((c) => only.includes(c.chainId)) : chains;
}
