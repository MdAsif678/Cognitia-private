import { describe, it, expect } from 'vitest';
import { Erc2612SignatureAdapter } from '../src/providers/signatureAdapters/erc2612Adapter';
import { Permit2SignatureAdapter } from '../src/providers/signatureAdapters/permit2Adapter';
import { PersonalSignSignatureAdapter } from '../src/providers/signatureAdapters/personalSignAdapter';

describe('Signature Adapters', () => {
  const erc2612 = new Erc2612SignatureAdapter();
  const permit2 = new Permit2SignatureAdapter();
  const personalSign = new PersonalSignSignatureAdapter();

  it('correctly processes valid ERC-2612 permit and outputs simulatedPermitTarget', async () => {
    const validPermitReq = {
      type: 'eip712' as const,
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      selectedChainId: 1,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        domain: {
          name: 'USDC',
          chainId: 1,
          verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
        message: {
          owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          spender: '0x1111111254fb6c44bac0bed2854e76f90643097d',
          value: '100000000',
          nonce: '0',
          deadline: '2000000000',
        },
      },
    };

    expect(erc2612.canHandle(validPermitReq)).toBe(true);
    const res = await erc2612.analyze(validPermitReq);

    expect(res.coverage).toBe('complete');
    expect(res.simulatedPermitTarget).toBeDefined();
    expect(res.simulatedPermitTarget?.token.toLowerCase()).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase());
    expect(res.simulatedPermitTarget?.value).toBe(100000000n);
  });

  it('detects chain mismatch in ERC-2612 permit and creates inconsistency finding', async () => {
    const mismatchedChainReq = {
      type: 'eip712' as const,
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      selectedChainId: 1, // Active target is Ethereum
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        domain: {
          name: 'USDC',
          chainId: 137, // Domain says Polygon!
          verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
        message: {
          owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          spender: '0x1111111254fb6c44bac0bed2854e76f90643097d',
          value: '1000',
        },
      },
    };

    const res = await erc2612.analyze(mismatchedChainReq);
    expect(res.coverage).toBe('partial');
    expect(res.findings.length).toBeGreaterThan(0);
    expect(res.findings[0].title).toContain('Inconsistency');
  });

  it('registers PermitSingle as unsupported in Permit2 adapter with extension point', async () => {
    const permit2Req = {
      type: 'eip712' as const,
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      selectedChainId: 1,
      payload: {
        types: {
          PermitSingle: [{ name: 'details', type: 'PermitDetails' }],
        },
        primaryType: 'PermitSingle',
        domain: {
          verifyingContract: '0x000000000022d473030f116ddee9f6b43ac78ba3',
        },
        message: {
          details: {
            token: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
            amount: '500000000000000000000',
          },
          spender: '0x3333333333333333333333333333333333333333',
          sigDeadline: '2000000000',
        },
      },
    };

    expect(permit2.canHandle(permit2Req)).toBe(true);
    const res = await permit2.analyze(permit2Req);
    expect(res.coverage).toBe('unsupported');
    expect(res.simulatedPermitTarget).toBeUndefined();
    expect(res.findings.length).toBe(1);
    expect(res.findings[0].ruleId).toBe('permit2_unsupported_adapter');
    expect(res.intent.isUnknownFunction).toBe(true);
  });

  it('flags 32-byte hex hash in personal_sign as suspicious disguised transaction', async () => {
    const disguisedReq = {
      type: 'personal_sign' as const,
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      rawMessage: '0x12a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3', // 32-byte hash
    };

    const res = await personalSign.analyze(disguisedReq);
    expect(res.findings.length).toBe(1);
    expect(res.findings[0].severity).toBe('high');
    expect(res.findings[0].ruleId).toBe('personal_sign_disguised_transaction');
  });
});
