import { isAddress } from 'viem';
import { type SignatureAdapterProvider } from '../types';
import { type AnalysisRequest, type Eip712AnalysisRequest } from '../../schemas/request';
import { type DecodedIntent } from '../../schemas/intent';
import { type Finding } from '../../schemas/finding';
import { type Evidence } from '../../schemas/evidence';

export const PERMIT2_CANONICAL = '0x000000000022d473030f116ddee9f6b43ac78ba3'.toLowerCase();

/**
 * ============================================================================
 * EXTENSION POINT: Uniswap Permit2 Supported-Token Adapter
 * ============================================================================
 * To implement complete Permit2 support in a future release:
 * 1. Pinned Block Verification:
 *    - Query on-chain `allowance(owner, token, spender)` on the canonical Permit2 contract
 *      (returns `amount`, `expiration`, `nonce`).
 *    - Verify sequence against the owner's Permit2 nonce.
 *    - Validate `sigDeadline` against block timestamp.
 * 2. Witness Validation:
 *    - When `PermitWitnessTransferFrom` or `PermitBatchWitnessTransferFrom` is used,
 *      reconstruct the witness type hash and verify nested parameters.
 * 3. Batch Authorization Modeling:
 *    - For `PermitBatch`, simulate multi-token allowance state overrides atomically.
 *
 * Current Status: Explicitly Unsupported (Partial decoding prohibited).
 * ============================================================================
 */
export class Permit2SignatureAdapter implements SignatureAdapterProvider {
  public readonly id = 'permit2_adapter';

  public canHandle(request: AnalysisRequest): boolean {
    if (request.type !== 'eip712') return false;
    const req = request as Eip712AnalysisRequest;
    const verifyingContract = req.payload.domain?.verifyingContract?.toLowerCase();
    const primaryType = req.payload.primaryType;

    return (
      verifyingContract === PERMIT2_CANONICAL ||
      ['PermitSingle', 'PermitBatch', 'PermitTransferFrom', 'PermitWitnessTransferFrom', 'PermitBatchWitnessTransferFrom'].includes(primaryType)
    );
  }

  public async analyze(request: AnalysisRequest): Promise<{
    intent: DecodedIntent;
    findings: Finding[];
    evidence: Evidence[];
    coverage: 'unsupported';
    reasons: string[];
    simulatedPermitTarget: undefined;
  }> {
    const req = request as Eip712AnalysisRequest;
    const msg = req.payload.message || {};
    const domain = req.payload.domain || {};
    const primaryType = req.payload.primaryType;

    const verifyingContract = domain.verifyingContract || PERMIT2_CANONICAL;
    const evidenceId = `ev-permit2-${Date.now()}`;

    const reason =
      'Uniswap Permit2 signatures use a multi-token allowance and witness system. This adapter registers Permit2 as explicitly unsupported for now. Partial decoding is intentionally omitted to avoid implying complete verified coverage.';

    const intent: DecodedIntent = {
      type: 'eip712',
      target: isAddress(verifyingContract, { strict: false }) ? verifyingContract : undefined,
      targetContract: isAddress(verifyingContract, { strict: false }) ? verifyingContract : undefined,
      functionName: `permit2_${primaryType}`,
      candidateFunction: primaryType,
      signature: `${primaryType}(...)`,
      isCandidate: true,
      candidateDisclaimer: 'A pattern match does not prove a function meaning. Permit2 execution effects remain unresolved.',
      arguments: Object.entries(msg).map(([name, val]) => ({
        name,
        type: 'unknown',
        value: typeof val === 'object' ? JSON.stringify(val) : String(val),
      })),
      parameters: Object.entries(msg).map(([name, val]) => ({
        name,
        type: 'unknown',
        value: typeof val === 'object' ? JSON.stringify(val) : String(val),
      })),
      assetStandard: 'unknown',
      nativeValue: '0',
      abiProvenance: 'unknown',
      confidence: {
        level: 'low',
        reason: 'Permit2 adapter registered as explicitly unsupported; partial decoding prohibited',
      },
      unresolvedQuestions: [
        'Permit2 allowance state, witness semantics, and transfer effects remain unresolved.',
      ],
      rawCalldata: '0x',
      isUnknownFunction: true,
      typedDataDetails: {
        standard: 'Permit2',
        primaryType,
        domain,
        fields: msg,
        rawPayload: req.payload as unknown as Record<string, unknown>,
        authorityStatus: 'unsupported',
        inconsistencies: [reason],
      },
    };

    const evidenceList: Evidence[] = [
      {
        id: evidenceId,
        type: 'ast_analysis',
        provenance: 'Permit2SignatureAdapter',
        relevantAddresses: [req.expectedSigner, verifyingContract].filter((a) => isAddress(a, { strict: false })),
        chainId: req.selectedChainId,
        rawSupportingData: {
          primaryType,
          domain,
          message: msg,
          extensionPoint: 'Permit2SignatureAdapter is currently a stub for future full support.',
        },
      },
    ];

    const findings: Finding[] = [
      {
        id: `finding-permit2-unsupported-${Date.now()}`,
        ruleId: 'permit2_unsupported_adapter',
        severity: 'unknown',
        title: 'Uniswap Permit2 Signature (Explicitly Unsupported)',
        plainEnglishExplanation: reason,
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Explicit adapter policy: Permit2 registered as unsupported pending full implementation' },
        assumptions: ['Downstream protocols may execute multi-token transfers or witness conditions via Permit2'],
        executionContext: 'decoded_intent',
        remediation: 'Do not rely on this report for Permit2 authorization verification. Consult the Uniswap Permit2 contract directly.',
      },
    ];

    return {
      intent,
      findings,
      evidence: evidenceList,
      coverage: 'unsupported',
      reasons: [reason],
      simulatedPermitTarget: undefined,
    };
  }
}
