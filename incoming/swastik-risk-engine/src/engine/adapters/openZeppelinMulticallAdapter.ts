import { decodeFunctionData, type Hex } from 'viem';
import { OZ_MULTICALL_ABI } from '../../providers/abiProvider';
import { type RouterAdapter, type RouterAdapterDecodeParams } from './types';
import { type DecodedIntent } from '../../schemas/intent';

export class OpenZeppelinMulticallAdapter implements RouterAdapter {
  public readonly id = 'oz_multicall_adapter';
  public readonly name = 'OpenZeppelin Multicall';
  public readonly isFixtureOnly = false;

  private supportedAddresses = new Set<string>();

  public registerSupportedAddress(address: string): void {
    this.supportedAddresses.add(address.toLowerCase());
  }

  public canHandle(target: string, calldata: string): boolean {
    const sel = calldata.slice(0, 10).toLowerCase();
    // multicall(bytes[]) = 0xac9650d8
    if (sel !== '0xac9650d8') return false;

    // Only handle if explicitly supported or registered
    return this.supportedAddresses.has(target.toLowerCase());
  }

  public async decode(params: RouterAdapterDecodeParams): Promise<DecodedIntent | null> {
    const { target, calldata, caller, depth, decodeSubcall } = params;
    const selector = calldata.slice(0, 10).toLowerCase();

    try {
      const decoded = decodeFunctionData({ abi: OZ_MULTICALL_ABI, data: calldata as Hex });
      const calls = (decoded.args as unknown as [Hex[]])[0];

      const nested: DecodedIntent[] = [];
      for (const callData of calls) {
        // OpenZeppelin multicall executes via DELEGATECALL on address(this)
        // Execution semantics: caller is preserved, target is self, callType is delegatecall
        const sub = await decodeSubcall(target, callData, '0', caller, 'delegatecall', depth + 1);
        nested.push(sub);
      }

      return {
        type: 'transaction',
        target,
        caller,
        callType: 'call',
        functionName: 'multicall',
        decodedFunction: 'multicall',
        selector,
        signature: 'multicall(bytes[])',
        arguments: [{ name: 'data', type: 'bytes[]', value: `${calls.length} delegatecall batches` }],
        parameters: [{ name: 'data', type: 'bytes[]', value: `${calls.length} delegatecall batches` }],
        assetStandard: 'none',
        nativeValue: '0',
        abiProvenance: 'router_adapter',
        confidence: { level: 'high', reason: 'OpenZeppelin Multicall with preserved delegatecall execution context' },
        unresolvedQuestions: [],
        nestedCalls: nested,
        rawCalldata: calldata,
        isUnknownFunction: false,
      };
    } catch {
      return null;
    }
  }
}
