import type { ChainConfig } from "./simulator";

/** Keyless public endpoints; override per chain with RPC_URL_<chainId> (e.g. an Alchemy URL). */
const DEFAULTS: ChainConfig[] = [
  { chainId: 1, name: "Ethereum Mainnet", rpcUrl: "https://ethereum-rpc.publicnode.com", blockLag: 2 },
  { chainId: 11155111, name: "Sepolia", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", blockLag: 2 },
  { chainId: 31337, name: "Anvil Local PS2", rpcUrl: "http://127.0.0.1:8545", blockLag: 0 },
];

/**
 * Chains the simulator may fork. SIM_CHAINS="1,11155111" limits the set; RPC_URL_<id> overrides
 * the upstream; any RPC_URL_<id> for an unknown id adds that chain (named CHAIN_NAME_<id>).
 */
export function chainsFromEnv(env: NodeJS.ProcessEnv = process.env): ChainConfig[] {
  const byId = new Map(DEFAULTS.map((c) => [c.chainId, { ...c }]));
  for (const [key, value] of Object.entries(env)) {
    const m = /^RPC_URL_(\d+)$/.exec(key);
    if (!m || !value) continue;
    const chainId = Number(m[1]);
    const existing = byId.get(chainId);
    byId.set(chainId, {
      chainId,
      name: env[`CHAIN_NAME_${chainId}`] ?? existing?.name ?? `Chain ${chainId}`,
      rpcUrl: value,
      blockLag: env[`BLOCK_LAG_${chainId}`] !== undefined ? Number(env[`BLOCK_LAG_${chainId}`]) : (existing?.blockLag ?? 2),
    });
  }
  const only = env.SIM_CHAINS?.split(",").map((s) => Number(s.trim())).filter(Boolean);
  const chains = [...byId.values()];
  return only?.length ? chains.filter((c) => only.includes(c.chainId)) : chains;
}
