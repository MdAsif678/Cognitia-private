import { parseAbi, toFunctionSelector, type Hex } from 'viem';
import { type AbiLookupProvider, type AbiLookupResult } from './types';

export const SELECTOR_DISCLAIMER = "A selector match does not prove a function's meaning.";

export const STANDARD_ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const STANDARD_ERC721_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
]);

export const STANDARD_ERC1155_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
]);

export const MULTICALL3_ABI = parseAbi([
  'function aggregate((address target, bytes callData)[] calls) returns (uint256 blockNumber, bytes[] returnData)',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) returns ((bool success, bytes returnData)[] returnData)',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

export const OZ_MULTICALL_ABI = parseAbi([
  'function multicall(bytes[] data) returns (bytes[] results)',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);

export const UNISWAP_UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  'function execute(bytes commands, bytes[] inputs) payable',
]);

const STANDARD_SELECTOR_MAP: Record<string, { signature: string; functionName: string; abi: unknown[] }> = {
  [toFunctionSelector('function approve(address,uint256)')]: {
    signature: 'approve(address,uint256)',
    functionName: 'approve',
    abi: STANDARD_ERC20_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function transfer(address,uint256)')]: {
    signature: 'transfer(address,uint256)',
    functionName: 'transfer',
    abi: STANDARD_ERC20_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function transferFrom(address,address,uint256)')]: {
    signature: 'transferFrom(address,address,uint256)',
    functionName: 'transferFrom',
    abi: STANDARD_ERC20_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)')]: {
    signature: 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
    functionName: 'permit',
    abi: STANDARD_ERC20_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function safeTransferFrom(address,address,uint256)')]: {
    signature: 'safeTransferFrom(address,address,uint256)',
    functionName: 'safeTransferFrom',
    abi: STANDARD_ERC721_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function safeTransferFrom(address,address,uint256,bytes)')]: {
    signature: 'safeTransferFrom(address,address,uint256,bytes)',
    functionName: 'safeTransferFrom',
    abi: STANDARD_ERC721_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function setApprovalForAll(address,bool)')]: {
    signature: 'setApprovalForAll(address,bool)',
    functionName: 'setApprovalForAll',
    abi: STANDARD_ERC721_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)')]: {
    signature: 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
    functionName: 'safeBatchTransferFrom',
    abi: STANDARD_ERC1155_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function aggregate((address,bytes)[])')]: {
    signature: 'aggregate((address,bytes)[])',
    functionName: 'aggregate',
    abi: MULTICALL3_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function aggregate3((address,bool,bytes)[])')]: {
    signature: 'aggregate3((address,bool,bytes)[])',
    functionName: 'aggregate3',
    abi: MULTICALL3_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function aggregate3Value((address,bool,uint256,bytes)[])')]: {
    signature: 'aggregate3Value((address,bool,uint256,bytes)[])',
    functionName: 'aggregate3Value',
    abi: MULTICALL3_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function multicall(bytes[])')]: {
    signature: 'multicall(bytes[])',
    functionName: 'multicall',
    abi: OZ_MULTICALL_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function execute(bytes,bytes[],uint256)')]: {
    signature: 'execute(bytes,bytes[],uint256)',
    functionName: 'execute',
    abi: UNISWAP_UNIVERSAL_ROUTER_ABI as unknown as unknown[],
  },
  [toFunctionSelector('function execute(bytes,bytes[])')]: {
    signature: 'execute(bytes,bytes[])',
    functionName: 'execute',
    abi: UNISWAP_UNIVERSAL_ROUTER_ABI as unknown as unknown[],
  },
};

const CANDIDATE_SELECTORS: Record<string, string> = {
  '0x38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  '0x7ff36ab5': 'swapExactETHForTokens(uint256,address[],address,uint256)',
  '0x18cbafe5': 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
  '0x5c11d795': 'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
  '0xd0e30db0': 'deposit()',
  '0x2e1a7d4d': 'withdraw(uint256)',
  '0x3659cfe6': 'upgradeTo(address)',
  '0x4f1f286d': 'upgradeToAndCall(address,bytes)',
  '0xf2fde38b': 'transferOwnership(address)',
  '0x8da5cb5b': 'owner()',
};

export class DefaultAbiLookupProvider implements AbiLookupProvider {
  private verifiedRegistry = new Map<string, unknown[]>();

  public registerVerifiedAbi(address: string, chainId: number, abi: unknown[]): void {
    this.verifiedRegistry.set(`${chainId}:${address.toLowerCase()}`, abi);
  }

  public async getAbi(address: string, chainId: number): Promise<unknown[] | null> {
    return this.verifiedRegistry.get(`${chainId}:${address.toLowerCase()}`) || null;
  }

  public async lookupSelector(selector: string): Promise<AbiLookupResult | null> {
    const sel = selector.toLowerCase().slice(0, 10);
    const standard = STANDARD_SELECTOR_MAP[sel];
    if (standard) {
      return {
        signature: standard.signature,
        functionName: standard.functionName,
        isCandidate: false,
        abi: standard.abi,
      };
    }

    const candidate = CANDIDATE_SELECTORS[sel];
    if (candidate) {
      return {
        signature: candidate,
        functionName: candidate.split('(')[0],
        isCandidate: true,
        disclaimer: SELECTOR_DISCLAIMER,
      };
    }

    return null;
  }
}

export const defaultAbiProvider = new DefaultAbiLookupProvider();
