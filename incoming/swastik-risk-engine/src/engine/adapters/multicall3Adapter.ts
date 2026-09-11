import { decodeFunctionData, type Address, type Hex } from 'viem';
import { MULTICALL3_ABI } from '../../providers/abiProvider';
import { type RouterAdapter, type RouterAdapterDecodeParams } from './types';
import { type DecodedIntent } from '../../schemas/intent';

export const MULTICALL3_CANONICAL = '0xcA11bde05977b3631167028862bE2a173976CA11'.toLowerCase();

export class Multicall3Adapter implements RouterAdapter {
  public readonly id = 'multicall3_adapter';
  public readonly name = 'Multicall3';
  public readonly isFixtureOnly = false;

  private supportedAddresses: Set<string>;

  constructor(additionalAddresses: string[] = []) {
    this.supportedAddresses = new Set([
      MULTICALL3_CANONICAL,
      ...additionalAddresses.map((a) => a.toLowerCase()),
    ]);
  }

  public canHandle(target: string, calldata: string): boolean {
    if (!this.supportedAddresses.has(target.toLowerCase())) {
      return false;
    }
    const sel = calldata.slice(0, 10).toLowerCase();
    // aggregate, aggregate3, aggregate3Value
    return ['0x252dba42', '0x82ad56cb', '0x171340e0'].includes(sel);
  }

  public async decode(params: RouterAdapterDecodeParams): Promise<DecodedIntent | null> {
    const { target, calldata, caller, depth, decodeSubcall } = params;
    const selector = calldata.slice(0, 10).toLowerCase();

    try {
      if (selector === '0x252dba42') {
        // aggregate((address,bytes)[])
        const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: calldata as Hex });
        const calls = (decoded.args as unknown as [{ target: Address; callData: Hex }[]])[0];

        const nested: DecodedIntent[] = [];
        for (const c of calls) {
          // Multicall3 executes subcalls using regular CALL from Multicall3 address
          const sub = await decodeSubcall(c.target, c.callData, '0', target, 'call', depth + 1);
          nested.push(sub);
        }

        return {
          type: 'transaction',
          target,
          caller,
          callType: 'call',
          functionName: 'aggregate',
          decodedFunction: 'aggregate',
          selector,
          signature: 'aggregate((address,bytes)[])',
          arguments: [{ name: 'calls', type: 'tuple(address,bytes)[]', value: `${calls.length} subcalls` }],
          parameters: [{ name: 'calls', type: 'tuple(address,bytes)[]', value: `${calls.length} subcalls` }],
          assetStandard: 'none',
          nativeValue: '0',
          abiProvenance: 'router_adapter',
          confidence: { level: 'high', reason: 'Verified canonical Multicall3 deployment contract' },
          unresolvedQuestions: [],
          nestedCalls: nested,
          rawCalldata: calldata,
          isUnknownFunction: false,
        };
      }

      if (selector === '0x82ad56cb') {
        // aggregate3((address,bool,bytes)[])
        const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: calldata as Hex });
        const calls = (decoded.args as unknown as [{ target: Address; allowFailure: boolean; callData: Hex }[]])[0];

        const nested: DecodedIntent[] = [];
        for (const c of calls) {
          const sub = await decodeSubcall(c.target, c.callData, '0', target, 'call', depth + 1);
          nested.push(sub);
        }

        return {
          type: 'transaction',
          target,
          caller,
          callType: 'call',
          functionName: 'aggregate3',
          decodedFunction: 'aggregate3',
          selector,
          signature: 'aggregate3((address,bool,bytes)[])',
          arguments: [{ name: 'calls', type: 'tuple(address,bool,bytes)[]', value: `${calls.length} subcalls (allowFailure)` }],
          parameters: [{ name: 'calls', type: 'tuple(address,bool,bytes)[]', value: `${calls.length} subcalls (allowFailure)` }],
          assetStandard: 'none',
          nativeValue: '0',
          abiProvenance: 'router_adapter',
          confidence: { level: 'high', reason: 'Verified canonical Multicall3 deployment contract' },
          unresolvedQuestions: [],
          nestedCalls: nested,
          rawCalldata: calldata,
          isUnknownFunction: false,
        };
      }

      if (selector === '0x171340e0') {
        // aggregate3Value((address,bool,uint256,bytes)[])
        const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: calldata as Hex });
        const calls = (decoded.args as unknown as [{ target: Address; allowFailure: boolean; value: bigint; callData: Hex }[]])[0];

        const nested: DecodedIntent[] = [];
        for (const c of calls) {
          const sub = await decodeSubcall(c.target, c.callData, c.value.toString(), target, 'call', depth + 1);
          nested.push(sub);
        }

        return {
          type: 'transaction',
          target,
          caller,
          callType: 'call',
          functionName: 'aggregate3Value',
          decodedFunction: 'aggregate3Value',
          selector,
          signature: 'aggregate3Value((address,bool,uint256,bytes)[])',
          arguments: [{ name: 'calls', type: 'tuple(address,bool,uint256,bytes)[]', value: `${calls.length} payable subcalls` }],
          parameters: [{ name: 'calls', type: 'tuple(address,bool,uint256,bytes)[]', value: `${calls.length} payable subcalls` }],
          assetStandard: 'none',
          nativeValue: '0',
          abiProvenance: 'router_adapter',
          confidence: { level: 'high', reason: 'Verified canonical Multicall3 deployment contract' },
          unresolvedQuestions: [],
          nestedCalls: nested,
          rawCalldata: calldata,
          isUnknownFunction: false,
        };
      }
    } catch {
      return null;
    }

    return null;
  }
}
