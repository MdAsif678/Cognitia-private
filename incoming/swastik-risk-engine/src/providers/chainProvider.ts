import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { getChainConfig } from '../config/chains';
import { type ChainReadProvider } from './types';
import { STANDARD_ERC20_ABI } from './abiProvider';

export class ViemChainReadProvider implements ChainReadProvider {
  public readonly chainId: number;
  private client: PublicClient;

  constructor(chainId: number) {
    this.chainId = chainId;
    const cfg = getChainConfig(chainId);
    this.client = createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl, {
        timeout: 10_000,
        retryCount: 2,
      }),
    });
  }

  public async getBalance(account: string, blockNumber?: bigint): Promise<bigint> {
    try {
      return await this.client.getBalance({
        address: account as Address,
        blockNumber,
      });
    } catch (err) {
      // NEVER treat RPC failure as zero! Throw explicit error for caller coverage tracking
      throw new Error(`RPC_READ_FAILURE: Failed to getBalance for ${account} on chain ${this.chainId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async getTokenBalance(token: string, account: string, blockNumber?: bigint): Promise<bigint> {
    try {
      const result = await this.client.readContract({
        address: token as Address,
        abi: STANDARD_ERC20_ABI,
        functionName: 'balanceOf',
        args: [account as Address],
        blockNumber,
      });
      return result as bigint;
    } catch (err) {
      throw new Error(`RPC_READ_FAILURE: Failed to getTokenBalance for token ${token}, account ${account} on chain ${this.chainId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async getTokenAllowance(token: string, owner: string, spender: string, blockNumber?: bigint): Promise<bigint> {
    try {
      const result = await this.client.readContract({
        address: token as Address,
        abi: STANDARD_ERC20_ABI,
        functionName: 'allowance',
        args: [owner as Address, spender as Address],
        blockNumber,
      });
      return result as bigint;
    } catch (err) {
      throw new Error(`RPC_READ_FAILURE: Failed to getTokenAllowance for token ${token}, owner ${owner}, spender ${spender}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async getTokenNonce(token: string, owner: string, blockNumber?: bigint): Promise<bigint> {
    try {
      // Check nonces(address)
      const result = await this.client.readContract({
        address: token as Address,
        abi: [
          {
            name: 'nonces',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'owner', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ],
        functionName: 'nonces',
        args: [owner as Address],
        blockNumber,
      });
      return result as bigint;
    } catch (err) {
      throw new Error(`RPC_READ_FAILURE: Failed to read nonces for token ${token}, owner ${owner}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async getDomainSeparator(token: string, blockNumber?: bigint): Promise<string | null> {
    try {
      const result = await this.client.readContract({
        address: token as Address,
        abi: [
          {
            name: 'DOMAIN_SEPARATOR',
            type: 'function',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ name: '', type: 'bytes32' }],
          },
        ],
        functionName: 'DOMAIN_SEPARATOR',
        blockNumber,
      });
      return (result as string) || null;
    } catch {
      return null;
    }
  }

  public async getBlockTimestamp(blockNumber?: bigint): Promise<bigint> {
    try {
      const block = await this.client.getBlock({
        blockNumber,
      });
      return block.timestamp;
    } catch (err) {
      throw new Error(`RPC_READ_FAILURE: Failed to getBlockTimestamp on chain ${this.chainId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async getBytecode(address: string): Promise<string | null> {
    try {
      const code = await this.client.getBytecode({
        address: address as Address,
      });
      return code || null;
    } catch (err) {
      throw new Error(`RPC_READ_FAILURE: Failed to getBytecode for ${address} on chain ${this.chainId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async getBlockNumber(): Promise<bigint> {
    try {
      return await this.client.getBlockNumber();
    } catch (err) {
      throw new Error(`RPC_READ_FAILURE: Failed to getBlockNumber on chain ${this.chainId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// In-memory mock chain reader for tests or offline execution
export class MockChainReadProvider implements ChainReadProvider {
  public readonly chainId: number;
  private balances = new Map<string, bigint>();
  private tokenBalances = new Map<string, bigint>();
  private tokenAllowances = new Map<string, bigint>();
  private tokenNonces = new Map<string, bigint>();
  private domainSeparators = new Map<string, string>();
  private bytecodes = new Map<string, string>();
  private currentBlock = 20000000n;
  private currentBlockTimestamp = 1700000000n;

  constructor(chainId: number = 1) {
    this.chainId = chainId;
  }

  public setBalance(account: string, amount: bigint) {
    this.balances.set(account.toLowerCase(), amount);
  }

  public setTokenBalance(token: string, account: string, amount: bigint) {
    this.tokenBalances.set(`${token.toLowerCase()}:${account.toLowerCase()}`, amount);
  }

  public setTokenAllowance(token: string, owner: string, spender: string, amount: bigint) {
    this.tokenAllowances.set(`${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`, amount);
  }

  public setTokenNonce(token: string, owner: string, nonce: bigint) {
    this.tokenNonces.set(`${token.toLowerCase()}:${owner.toLowerCase()}`, nonce);
  }

  public setDomainSeparator(token: string, separator: string | null) {
    if (separator === null) {
      this.domainSeparators.set(token.toLowerCase(), '__NONE__');
    } else {
      this.domainSeparators.set(token.toLowerCase(), separator);
    }
  }

  public setBytecode(address: string, code: string) {
    this.bytecodes.set(address.toLowerCase(), code);
  }

  public setBlockTimestamp(timestamp: bigint) {
    this.currentBlockTimestamp = timestamp;
  }

  public setCurrentBlock(block: bigint) {
    this.currentBlock = block;
  }

  public async getBalance(account: string): Promise<bigint> {
    const b = this.balances.get(account.toLowerCase());
    if (b !== undefined) return b;
    return 10000000000000000000n; // 10 ETH default in mock
  }

  public async getTokenBalance(token: string, account: string): Promise<bigint> {
    const tb = this.tokenBalances.get(`${token.toLowerCase()}:${account.toLowerCase()}`);
    if (tb !== undefined) return tb;
    return 1000000000000000000000n; // 1,000 units default in mock
  }

  public async getTokenAllowance(token: string, owner: string, spender: string): Promise<bigint> {
    const ta = this.tokenAllowances.get(`${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`);
    if (ta !== undefined) return ta;
    return 0n;
  }

  public async getTokenNonce(token: string, owner: string): Promise<bigint> {
    const tn = this.tokenNonces.get(`${token.toLowerCase()}:${owner.toLowerCase()}`);
    if (tn !== undefined) return tn;
    return 0n;
  }

  public async getDomainSeparator(token: string): Promise<string | null> {
    const val = this.domainSeparators.get(token.toLowerCase());
    if (val === '__NONE__') return null;
    if (val !== undefined) return val;
    if (token.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') {
      return '0x08d7eb49537361e87890fad7e7c9e7285420f4b1779dd561d116a92deb027c50';
    }
    return null;
  }

  public async getBlockTimestamp(): Promise<bigint> {
    return this.currentBlockTimestamp;
  }

  public async getBytecode(address: string): Promise<string | null> {
    return this.bytecodes.get(address.toLowerCase()) || null;
  }

  public async getBlockNumber(): Promise<bigint> {
    return this.currentBlock;
  }
}
