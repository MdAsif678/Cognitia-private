import { isAddress } from 'viem';
import { type SignatureAdapterProvider } from '../types';
import { type AnalysisRequest, type Eip712AnalysisRequest } from '../../schemas/request';
import { type DecodedIntent } from '../../schemas/intent';
import { type Finding } from '../../schemas/finding';
import { type Evidence } from '../../schemas/evidence';

export class GenericEip712Adapter implements SignatureAdapterProvider {
  public readonly id = 'generic_eip712_adapter';

  public canHandle(request: AnalysisRequest): boolean {
    return request.type === 'eip712';
  }

  public async analyze(request: AnalysisRequest): Promise<{
    intent: DecodedIntent;
    findings: Finding[];
    evidence: Evidence[];
    coverage: 'unsupported' | 'partial';
    reasons: string[];
    simulatedPermitTarget: undefined;
  }> {
    const req = request as Eip712AnalysisRequest;
    const payload = req.payload || {};
    const primaryType = payload.primaryType || 'Unknown';
    const domain = payload.domain || {};
    const message = payload.message || {};

    // 1. Recursive Address Extraction
    const foundAddresses = new Set<string>();
    if (domain.verifyingContract && isAddress(String(domain.verifyingContract), { strict: false })) {
      foundAddresses.add(String(domain.verifyingContract));
    }
    if (req.expectedSigner && isAddress(req.expectedSigner, { strict: false })) {
      foundAddresses.add(req.expectedSigner);
    }
    this.extractAddressesRecursive(message, foundAddresses, 0);

    // 2. Candidate Amounts & Timestamps Extraction
    const candidateAmounts: Array<{ key: string; value: string; candidate: boolean }> = [];
    const candidateTimestamps: Array<{ key: string; value: string; candidate: boolean }> = [];
    this.extractNumericPatternsRecursive(message, candidateAmounts, candidateTimestamps, '', 0);

    // 3. Candidate Role Patterns
    const candidatePatterns: Array<{ field: string; value: string; role: string; disclaimer: string }> = [];
    this.extractRolePatternsRecursive(message, candidatePatterns, '', 0);

    // 4. Flatten fields for parameter representation
    const parameters: Array<{ name: string; type: string; value: string }> = [];
    parameters.push({ name: 'primaryType', type: 'string', value: String(primaryType) });
    if (domain.chainId !== undefined) {
      parameters.push({ name: 'domain.chainId', type: 'uint256', value: String(domain.chainId) });
    }
    if (domain.verifyingContract) {
      parameters.push({ name: 'domain.verifyingContract', type: 'address', value: String(domain.verifyingContract) });
    }
    if (domain.name) {
      parameters.push({ name: 'domain.name', type: 'string', value: String(domain.name) });
    }

    // Top-level message fields
    for (const [k, v] of Object.entries(message)) {
      parameters.push({
        name: k,
        type: typeof v,
        value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
      });
    }

    const tokenAddress = domain.verifyingContract && isAddress(String(domain.verifyingContract), { strict: false })
      ? String(domain.verifyingContract)
      : undefined;

    const evidenceId = `ev-generic-eip712-${Date.now()}`;
    const evidenceList: Evidence[] = [
      {
        id: evidenceId,
        type: 'ast_analysis',
        provenance: 'GenericEip712Adapter',
        relevantAddresses: Array.from(foundAddresses),
        chainId: req.selectedChainId,
        rawSupportingData: {
          fullPayload: payload,
          extractedAddresses: Array.from(foundAddresses),
          candidateAmounts,
          candidateTimestamps,
          candidatePatterns,
          domain,
          message,
        },
      },
    ];

    const unresolvedReason =
      `Unsupported typed data schema '${primaryType}': Signing authority and downstream smart contract effects remain unresolved. Field pattern matches are candidates only.`;

    const findings: Finding[] = [
      {
        id: `finding-generic-eip712-${Date.now()}`,
        ruleId: 'unsupported_eip712_unresolved_effects',
        severity: 'unknown',
        title: `Unsupported EIP-712 Typed Data (${primaryType})`,
        plainEnglishExplanation:
          `This EIP-712 payload uses a typed data structure without a verified contract adapter. Extracted fields, addresses, and amounts are candidates only and do not establish verified authorization semantics. Signing authority and downstream execution effects remain unresolved.`,
        evidenceIds: [evidenceId],
        confidence: {
          level: 'low',
          reason: 'Generic structural parsing without verified contract ABI or specialized adapter',
        },
        assumptions: [
          'Downstream smart contracts or relayers may interpret fields arbitrarily',
          'Candidate field names do not guarantee standard ERC semantics',
        ],
        executionContext: 'decoded_intent',
        remediation:
          'Do not sign this payload unless you have independently verified the target contract code and know exactly how this signature will be submitted and validated.',
      },
    ];

    // Intent representation preserving full original payload
    const intent: DecodedIntent = {
      type: 'eip712',
      target: tokenAddress,
      targetContract: tokenAddress,
      functionName: String(primaryType),
      candidateFunction: String(primaryType),
      isCandidate: true,
      candidateDisclaimer:
        "A pattern match does not prove a function's or field's meaning. Signing authority and execution effects remain unresolved.",
      signature: `${primaryType}(...)`,
      arguments: parameters,
      parameters,
      assetStandard: 'unknown',
      nativeValue: '0',
      abiProvenance: 'unknown',
      confidence: {
        level: 'low',
        reason: 'Unsupported typed data schema; execution effects and signing authority unresolved',
      },
      unresolvedQuestions: [
        unresolvedReason,
        'Recognizable field names are heuristic candidates only and do not prove authorization capacity.',
      ],
      rawCalldata: '0x',
      isUnknownFunction: true,
      typedDataDetails: {
        standard: 'Generic-EIP712',
        primaryType: String(primaryType),
        domain,
        fields: message,
        rawPayload: payload as unknown as Record<string, unknown>,
        extractedAddresses: Array.from(foundAddresses),
        extractedAmounts: candidateAmounts,
        extractedTimestamps: candidateTimestamps,
        candidatePatterns,
        authorityStatus: 'unresolved',
        inconsistencies: [unresolvedReason],
      },
    };

    return {
      intent,
      findings,
      evidence: evidenceList,
      coverage: 'unsupported',
      reasons: [unresolvedReason],
      simulatedPermitTarget: undefined,
    };
  }

