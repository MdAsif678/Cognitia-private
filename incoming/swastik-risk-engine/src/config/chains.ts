import { mainnet, sepolia, polygon, arbitrum } from 'viem/chains';
import { type Chain } from 'viem';

export interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  isDefault?: boolean;
}

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  1: {
    chain: mainnet,
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    isDefault: true,
  },
  11155111: {
    chain: sepolia,
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  },
  137: {
    chain: polygon,
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  },
  42161: {
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  },
};

export const DEFAULT_CHAIN_ID = parseInt(process.env.DEFAULT_CHAIN_ID || '1', 10);

export function getChainConfig(chainId: number = DEFAULT_CHAIN_ID): ChainConfig {
  const cfg = SUPPORTED_CHAINS[chainId];
  if (!cfg) {
    // Gracefully handle custom/unlisted EVM chains
    return {
      chain: {
        id: chainId,
        name: `EVM Chain ${chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [process.env.CUSTOM_RPC_URL || 'http://127.0.0.1:8545'] } },
      },
      rpcUrl: process.env.CUSTOM_RPC_URL || 'http://127.0.0.1:8545',
    };
  }
  return cfg;
}
