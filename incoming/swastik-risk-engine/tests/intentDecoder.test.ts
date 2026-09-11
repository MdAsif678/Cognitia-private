import { describe, it, expect } from 'vitest';
import { IntentDecoder } from '../src/engine/intentDecoder';
import { encodeFunctionData, parseAbi } from 'viem';
import { STANDARD_ERC20_ABI, MULTICALL3_ABI } from '../src/providers/abiProvider';

describe('IntentDecoder', () => {
  const decoder = new IntentDecoder();

  it('decodes standard ERC-20 approve', async () => {
    const spender = '0x1111111254fb6c44bac0bed2854e76f90643097d';
    const amount = 1000000n;

    const calldata = encodeFunctionData({
      abi: STANDARD_ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });

    const decoded = await decoder.decode(calldata, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0', 1);

    expect(decoded.functionName).toBe('approve');
    expect(decoded.isUnknownFunction).toBe(false);
    expect(decoded.parameters?.find((p) => p.name === 'spender')?.value.toLowerCase()).toBe(spender.toLowerCase());
    expect(decoded.parameters?.find((p) => p.name === 'amount')?.value).toBe(amount.toString());
  });

  it('decodes nested Multicall3 aggregate calls recursively', async () => {
    const subCall1 = encodeFunctionData({
      abi: STANDARD_ERC20_ABI,
      functionName: 'approve',
      args: ['0x1111111254fb6c44bac0bed2854e76f90643097d', 500n],
    });
    const subCall2 = encodeFunctionData({
      abi: STANDARD_ERC20_ABI,
      functionName: 'transfer',
      args: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 100n],
    });

    const multicallData = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: 'aggregate',
      args: [
        [
          { target: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', callData: subCall1 },
          { target: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', callData: subCall2 },
        ],
      ],
    });

    const decoded = await decoder.decode(multicallData, '0xcA11bde05977b3631167028862bE2a173976CA11', '0', 1);

    expect(decoded.functionName).toBe('aggregate');
    expect(decoded.nestedCalls).toBeDefined();
    expect(decoded.nestedCalls?.length).toBe(2);
    expect(decoded.nestedCalls?.[0].functionName).toBe('approve');
    expect(decoded.nestedCalls?.[1].functionName).toBe('transfer');
  });

  it('identifies candidate selector with unverified warning disclaimer', async () => {
    // 0xd0e30db0 is deposit()
    const depositCalldata = '0xd0e30db0';
    const decoded = await decoder.decode(depositCalldata, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0', 1);

    expect(decoded.isCandidate).toBe(true);
    expect(decoded.candidateDisclaimer).toBe("A selector match does not prove a function's meaning.");
    expect(decoded.functionName).toBe('deposit');
  });

  it('preserves raw calldata and marks unverified function as unknown', async () => {
    const unknownCalldata = '0x999988881111222233334444555566667777888899990000aaaabbbbccccdddd';
    const decoded = await decoder.decode(unknownCalldata, '0x1234567890123456789012345678901234567890', '0', 1);

    expect(decoded.isUnknownFunction).toBe(true);
    expect(decoded.rawCalldata).toBe(unknownCalldata);
    expect(decoded.functionName).toBe('unknown_0x99998888');
  });
});
