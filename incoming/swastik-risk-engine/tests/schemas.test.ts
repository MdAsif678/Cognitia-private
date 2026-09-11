import { describe, it, expect } from 'vitest';
import {
  analysisRequestSchema,
  transactionAnalysisRequestSchema,
  eip712AnalysisRequestSchema,
  personalSignAnalysisRequestSchema,
  evidenceSchema,
  findingSchema,
  coverageSchema,
  simulationResultSchema,
  analysisReportSchema,
} from '../src/schemas';

describe('Shared Schemas Validation', () => {
  it('validates a valid transaction request with lossless decimal value', () => {
    const validTx = {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      value: '1000000000000000000', // 1 ETH in wei (lossless decimal string)
      calldata: '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000de0b6b3a7640000',
    };

    const parsed = transactionAnalysisRequestSchema.safeParse(validTx);
    expect(parsed.success).toBe(true);
  });

  it('rejects transaction request when value is missing (never treats missing data as zero)', () => {
    const missingValueTx = {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      calldata: '0x',
    };

    const parsed = transactionAnalysisRequestSchema.safeParse(missingValueTx);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('Integer value must be explicitly provided');
    }
  });

  it('rejects invalid EVM address formats', () => {
    const badAddressTx = {
      type: 'transaction',
      chainId: 1,
      from: 'not-an-address',
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      value: '0',
      calldata: '0x',
    };

    const parsed = transactionAnalysisRequestSchema.safeParse(badAddressTx);
    expect(parsed.success).toBe(false);
  });

  it('validates EIP-712 request and personal_sign schemas', () => {
    const validEip712 = {
      type: 'eip712',
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      selectedChainId: 1,
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
          chainId: 1,
          verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
        message: {
          owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          spender: '0x1111111254fb6c44bac0bed2854e76f90643097d',
          value: '500000000',
        },
      },
    };
    expect(eip712AnalysisRequestSchema.safeParse(validEip712).success).toBe(true);

    const validPersonalSign = {
      type: 'personal_sign',
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      rawMessage: 'Sign in to Cognitia Security Console: 1690000000',
    };
    expect(personalSignAnalysisRequestSchema.safeParse(validPersonalSign).success).toBe(true);
  });

  it('verifies Finding schema requires all 9 fields with confidence reason and executionContext', () => {
    const validFinding = {
      id: 'f-1',
      ruleId: 'documented_malicious_spender',
      severity: 'critical',
      title: 'Malicious Spender',
      plainEnglishExplanation: 'Spender is known drainer.',
      evidenceIds: ['ev-1'],
      confidence: {
        level: 'high',
        reason: 'Direct match with SlowMist threat intel feed',
      },
      assumptions: ['Target token implements standard ERC-20 allowances'],
      executionContext: 'decoded_intent',
      remediation: 'Do not sign.',
    };

    expect(findingSchema.safeParse(validFinding).success).toBe(true);

    // Missing confidence reason should fail
    const invalidFinding = { ...validFinding, confidence: { level: 'high' } };
    expect(findingSchema.safeParse(invalidFinding).success).toBe(false);
  });

  it('rejects reports that label a transaction safe', () => {
    const unsafeReport = {
      requestId: 'req-1',
      timestamp: new Date().toISOString(),
      overallSeverity: 'low',
      riskScore: 10,
      summary: 'This transaction is safe to sign.', // FORBIDDEN
      coverage: {
        status: 'complete',
        reasons: [],
        components: {
          calldataDecoding: 'complete',
          signatureAnalysis: 'complete',
          simulation: 'complete',
          threatMatching: 'complete',
        },
      },
      decodedIntent: {
        type: 'transaction',
        functionName: 'transfer',
        rawCalldata: '0x',
        isUnknownFunction: false,
      },
      findings: [],
      evidence: {},
      rawRequest: {
        type: 'transaction',
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        calldata: '0x',
      },
    };

    const parsed = analysisReportSchema.safeParse(unsafeReport);
    expect(parsed.success).toBe(false);
  });

  it('validates Coverage schema tracking complete, partial, unsupported, and failed', () => {
    const validCoverage = {
      status: 'partial',
      reasons: ['Unverified function selector'],
      components: {
        calldataDecoding: 'partial',
        signatureAnalysis: 'complete',
        simulation: 'complete',
        threatMatching: 'complete',
      },
    };

    expect(coverageSchema.safeParse(validCoverage).success).toBe(true);
  });
});
