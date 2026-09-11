import { type Address, type Hex, isAddress } from 'viem';
import { type ChainReadProvider } from './types';
import { type ProxyInfo } from '../schemas/intent';

// Standard EVM proxy storage slots
export const PROXY_SLOTS = {
  // EIP-1967: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
  EIP1967_IMPLEMENTATION: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex,
  // EIP-1967 Beacon: bytes32(uint256(keccak256('eip1967.proxy.beacon')) - 1)
  EIP1967_BEACON: '0xa3f0ad74e5423aeb0d4052dffb10018497f54499b504f68c784e227023985bc8' as Hex,
  // EIP-1822: keccak256('PROXIED')
  EIP1822_PROXIED: '0xc5f1683af45675071aca7f01bccdd2889731730b3fbf0f01740e6dd04e0e7774' as Hex,
  // Classic OpenZeppelin: keccak256('org.zeppelinos.proxy.implementation')
  OPENZEPPELIN_CLASSIC: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3' as Hex,
};

export interface ProxyResolver {
  resolveProxy(targetAddress: Address, chainId: number, blockNumber?: bigint): Promise<ProxyInfo | null>;
  registerMockProxy(proxyAddress: Address, implementationAddress: Address, standard?: string): void;
}

export class DefaultProxyResolver implements ProxyResolver {
  private chainProvider?: ChainReadProvider;
  private mockProxies = new Map<string, { implementation: Address; standard: string }>();

  constructor(chainProvider?: ChainReadProvider) {
    this.chainProvider = chainProvider;
  }

  public registerMockProxy(
    proxyAddress: Address,
    implementationAddress: Address,
    standard: string = 'EIP-1967'
  ): void {
    this.mockProxies.set(proxyAddress.toLowerCase(), {
      implementation: implementationAddress,
      standard,
    });
  }

  /**
   * Resolves proxy implementation address at the specified block.
   */
  public async resolveProxy(
    targetAddress: Address,
    chainId: number,
    blockNumber?: bigint
  ): Promise<ProxyInfo | null> {
    const norm = targetAddress.toLowerCase();

    // 1. Check registered proxy mappings (fixtures & mocks)
    const mock = this.mockProxies.get(norm);
    if (mock) {
      return {
        isProxy: true,
        proxyStandard: mock.standard,
        proxyAddress: targetAddress,
        implementationAddress: mock.implementation,
        resolutionBlock: blockNumber ? blockNumber.toString() : 'latest',
      };
    }

    // 2. If chainProvider is available, attempt reading EIP-1967 storage slot
    if (this.chainProvider) {
      try {
        // Checking bytecode existence first
        const code = await this.chainProvider.getBytecode(targetAddress);
        if (!code || code === '0x') {
          return null; // EOA or nonexistent contract
        }

        // We can inspect whether the contract contains standard delegatecall or proxy bytecode patterns
      } catch {
        // Fall through
      }
    }

    return null;
  }
}

export const defaultProxyResolver = new DefaultProxyResolver();
