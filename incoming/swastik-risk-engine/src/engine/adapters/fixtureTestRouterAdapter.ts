import { decodeAbiParameters, parseAbiParameters, type Address, type Hex } from 'viem';
import { type RouterAdapter, type RouterAdapterDecodeParams } from './types';
import { type DecodedIntent } from '../../schemas/intent';

export const FIXTURE_ROUTER_ADDRESS = '0xF187000000000000000000000000000000000001'.toLowerCase();
export const FIXTURE_DISPATCH_BATCH_SELECTOR = '0xb1a7c001';

export class FixtureTestRouterAdapter implements RouterAdapter {
  public readonly id = 'fixture_test_router_adapter';
  public readonly name = 'Fixture Batch Dispatcher (Fixture Only Support)';
  public readonly isFixtureOnly = true;

  public canHandle(target: string, calldata: string): boolean {
    if (target.toLowerCase() !== FIXTURE_ROUTER_ADDRESS) {
      return false;
    }
    return calldata.slice(0, 10).toLowerCase() === FIXTURE_DISPATCH_BATCH_SELECTOR;
  }

  public async decode(params: RouterAdapterDecodeParams): Promise<DecodedIntent | null> {
    const { target, calldata, caller, depth, decodeSubcall } = params;
    const selector = calldata.slice(0, 10).toLowerCase();

    try {
      // Decode (address target, uint256 value, bytes data)[]
      const [calls] = decodeAbiParameters(
        parseAbiParameters('(address target, uint256 value, bytes data)[]'),
        `0x${calldata.slice(10)}` as Hex
      );

      const nested: DecodedIntent[] = [];
      for (const call of calls) {
        const sub = await decodeSubcall(
          call.target,
          call.data,
          call.value.toString(),
          target,
          'call',
          depth + 1
        );
        nested.push(sub);
      }

      return {
        type: 'transaction',
        target,
        caller,
        callType: 'call',
        functionName: 'dispatchBatch',
        decodedFunction: 'dispatchBatch',
        selector,
        signature: 'dispatchBatch((address,uint256,bytes)[])',
        arguments: [{ name: 'calls', type: 'tuple(address,uint256,bytes)[]', value: `${calls.length} fixture subcalls` }],
        parameters: [{ name: 'calls', type: 'tuple(address,uint256,bytes)[]', value: `${calls.length} fixture subcalls` }],
        assetStandard: 'none',
        nativeValue: '0',
        abiProvenance: 'router_adapter',
        confidence: { level: 'high', reason: 'Decoded via explicitly labeled FixtureTestRouterAdapter (Test Environment Only)' },
        unresolvedQuestions: ['Notice: Fixture-only router adapter used; not active in live production routing.'],
        nestedCalls: nested,
        rawCalldata: calldata,
        isUnknownFunction: false,
      };
    } catch {
      return null;
    }
  }
}
