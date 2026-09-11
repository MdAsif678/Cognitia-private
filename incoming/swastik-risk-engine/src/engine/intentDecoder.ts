import {
  decodeFunctionData,
  type Hex,
  type Address,
  isAddress,
  type Abi,
  decodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import {
  STANDARD_ERC20_ABI,
  STANDARD_ERC721_ABI,
  STANDARD_ERC1155_ABI,
  defaultAbiProvider,
} from '../providers/abiProvider';
import {
  type DecodedIntent,
  type Parameter,
  type AssetStandard,
  type AbiProvenance,
} from '../schemas/intent';
import { type AbiLookupProvider } from '../providers/types';
import { defaultRouterRegistry, RouterAdapterRegistry } from './adapters/adapterRegistry';
import { defaultProxyResolver, ProxyResolver } from '../providers/proxyResolver';
import { defaultInterfaceResolver, InterfaceResolver } from '../providers/interfaceResolver';

export interface IntentDecoderConfig {
  abiProvider?: AbiLookupProvider;
  routerRegistry?: RouterAdapterRegistry;
  proxyResolver?: ProxyResolver;
  interfaceResolver?: InterfaceResolver;
  maxRecursionDepth?: number;
  maxCalldataSize?: number; // bytes
  maxSubcalls?: number;
}

export const STANDARD_SELECTORS = {
  // ERC-20
  APPROVE: '0x095ea7b3',
  TRANSFER: '0xa9059cbb',
  TRANSFER_FROM: '0x23b872dd', // Overlaps ERC-20 and ERC-721!
  // ERC-721
  SAFE_TRANSFER_FROM_3: '0x42842e0e', // (address,address,uint256)
  SAFE_TRANSFER_FROM_4: '0xb88d4fde', // (address,address,uint256,bytes)
  SET_APPROVAL_FOR_ALL: '0xa22cb465', // Overlaps ERC-721 and ERC-1155!
  // ERC-1155
  SAFE_TRANSFER_FROM_1155: '0xf242432a', // (address,address,uint256,uint256,bytes)
  SAFE_BATCH_TRANSFER_FROM_1155: '0x2eb2c2d6', // (address,address,uint256[],uint256[],bytes)
  // ERC-2612
  PERMIT: '0xd505accf', // (address,address,uint256,uint256,uint8,bytes32,bytes32)
};

export class IntentDecoder {
  private abiProvider: AbiLookupProvider;
  private routerRegistry: RouterAdapterRegistry;
  private proxyResolver: ProxyResolver;
  private interfaceResolver: InterfaceResolver;
  private maxRecursionDepth: number;
  private maxCalldataSize: number;
  private maxSubcalls: number;

  constructor(config?: IntentDecoderConfig) {
    this.abiProvider = config?.abiProvider || defaultAbiProvider;
    this.routerRegistry = config?.routerRegistry || defaultRouterRegistry;
    this.proxyResolver = config?.proxyResolver || defaultProxyResolver;
    this.interfaceResolver = config?.interfaceResolver || defaultInterfaceResolver;
    this.maxRecursionDepth = config?.maxRecursionDepth ?? 5;
    this.maxCalldataSize = config?.maxCalldataSize ?? 131072; // 128 KB
    this.maxSubcalls = config?.maxSubcalls ?? 50;
  }

  public async decode(
    calldata: string,
    targetContract?: string,
    value: string = '0',
    chainId: number = 1,
    caller?: string,
    callType: 'call' | 'delegatecall' | 'staticcall' = 'call',
    depth: number = 0,
    subcallCounter: { count: number } = { count: 0 }
  ): Promise<DecodedIntent> {
    const rawTarget = targetContract && isAddress(targetContract, { strict: false })
      ? targetContract
      : undefined;

    // 1. Calldata Size Limit & Truncation Check
    const rawBytesLength = Math.max(0, Math.floor((calldata.length - 2) / 2));
    if (rawBytesLength > this.maxCalldataSize) {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        rawCalldata: calldata.slice(0, this.maxCalldataSize * 2 + 2) as Hex,
        isUnknownFunction: true,
        assetStandard: 'none',
        nativeValue: value,
        abiProvenance: 'unknown',
        confidence: { level: 'low', reason: 'Calldata exceeded maximum allowed payload size' },
        unresolvedQuestions: [`Calldata truncated: Payload size (${rawBytesLength} bytes) exceeds limit of ${this.maxCalldataSize} bytes.`],
        truncationReport: {
          truncated: true,
          reason: `Exceeded maxCalldataSize limit of ${this.maxCalldataSize} bytes.`,
          bytesLimit: this.maxCalldataSize,
        },
      };
    }

    // 2. Malformed Calldata Check
    const isCleanHex = /^0x[0-9a-fA-F]*$/.test(calldata) && calldata.length % 2 === 0;
    if (!isCleanHex) {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        rawCalldata: (calldata.startsWith('0x') ? calldata : `0x${calldata}`) as Hex,
        isUnknownFunction: true,
        assetStandard: 'none',
        nativeValue: value,
        abiProvenance: 'unknown',
        confidence: { level: 'low', reason: 'Malformed calldata format' },
        unresolvedQuestions: ['Malformed calldata: String is not valid even-length 0x-prefixed hex.'],
      };
    }

    const rawCalldata = calldata as Hex;

    // 3. Plain Native Transfer (empty or 0x calldata)
    if (rawCalldata === '0x') {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        functionName: 'native_transfer',
        decodedFunction: 'native_transfer',
        signature: 'transfer()',
        parameters: [{ name: 'value', type: 'uint256', value }],
        arguments: [{ name: 'value', type: 'uint256', value }],
        assetStandard: 'none',
        nativeValue: value,
        abiProvenance: 'standard_abi',
        confidence: { level: 'high', reason: 'Empty calldata with transaction native ether transfer' },
        unresolvedQuestions: [],
        rawCalldata,
        isUnknownFunction: false,
      };
    }

    // 4. Calldata shorter than 4-byte selector
    if (rawCalldata.length < 10) {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        functionName: 'fallback_or_raw',
        decodedFunction: 'fallback_or_raw',
        signature: 'fallback()',
        parameters: [],
        arguments: [],
        assetStandard: 'none',
        nativeValue: value,
        abiProvenance: 'unknown',
        confidence: { level: 'low', reason: 'Calldata too short to contain standard 4-byte selector' },
        unresolvedQuestions: ['Calldata length is under 4 bytes (selector unavailable).'],
        rawCalldata,
        isUnknownFunction: true,
      };
    }

    const selector = rawCalldata.slice(0, 10).toLowerCase();

    // 5. Recursion and Subcall Limits Check
    if (depth >= this.maxRecursionDepth) {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        selector,
        rawCalldata,
        isUnknownFunction: false,
        assetStandard: 'none',
        nativeValue: value,
        abiProvenance: 'router_adapter',
        confidence: { level: 'medium', reason: 'Recursion stopped at max allowed depth' },
        unresolvedQuestions: [`Subcall recursion halted: Max recursion depth (${this.maxRecursionDepth}) reached.`],
        truncationReport: {
          truncated: true,
          reason: `Exceeded maxRecursionDepth of ${this.maxRecursionDepth}.`,
          depth,
        },
      };
    }

    if (subcallCounter.count >= this.maxSubcalls) {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        selector,
        rawCalldata,
        isUnknownFunction: false,
        assetStandard: 'none',
        nativeValue: value,
        abiProvenance: 'router_adapter',
        confidence: { level: 'medium', reason: 'Subcall processing halted at maximum subcalls limit' },
        unresolvedQuestions: [`Subcall processing halted: Exceeded maxSubcalls limit of ${this.maxSubcalls}.`],
        truncationReport: {
          truncated: true,
          reason: `Exceeded maxSubcalls limit of ${this.maxSubcalls}.`,
          totalSubcalls: subcallCounter.count,
        },
      };
    }

    // 6. Explicit Adapter Registry for Supported Routers and Multicalls
    // Invariant: ONLY decode if adapter explicitly supports address/code identity and ABI!
    if (rawTarget) {
      const adapter = this.routerRegistry.getAdapter(rawTarget, rawCalldata, chainId);
      if (adapter) {
        subcallCounter.count += 1;
        const decodedFromAdapter = await adapter.decode({
          target: rawTarget,
          calldata: rawCalldata,
          value,
          caller: caller || '0x0000000000000000000000000000000000000000',
          chainId,
          depth,
          decodeSubcall: async (subTarget, subCalldata, subVal, subCaller, subCallType, subDepth) => {
            return this.decode(
              subCalldata,
              subTarget,
              subVal,
              chainId,
              subCaller,
              subCallType,
              subDepth,
              subcallCounter
            );
          },
        });

        if (decodedFromAdapter) {
          return decodedFromAdapter;
        }
      }
    }

    // 7. Proxy Implementation Resolution
    let proxyInfo: DecodedIntent['proxyInfo'] = undefined;
    let resolvedContractAddress: string | undefined = rawTarget;

    if (rawTarget) {
      const resolvedProxy = await this.proxyResolver.resolveProxy(rawTarget as Address, chainId);
      if (resolvedProxy && resolvedProxy.implementationAddress) {
        proxyInfo = resolvedProxy;
        resolvedContractAddress = resolvedProxy.implementationAddress;
      }
    }

    // 8. Verified Contract ABI Lookup
    if (resolvedContractAddress) {
      const verifiedAbi = await this.abiProvider.getAbi(resolvedContractAddress, chainId);
      if (verifiedAbi) {
        try {
          const decoded = decodeFunctionData({
            abi: verifiedAbi as Abi,
            data: rawCalldata,
          });

          const args: Parameter[] = (decoded.args || []).map((arg, idx) => ({
            name: `arg${idx}`,
            type: 'unknown',
            value: typeof arg === 'bigint' ? arg.toString() : String(arg),
            rawValue: arg,
          }));

          const provenance: AbiProvenance = proxyInfo
            ? 'proxy_implementation'
            : 'verified_contract';

          return {
            type: 'transaction',
            target: rawTarget,
            targetContract: rawTarget,
            caller,
            callType,
            selector,
            functionName: decoded.functionName,
            decodedFunction: decoded.functionName,
            signature: `${decoded.functionName}(...)`,
            arguments: args,
            parameters: args,
            assetStandard: 'none',
            nativeValue: value,
            abiProvenance: provenance,
            proxyInfo,
            confidence: {
              level: 'high',
              reason: proxyInfo
                ? `Decoded using verified implementation ABI (${proxyInfo.implementationAddress}) via ${proxyInfo.proxyStandard || 'proxy'}`
                : `Decoded using verified contract ABI for ${rawTarget}`,
            },
            unresolvedQuestions: [
              'Note: Verified ABI match identifies function schema; execution behavior depends on contract logic.',
            ],
            rawCalldata,
            isUnknownFunction: false,
          };
        } catch {
          // Fall through if custom ABI decode fails for this payload
        }
      }
    }

    // 9. Standard ABI Variants & Overlapping Selector Ambiguity Resolution
    const ifaceEvidence = rawTarget
      ? await this.interfaceResolver.resolveInterface(rawTarget as Address, chainId)
      : null;

    // --- OVERLAPPING: 0x23b872dd transferFrom(address,address,uint256) ---
    if (selector === STANDARD_SELECTORS.TRANSFER_FROM) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC20_ABI,
          data: rawCalldata,
        });
        const [from, to, valOrTokenId] = decoded.args as [Address, Address, bigint];
        const valStr = valOrTokenId.toString();

        const args: Parameter[] = [
          { name: 'from', type: 'address', value: from },
          { name: 'to', type: 'address', value: to },
          { name: 'valueOrTokenId', type: 'uint256', value: valStr },
        ];

        let assetStandard: AssetStandard = 'ERC-20 | ERC-721 (ambiguous)';
        let confidenceReason =
          'Selector 0x23b872dd matches transferFrom(address,address,uint256), which is identical in ERC-20 and ERC-721.';
        const unresolvedQuestions: string[] = [];

        let amount: string | undefined = undefined;
        let tokenIds: string[] | undefined = undefined;

        if (ifaceEvidence?.assetStandard === 'ERC-721') {
          assetStandard = 'ERC-721';
          tokenIds = [valStr];
          confidenceReason = 'Interface evidence confirms target is an ERC-721 non-fungible token.';
        } else if (ifaceEvidence?.assetStandard === 'ERC-20') {
          assetStandard = 'ERC-20';
          amount = valStr;
          confidenceReason = 'Interface evidence confirms target is an ERC-20 fungible token.';
        } else {
          // Ambiguous! Preserve ambiguity losslessly
          amount = valStr;
          tokenIds = [valStr];
          unresolvedQuestions.push(
            'Cannot establish whether parameter 2 is an ERC-20 token amount or an ERC-721 tokenId without contract interface or bytecode evidence.'
          );
        }

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'transferFrom',
          decodedFunction: 'transferFrom',
          signature: 'transferFrom(address from, address to, uint256 valueOrTokenId)',
          arguments: args,
          parameters: args,
          assetStandard,
          owner: from,
          recipient: to,
          amount,
          tokenIds,
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: {
            level: ifaceEvidence ? 'high' : 'medium',
            reason: confidenceReason,
          },
          unresolvedQuestions,
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- OVERLAPPING: 0xa22cb465 setApprovalForAll(address,bool) ---
    if (selector === STANDARD_SELECTORS.SET_APPROVAL_FOR_ALL) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC721_ABI,
          data: rawCalldata,
        });
        const [operator, approved] = decoded.args as [Address, boolean];

        const args: Parameter[] = [
          { name: 'operator', type: 'address', value: operator },
          { name: 'approved', type: 'bool', value: String(approved) },
        ];

        let assetStandard: AssetStandard = 'ERC-721 | ERC-1155 (ambiguous)';
        let confidenceReason =
          'Selector 0xa22cb465 matches setApprovalForAll(address,bool), shared between ERC-721 and ERC-1155.';
        const unresolvedQuestions: string[] = [];

        if (ifaceEvidence?.assetStandard === 'ERC-721') {
          assetStandard = 'ERC-721';
          confidenceReason = 'Interface evidence confirms target is an ERC-721 collection.';
        } else if (ifaceEvidence?.assetStandard === 'ERC-1155') {
          assetStandard = 'ERC-1155';
          confidenceReason = 'Interface evidence confirms target is an ERC-1155 multi-token contract.';
        } else {
          unresolvedQuestions.push(
            'Cannot establish whether target is an ERC-721 single-token collection or an ERC-1155 multi-token contract without interface check.'
          );
        }

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'setApprovalForAll',
          decodedFunction: 'setApprovalForAll',
          signature: 'setApprovalForAll(address operator, bool approved)',
          arguments: args,
          parameters: args,
          assetStandard,
          spenderOrOperator: operator,
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: {
            level: ifaceEvidence ? 'high' : 'medium',
            reason: confidenceReason,
          },
          unresolvedQuestions,
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-20: approve(address,uint256) ---
    if (selector === STANDARD_SELECTORS.APPROVE) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC20_ABI,
          data: rawCalldata,
        });
        const [spender, amt] = decoded.args as [Address, bigint];
        const amtStr = amt.toString();
        const args: Parameter[] = [
          { name: 'spender', type: 'address', value: spender },
          { name: 'amount', type: 'uint256', value: amtStr },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'approve',
          decodedFunction: 'approve',
          signature: 'approve(address spender, uint256 amount)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-20',
          spenderOrOperator: spender,
          amount: amtStr,
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-20 approve specification' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-20: transfer(address,uint256) ---
    if (selector === STANDARD_SELECTORS.TRANSFER) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC20_ABI,
          data: rawCalldata,
        });
        const [to, amt] = decoded.args as [Address, bigint];
        const amtStr = amt.toString();
        const args: Parameter[] = [
          { name: 'to', type: 'address', value: to },
          { name: 'amount', type: 'uint256', value: amtStr },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'transfer',
          decodedFunction: 'transfer',
          signature: 'transfer(address to, uint256 amount)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-20',
          recipient: to,
          amount: amtStr,
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-20 transfer specification' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-721: safeTransferFrom(address,address,uint256) ---
    if (selector === STANDARD_SELECTORS.SAFE_TRANSFER_FROM_3) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC721_ABI,
          data: rawCalldata,
        });
        const [from, to, tokenId] = decoded.args as [Address, Address, bigint];
        const tokStr = tokenId.toString();
        const args: Parameter[] = [
          { name: 'from', type: 'address', value: from },
          { name: 'to', type: 'address', value: to },
          { name: 'tokenId', type: 'uint256', value: tokStr },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'safeTransferFrom',
          decodedFunction: 'safeTransferFrom',
          signature: 'safeTransferFrom(address from, address to, uint256 tokenId)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-721',
          owner: from,
          recipient: to,
          tokenIds: [tokStr],
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-721 safeTransferFrom (3 arguments)' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-721: safeTransferFrom(address,address,uint256,bytes) ---
    if (selector === STANDARD_SELECTORS.SAFE_TRANSFER_FROM_4) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC721_ABI,
          data: rawCalldata,
        });
        const [from, to, tokenId, dataBytes] = decoded.args as [Address, Address, bigint, Hex];
        const tokStr = tokenId.toString();
        const args: Parameter[] = [
          { name: 'from', type: 'address', value: from },
          { name: 'to', type: 'address', value: to },
          { name: 'tokenId', type: 'uint256', value: tokStr },
          { name: 'data', type: 'bytes', value: dataBytes },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'safeTransferFrom',
          decodedFunction: 'safeTransferFrom',
          signature: 'safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-721',
          owner: from,
          recipient: to,
          tokenIds: [tokStr],
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-721 safeTransferFrom (4 arguments with bytes data)' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-1155: safeTransferFrom(address,address,uint256,uint256,bytes) ---
    if (selector === STANDARD_SELECTORS.SAFE_TRANSFER_FROM_1155) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC1155_ABI,
          data: rawCalldata,
        });
        const [from, to, id, amt, dataBytes] = decoded.args as [Address, Address, bigint, bigint, Hex];
        const idStr = id.toString();
        const amtStr = amt.toString();
        const args: Parameter[] = [
          { name: 'from', type: 'address', value: from },
          { name: 'to', type: 'address', value: to },
          { name: 'id', type: 'uint256', value: idStr },
          { name: 'amount', type: 'uint256', value: amtStr },
          { name: 'data', type: 'bytes', value: dataBytes },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'safeTransferFrom',
          decodedFunction: 'safeTransferFrom',
          signature: 'safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-1155',
          owner: from,
          recipient: to,
          amount: amtStr,
          tokenIds: [idStr],
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-1155 single-token safeTransferFrom' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-1155: safeBatchTransferFrom(address,address,uint256[],uint256[],bytes) ---
    if (selector === STANDARD_SELECTORS.SAFE_BATCH_TRANSFER_FROM_1155) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC1155_ABI,
          data: rawCalldata,
        });
        const [from, to, ids, amounts, dataBytes] = decoded.args as [Address, Address, bigint[], bigint[], Hex];
        const idsStr = ids.map((i) => i.toString());
        const args: Parameter[] = [
          { name: 'from', type: 'address', value: from },
          { name: 'to', type: 'address', value: to },
          { name: 'ids', type: 'uint256[]', value: `${ids.length} token IDs` },
          { name: 'amounts', type: 'uint256[]', value: `${amounts.length} amounts` },
          { name: 'data', type: 'bytes', value: dataBytes },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'safeBatchTransferFrom',
          decodedFunction: 'safeBatchTransferFrom',
          signature: 'safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-1155',
          owner: from,
          recipient: to,
          tokenIds: idsStr,
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-1155 batch transfer specification' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // --- ERC-2612: permit(address,address,uint256,uint256,uint8,bytes32,bytes32) ---
    if (selector === STANDARD_SELECTORS.PERMIT) {
      try {
        const decoded = decodeFunctionData({
          abi: STANDARD_ERC20_ABI,
          data: rawCalldata,
        });
        const [owner, spender, val, deadline, v, r, s] = decoded.args as [Address, Address, bigint, bigint, number, Hex, Hex];
        const valStr = val.toString();
        const args: Parameter[] = [
          { name: 'owner', type: 'address', value: owner },
          { name: 'spender', type: 'address', value: spender },
          { name: 'value', type: 'uint256', value: valStr },
          { name: 'deadline', type: 'uint256', value: deadline.toString() },
          { name: 'v', type: 'uint8', value: String(v) },
          { name: 'r', type: 'bytes32', value: r },
          { name: 's', type: 'bytes32', value: s },
        ];

        return {
          type: 'transaction',
          target: rawTarget,
          targetContract: rawTarget,
          caller,
          callType,
          selector,
          functionName: 'permit',
          decodedFunction: 'permit',
          signature: 'permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
          arguments: args,
          parameters: args,
          assetStandard: 'ERC-2612',
          owner,
          spenderOrOperator: spender,
          amount: valStr,
          nativeValue: value,
          abiProvenance: 'standard_abi',
          confidence: { level: 'high', reason: 'Matches canonical ERC-2612 on-chain permit method' },
          unresolvedQuestions: [],
          proxyInfo,
          rawCalldata,
          isUnknownFunction: false,
        };
      } catch {
        // Fall through
      }
    }

    // 10. Query Candidate Selector Database
    // Requirement: "Query a selector database only for candidate signatures...
    // A selector match or ABI-compatible decode must never be presented as proof of contract behavior."
    const lookup = await this.abiProvider.lookupSelector(selector);
    if (lookup && lookup.isCandidate) {
      return {
        type: 'transaction',
        target: rawTarget,
        targetContract: rawTarget,
        caller,
        callType,
        selector,
        functionName: lookup.functionName,
        decodedFunction: lookup.functionName,
        candidateFunction: lookup.functionName,
        signature: lookup.signature,
        arguments: [
          {
            name: 'unparsedCalldata',
            type: 'bytes',
            value: `0x${rawCalldata.slice(10)}`,
          },
        ],
        parameters: [
          {
            name: 'unparsedCalldata',
            type: 'bytes',
            value: `0x${rawCalldata.slice(10)}`,
          },
        ],
        assetStandard: 'unknown',
        nativeValue: value,
        abiProvenance: 'candidate_database',
        confidence: {
          level: 'low',
          reason: 'Matched candidate signature in public 4-byte database. A selector match does not prove contract behavior.',
        },
        unresolvedQuestions: [
          lookup.disclaimer || "A selector match does not prove a function's meaning.",
          'Contract bytecode and runtime effects remain unverified without verified ABI or execution trace.',
        ],
        proxyInfo,
        isCandidate: true,
        candidateDisclaimer: lookup.disclaimer || "A selector match does not prove a function's meaning.",
        rawCalldata,
        isUnknownFunction: false,
      };
    }

    // 11. Completely Unknown Function
    // Requirement: "Preserve raw calldata even when decoding succeeds... Explicitly mark the function unknown if meaning remains unresolved."
    return {
      type: 'transaction',
      target: rawTarget,
      targetContract: rawTarget,
      caller,
      callType,
      selector,
      functionName: `unknown_${selector}`,
      decodedFunction: `unknown_${selector}`,
      signature: `unknown_${selector}()`,
      arguments: [
        {
          name: 'rawCalldata',
          type: 'bytes',
          value: rawCalldata,
        },
      ],
      parameters: [
        {
          name: 'rawCalldata',
          type: 'bytes',
          value: rawCalldata,
        },
      ],
      assetStandard: 'unknown',
      nativeValue: value,
      abiProvenance: 'unknown',
      confidence: {
        level: 'low',
        reason: 'Function selector is unknown, not found in standard ABIs or candidate database, and contract has no verified source.',
      },
      unresolvedQuestions: [
        `Unknown selector ${selector}: Contract interface and runtime side-effects are completely unresolved.`,
      ],
      proxyInfo,
      rawCalldata,
      isUnknownFunction: true,
    };
  }
}

export const defaultIntentDecoder = new IntentDecoder();