  private extractAddressesRecursive(obj: unknown, found: Set<string>, depth: number) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;
    try {
      for (const val of Object.values(obj as Record<string, unknown>)) {
        if (typeof val === 'string') {
          const trimmed = val.trim();
          if (isAddress(trimmed, { strict: false })) {
            found.add(trimmed);
          }
        } else if (typeof val === 'object' && val !== null) {
          this.extractAddressesRecursive(val, found, depth + 1);
        }
      }
    } catch {
      // Ignore circular or inaccessible properties
    }
  }

  private extractNumericPatternsRecursive(
    obj: unknown,
    amounts: Array<{ key: string; value: string; candidate: boolean }>,
    timestamps: Array<{ key: string; value: string; candidate: boolean }>,
    prefix: string,
    depth: number
  ) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;
    try {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const keyLower = key.toLowerCase();

        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'bigint') {
          const strVal = String(val).trim();
          const isNumeric = /^\d+$/.test(strVal) || /^0x[0-9a-fA-F]+$/.test(strVal);

          // If key explicitly mentions amount/value/balance/etc, prioritize amount
          if (/amount|value|balance|price|fee|total|cost|quantity|allowance/i.test(keyLower)) {
            amounts.push({ key: fullKey, value: strVal, candidate: true });
          }
          // If key explicitly mentions deadline/expiry/timestamp/time
          else if (/deadline|expiry|timestamp|validuntil|validbefore|validafter|expiration|time/i.test(keyLower)) {
            timestamps.push({ key: fullKey, value: strVal, candidate: true });
          }
          // Fallback heuristic: 10-digit unix epoch timestamp
          else if (/^\d{10}$/.test(strVal) && Number(strVal) >= 1000000000 && Number(strVal) <= 3000000000) {
            timestamps.push({ key: fullKey, value: strVal, candidate: true });
          }
          // Fallback heuristic: other large numeric values as candidate amounts
          else if (isNumeric && strVal.length > 5) {
            amounts.push({ key: fullKey, value: strVal, candidate: true });
          }
        } else if (typeof val === 'object' && val !== null) {
          this.extractNumericPatternsRecursive(val, amounts, timestamps, fullKey, depth + 1);
        }
      }
    } catch {
      // Ignore circular reference
    }
  }

  private extractRolePatternsRecursive(
    obj: unknown,
    patterns: Array<{ field: string; value: string; role: string; disclaimer: string }>,
    prefix: string,
    depth: number
  ) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;
    try {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const keyLower = key.toLowerCase();

        let role: string | undefined;
        if (/spender|operator|approved|delegate/i.test(keyLower)) {
          role = 'candidate_spender';
        } else if (/owner|holder|granter|authorizer|maker|from/i.test(keyLower)) {
          role = 'candidate_owner';
        } else if (/recipient|receiver|beneficiary|destination|taker|to/i.test(keyLower)) {
          role = 'candidate_recipient';
        } else if (/token|asset|currency/i.test(keyLower)) {
          role = 'candidate_token';
        } else if (/nonce|salt/i.test(keyLower)) {
          role = 'candidate_nonce';
        }

        if (role) {
          const strVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
          patterns.push({
            field: fullKey,
            value: strVal,
            role,
            disclaimer: `Candidate only: Field '${fullKey}' matches heuristic pattern '${role}'. This does NOT prove semantic authorization or execution effects without a verified contract adapter.`,
          });
        }

        if (typeof val === 'object' && val !== null) {
          this.extractRolePatternsRecursive(val, patterns, fullKey, depth + 1);
        }
      }
    } catch {
      // Ignore circular reference
    }
  }
}
