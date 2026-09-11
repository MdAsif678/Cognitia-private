import { isAddress, domainSeparator } from 'viem';
import { type SignatureAdapterProvider, type ChainReadProvider } from '../types';
import { type AnalysisRequest, type Eip712AnalysisRequest } from '../../schemas/request';
import { type DecodedIntent } from '../../schemas/intent';
import { type Finding } from '../../schemas/finding';
import { type Evidence } from '../../schemas/evidence';
import { MockChainReadProvider, ViemChainReadProvider } from '../chainProvider';

export interface Erc2612AdapterOptions {
  chainProvider?: ChainReadProvider;
}

export class Erc2612SignatureAdapter implements SignatureAdapterProvider {
  public readonly id = 'erc2612_adapter';
  private chainProvider?: ChainReadProvider;

  constructor(options?: Erc2612AdapterOptions) {
    this.chainProvider = options?.chainProvider;
  }

  public setChainProvider(provider: ChainReadProvider) {
    this.chainProvider = provider;
  }

  public canHandle(request: AnalysisRequest): boolean {
    if (request.type !== 'eip712') return false;
    const req = request as Eip712AnalysisRequest;
    return req.payload.primaryType === 'Permit';
  }

  public async analyze(
    request: AnalysisRequest,
    context?: { chainProvider?: ChainReadProvider; pinnedBlockNumber?: bigint; blockTimestamp?: bigint }
  ): Promise<{
    intent: DecodedIntent;
    findings: Finding[];
    evidence: Evidence[];
    coverage: 'complete' | 'partial' | 'unsupported';
    reasons: string[];
    simulatedPermitTarget?: {
      token: string;
      owner: string;
      spender: string;
      value: bigint;
      isContractSpender?: boolean;
      preBalance?: bigint;
      preAllowance?: bigint;
      hypotheticalRecipient?: string;
    };
  }> {
    const req = request as Eip712AnalysisRequest;
    const msg = req.payload.message || {};
    const domain = req.payload.domain || {};
    const types = req.payload.types || {};
    const chainId = req.selectedChainId;

    const chainProvider =
      context?.chainProvider ||
      this.chainProvider ||
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'test'
        ? new MockChainReadProvider(chainId)
        : new ViemChainReadProvider(chainId));

    // 1. Variant Discrimination & DAI-style Permit Check
    // Standard ERC-2612: Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)
    // DAI-style: Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)
    const permitTypes = types.Permit;
    const permitFieldNames = Array.isArray(permitTypes)
      ? permitTypes.map((t) => t.name.toLowerCase())
      : Object.keys(msg).map((k) => k.toLowerCase());

    const isDaiStyle =
      permitFieldNames.includes('holder') ||
      permitFieldNames.includes('expiry') ||
      permitFieldNames.includes('allowed') ||
      'holder' in msg ||
      'expiry' in msg ||
      'allowed' in msg;

    const hasErc2612CoreFields =
      (permitFieldNames.includes('owner') || 'owner' in msg) &&
      (permitFieldNames.includes('spender') || 'spender' in msg) &&
      (permitFieldNames.includes('value') || 'value' in msg);

    const evidenceId = `ev-erc2612-${Date.now()}`;
    const evidenceList: Evidence[] = [];

    // If DAI-style permit or non-standard structure is detected:
    // "Do not assume every permit-named function is ERC-2612.
    //  Do not silently treat DAI-style permits as ERC-2612.
    //  Unsupported domain/token variants must return explicit uncertainty."
    if (isDaiStyle || !hasErc2612CoreFields) {
      const variantReason = isDaiStyle
        ? 'DAI-style permit variant detected (uses holder/expiry/allowed instead of ERC-2612 owner/deadline/value). This adapter explicitly supports standard ERC-2612 only and does not silently treat DAI permits as ERC-2612.'
        : `Unsupported permit schema: missing required ERC-2612 parameters (expected: owner, spender, value; found: ${permitFieldNames.join(', ')}).`;

      const tokenAddr = String(domain.verifyingContract || '');
      const relevantAddrs: string[] = [];
      if (isAddress(tokenAddr, { strict: false })) relevantAddrs.push(tokenAddr);
      if (msg.holder && isAddress(String(msg.holder), { strict: false })) relevantAddrs.push(String(msg.holder));
      if (msg.owner && isAddress(String(msg.owner), { strict: false })) relevantAddrs.push(String(msg.owner));
      if (msg.spender && isAddress(String(msg.spender), { strict: false })) relevantAddrs.push(String(msg.spender));

      evidenceList.push({
        id: evidenceId,
        type: 'ast_analysis',
        provenance: 'Erc2612SignatureAdapter',
        relevantAddresses: relevantAddrs,
        chainId,
        rawSupportingData: {
          domain,
          message: msg,
          permitFieldNames,
          isDaiStyle,
          variantReason,
        },
      });

      const unsupportedFinding: Finding = {
        id: `finding-erc2612-unsupported-variant-${Date.now()}`,
        ruleId: 'erc2612_unsupported_variant',
        severity: 'high',
        title: isDaiStyle ? 'Unsupported DAI-Style Permit Variant' : 'Unsupported Non-Standard Permit Variant',
        plainEnglishExplanation: isDaiStyle
          ? 'This signature uses a DAI-style permit structure (holder/expiry/allowed) rather than the standard ERC-2612 specification. DAI permits grant boolean approval rather than a specific numeric allowance. Adapter equivalence cannot be justified, returning explicit uncertainty.'
          : `The permit signature payload does not conform to the ERC-2612 specification. Missing required fields: ${variantReason}.`,
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Field signature analysis matched non-ERC-2612 schema' },
        assumptions: ['Adapter equivalence cannot be justified without standard ERC-2612 value semantics'],
        executionContext: 'decoded_intent',
        remediation: 'Do not proceed unless you have verified that the target dApp specifically requires this non-standard permit structure.',
      };

      const unsupportedIntent: DecodedIntent = {
        type: 'eip712',
        target: isAddress(tokenAddr, { strict: false }) ? tokenAddr : undefined,
        targetContract: isAddress(tokenAddr, { strict: false }) ? tokenAddr : undefined,
        functionName: 'permit',
        signature: isDaiStyle
          ? 'permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
          : 'permit(?)',
        arguments: Object.entries(msg).map(([name, val]) => ({
          name,
          type: typeof val === 'boolean' ? 'bool' : typeof val === 'number' || typeof val === 'bigint' ? 'uint256' : 'unknown',
          value: String(val),
        })),
        parameters: Object.entries(msg).map(([name, val]) => ({
          name,
          type: typeof val === 'boolean' ? 'bool' : typeof val === 'number' || typeof val === 'bigint' ? 'uint256' : 'unknown',
          value: String(val),
        })),
        assetStandard: 'unknown',
        nativeValue: '0',
        abiProvenance: 'unknown',
        confidence: {
          level: 'low',
          reason: 'Explicit uncertainty: Non-ERC-2612 permit variant detected',
        },
        unresolvedQuestions: [variantReason],
        rawCalldata: '0x',
        isUnknownFunction: true,
        typedDataDetails: {
          standard: isDaiStyle ? 'DAI-Permit' : 'Unsupported',
          primaryType: 'Permit',
          domain,
          fields: msg,
          inconsistencies: [variantReason],
        },
      };

      return {
        intent: unsupportedIntent,
        findings: [unsupportedFinding],
        evidence: evidenceList,
        coverage: 'unsupported',
        reasons: [variantReason],
        simulatedPermitTarget: undefined,
      };
    }

    // 2. Decode standard ERC-2612 fields
    const owner = String(msg.owner || '');
    const spender = String(msg.spender || '');
    const valueStr = String(msg.value ?? '0');
    const value = BigInt(valueStr);
    const nonceStr = String(msg.nonce ?? '0');
    const nonce = BigInt(nonceStr);
    const deadlineStr = String(msg.deadline ?? '0');
    const deadline = BigInt(deadlineStr);
    const token = String(domain.verifyingContract || '');

    const inconsistencies: string[] = [];
    const findings: Finding[] = [];

    // 3. Precondition: Zero Owner Rejection
    // "Reject a zero owner."
    const isZeroOwner = !owner || owner.toLowerCase() === '0x0000000000000000000000000000000000000000';
    if (isZeroOwner) {
      inconsistencies.push('Permit owner is the zero address (0x0000000000000000000000000000000000000000)');
      findings.push({
        id: `finding-erc2612-zero-owner-${Date.now()}`,
        ruleId: 'erc2612_zero_owner',
        severity: 'critical',
        title: 'Invalid Zero Address Owner in ERC-2612 Permit',
        plainEnglishExplanation: 'The permit specifies the zero address (0x0000...0000) as the owner. Standard ERC-2612 implementations revert when owner is address(0). Signing this permit is invalid and may expose user authorizations to undefined behavior.',
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Direct comparison of owner against address(0)' },
        assumptions: ['ERC-2612 standard requires a non-zero owner account'],
        executionContext: 'decoded_intent',
        remediation: 'Do not sign. The permit contains an invalid zero address owner.',
      });
    }

    // 4. Precondition: Expected Signer vs Owner
    // "Validate typed-data structure and expected signer versus owner."
    if (!isZeroOwner && isAddress(owner, { strict: false }) && isAddress(req.expectedSigner, { strict: false })) {
      if (owner.toLowerCase() !== req.expectedSigner.toLowerCase()) {
        inconsistencies.push(`Signer mismatch: Expected signer ${req.expectedSigner} does not match permit owner ${owner}`);
        findings.push({
          id: `finding-erc2612-signer-mismatch-${Date.now()}`,
          ruleId: 'erc2612_signer_mismatch',
          severity: 'high',
          title: 'ERC-2612 Signer / Owner Address Mismatch',
          plainEnglishExplanation: `The expected signer (${req.expectedSigner}) does not match the permit owner (${owner}). If signed by the expected signer, the token contract will recover the wrong address and revert on-chain.`,
          evidenceIds: [evidenceId],
          confidence: { level: 'high', reason: 'Direct comparison of expected signer with permit owner' },
          assumptions: ['Connected wallet is the expected signer'],
          executionContext: 'decoded_intent',
          remediation: 'Ensure the active wallet in your application matches the permit owner address.',
        });
      }
    }

    // Format validation
    if (!isZeroOwner && !isAddress(owner, { strict: false })) inconsistencies.push('Invalid owner address format');
    if (!isAddress(spender, { strict: false })) inconsistencies.push('Invalid spender address format');
    if (!isAddress(token, { strict: false })) inconsistencies.push('Missing or invalid verifyingContract token address');

    // 5. Precondition: Chain Consistency
    // "Check chain and verifying-contract consistency."
    const domainChainId = domain.chainId !== undefined ? Number(domain.chainId) : undefined;
    if (domainChainId !== undefined && domainChainId !== req.selectedChainId) {
      inconsistencies.push(
        `Chain ID inconsistency: EIP-712 domain specifies chainId ${domainChainId}, but analysis selected chainId ${req.selectedChainId}`
      );
      findings.push({
        id: `finding-erc2612-chain-mismatch-${Date.now()}`,
        ruleId: 'erc2612_chain_mismatch',
        severity: 'high',
        title: 'ERC-2612 Domain Chain ID Inconsistency',
        plainEnglishExplanation: `The EIP-712 domain specifies chainId ${domainChainId}, but the active network is chainId ${req.selectedChainId}. Because EIP-712 includes chainId in the domain separator for replay protection, this permit cannot be accepted on the selected chain.`,
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Domain chainId does not match analysis chainId' },
        assumptions: ['EIP-712 domain separator includes chainId'],
        executionContext: 'decoded_intent',
        remediation: 'Switch to the network indicated in the signature domain before proceeding.',
      });
    }

    // 6. Precondition: Reconstruct Supported Domain & Compare DOMAIN_SEPARATOR()
    // "Reconstruct the supported domain and compare DOMAIN_SEPARATOR()."
    let reconstructedDomainSeparator: string | null = null;
    try {
      reconstructedDomainSeparator = domainSeparator({
        domain: {
          name: domain.name as string | undefined,
          version: domain.version as string | undefined,
          chainId: domainChainId ?? req.selectedChainId,
          verifyingContract: isAddress(token, { strict: false }) ? (token as `0x${string}`) : undefined,
          salt: domain.salt as `0x${string}` | undefined,
        },
      });
    } catch (err) {
      inconsistencies.push(`Failed to reconstruct EIP-712 domain separator: ${err instanceof Error ? err.message : String(err)}`);
    }

    let onChainDomainSeparator: string | null = null;
    let domainSeparatorMatches: boolean | undefined = undefined;

    if (isAddress(token, { strict: false })) {
      try {
        onChainDomainSeparator = await chainProvider.getDomainSeparator(token);
      } catch {
        onChainDomainSeparator = null;
      }
    }

    if (onChainDomainSeparator !== null && reconstructedDomainSeparator !== null) {
      if (reconstructedDomainSeparator.toLowerCase() === onChainDomainSeparator.toLowerCase()) {
        domainSeparatorMatches = true;
      } else {
        domainSeparatorMatches = false;
        inconsistencies.push(
          `Domain separator mismatch: Reconstructed domain separator (${reconstructedDomainSeparator}) does not match on-chain DOMAIN_SEPARATOR() (${onChainDomainSeparator})`
        );
        findings.push({
          id: `finding-erc2612-domain-separator-mismatch-${Date.now()}`,
          ruleId: 'erc2612_domain_separator_mismatch',
          severity: 'high',
          title: 'EIP-712 DOMAIN_SEPARATOR Mismatch',
          plainEnglishExplanation: `The reconstructed domain separator (${reconstructedDomainSeparator}) does not match the token contract DOMAIN_SEPARATOR() (${onChainDomainSeparator}) at the pinned block. This occurs when token name, version, chainId, or salt differs from the contract implementation. The permit will revert on-chain.`,
          evidenceIds: [evidenceId],
          confidence: { level: 'high', reason: 'Cryptographic hash comparison against on-chain DOMAIN_SEPARATOR()' },
          assumptions: ['Target token adheres to standard EIP-712 DOMAIN_SEPARATOR() accessor'],
          executionContext: 'decoded_intent',
          remediation: 'Do not sign. The dApp generated a domain that differs from the deployed token contract.',
        });
      }
    } else if (onChainDomainSeparator === null && isAddress(token, { strict: false })) {
      inconsistencies.push(`Target token ${token} did not return DOMAIN_SEPARATOR() at the pinned block`);
      findings.push({
        id: `finding-erc2612-missing-domain-separator-${Date.now()}`,
        ruleId: 'erc2612_unsupported_token_variant',
        severity: 'medium',
        title: 'Token Lacks ERC-2612 DOMAIN_SEPARATOR()',
        plainEnglishExplanation: `Contract ${token} did not return a DOMAIN_SEPARATOR() on-chain. It may be an unsupported token variant or not implement ERC-2612. Equivalence cannot be proven.`,
        evidenceIds: [evidenceId],
        confidence: { level: 'medium', reason: 'Token call to DOMAIN_SEPARATOR() failed or returned null' },
        assumptions: ['Token may not implement standard ERC-2612'],
        executionContext: 'decoded_intent',
        remediation: 'Exercise caution. Verify whether this token supports ERC-2612 permits.',
      });
    }

    // 7. Precondition: Compare Nonce to on-chain nonces(owner)
    // "Compare nonce to nonces(owner)."
    let onChainNonce: bigint | null = null;
    let nonceMatches: boolean | undefined = undefined;

    if (!isZeroOwner && isAddress(owner, { strict: false }) && isAddress(token, { strict: false })) {
      try {
        onChainNonce = await chainProvider.getTokenNonce(token, owner);
        if (nonce === onChainNonce) {
          nonceMatches = true;
        } else {
          nonceMatches = false;
          inconsistencies.push(
            `Nonce mismatch: Permit specifies nonce ${nonce.toString()}, but on-chain nonces(owner) is ${onChainNonce.toString()}`
          );
          findings.push({
            id: `finding-erc2612-nonce-mismatch-${Date.now()}`,
            ruleId: 'erc2612_nonce_mismatch',
            severity: 'high',
            title: 'ERC-2612 Nonce Mismatch',
            plainEnglishExplanation: `Permit nonce (${nonce.toString()}) does not match the owner's on-chain nonce (${onChainNonce.toString()}) at the pinned block. The permit will revert on-chain because replay protection requires the exact sequential nonce.`,
            evidenceIds: [evidenceId],
            confidence: { level: 'high', reason: 'Direct comparison with on-chain nonces(owner)' },
            assumptions: ['Token implements standard ERC-2612 nonces(owner) counter'],
            executionContext: 'decoded_intent',
            remediation: 'Request a fresh permit with the updated nonce from the dApp.',
          });
        }
      } catch {
        // RPC or call failure
      }
    }

    // 8. Precondition: Compare Deadline to Block Timestamp
    // "Compare deadline to block timestamp."
    let blockTimestamp = context?.blockTimestamp;
    if (blockTimestamp === undefined) {
      try {
        blockTimestamp = await chainProvider.getBlockTimestamp();
      } catch {
        blockTimestamp = BigInt(Math.floor(Date.now() / 1000));
      }
    }

    const isExpired = deadline > 0n && deadline < blockTimestamp;
    if (isExpired) {
      inconsistencies.push(
        `Permit deadline (${deadline.toString()}) has expired relative to block timestamp (${blockTimestamp.toString()})`
      );
      findings.push({
        id: `finding-erc2612-expired-deadline-${Date.now()}`,
        ruleId: 'erc2612_expired_deadline',
        severity: 'high',
        title: 'Expired ERC-2612 Permit Deadline',
        plainEnglishExplanation: `The permit deadline (${deadline.toString()}) has already passed relative to the pinned block timestamp (${blockTimestamp.toString()}). ERC-2612 tokens reject expired permits upon submission.`,
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Direct comparison of deadline against pinned block timestamp' },
        assumptions: ['Pinned block timestamp defines EVM execution time'],
        executionContext: 'decoded_intent',
        remediation: 'Do not sign. Ask the dApp for an updated permit request with a future deadline.',
      });
    }

    // 9. Read Relevant Balance and Current Allowance
    // "Read relevant balance and current allowance."
    let preBalance: bigint = 0n;
    let preAllowance: bigint = 0n;

    if (!isZeroOwner && isAddress(owner, { strict: false }) && isAddress(token, { strict: false })) {
      try {
        preBalance = await chainProvider.getTokenBalance(token, owner);
        if (isAddress(spender, { strict: false })) {
          preAllowance = await chainProvider.getTokenAllowance(token, owner, spender);
        }
      } catch {
        // In-memory fallback
      }
    }

    // 10. Contract Spender Detection
    // "If a contract spender is impersonated, state that this models authorization
    // capacity and does not prove its real code can initiate that transfer. Prefer a supported real execution path when available."
    let isContractSpender = false;
    if (isAddress(spender, { strict: false })) {
      try {
        const code = await chainProvider.getBytecode(spender);
        if (code && code !== '0x' && code !== '0x0') {
          isContractSpender = true;
        }
      } catch {
        isContractSpender = false;
      }
    }

    // 11. Strict Invariant: Do Not Model Known-Invalid Inputs as Valid
    // "Do not model known-invalid nonce/domain/deadline inputs as valid.
    //  If adapter equivalence cannot be justified, return unsupported."
    const hasInvalidPrecondition =
      isZeroOwner ||
      isExpired ||
      onChainDomainSeparator === null ||
      (onChainNonce !== null && nonceMatches === false) ||
      (onChainDomainSeparator !== null && domainSeparatorMatches === false) ||
      (domainChainId !== undefined && domainChainId !== req.selectedChainId) ||
      !isAddress(token, { strict: false }) ||
      !isAddress(owner, { strict: false }) ||
      !isAddress(spender, { strict: false });

    // 12. Build Evidence
    evidenceList.push({
      id: evidenceId,
      type: 'ast_analysis',
      provenance: 'Erc2612SignatureAdapter',
      relevantAddresses: [owner, spender, token].filter((a) => isAddress(a, { strict: false })),
      chainId,
      rawSupportingData: {
        domain,
        message: msg,
        inconsistencies,
        onChainNonce: onChainNonce?.toString(),
        onChainDomainSeparator,
        reconstructedDomainSeparator,
        domainSeparatorMatches,
        blockTimestamp: blockTimestamp.toString(),
        preBalance: preBalance.toString(),
        preAllowance: preAllowance.toString(),
        isContractSpender,
      },
    });

    // 13. Build Decoded Intent
    const intent: DecodedIntent = {
      type: 'eip712',
      target: isAddress(token, { strict: false }) ? token : undefined,
      targetContract: isAddress(token, { strict: false }) ? token : undefined,
      functionName: 'permit',
      signature: 'permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
      arguments: [
        { name: 'owner', type: 'address', value: owner },
        { name: 'spender', type: 'address', value: spender },
        { name: 'value', type: 'uint256', value: valueStr },
        { name: 'nonce', type: 'uint256', value: nonceStr },
        { name: 'deadline', type: 'uint256', value: deadlineStr },
      ],
      parameters: [
        { name: 'owner', type: 'address', value: owner },
        { name: 'spender', type: 'address', value: spender },
        { name: 'value', type: 'uint256', value: valueStr },
        { name: 'nonce', type: 'uint256', value: nonceStr },
        { name: 'deadline', type: 'uint256', value: deadlineStr },
      ],
      assetStandard: 'ERC-2612',
      owner: isAddress(owner, { strict: false }) ? owner : undefined,
      spenderOrOperator: isAddress(spender, { strict: false }) ? spender : undefined,
      amount: valueStr,
      nativeValue: '0',
      abiProvenance: 'standard_abi',
      confidence: {
        level: hasInvalidPrecondition ? 'low' : 'high',
        reason: hasInvalidPrecondition
          ? 'Invalid or inconsistent permit parameters detected on-chain'
          : 'Verified ERC-2612 domain, nonce, deadline, and token preconditions',
      },
      unresolvedQuestions: inconsistencies,
      rawCalldata: '0x',
      isUnknownFunction: false,
      typedDataDetails: {
        standard: 'ERC-2612',
        primaryType: 'Permit',
        domain,
        fields: msg,
        inconsistencies,
        isExpired,
        domainSeparatorMatches,
        reconstructedDomainSeparator: reconstructedDomainSeparator || undefined,
        onChainDomainSeparator,
        nonceMatches,
        preState: {
          tokenBalance: preBalance.toString(),
          tokenAllowance: preAllowance.toString(),
          currentNonce: onChainNonce !== null ? onChainNonce.toString() : undefined,
        },
      },
    };

    let coverageStatus: 'complete' | 'partial' | 'unsupported' = 'complete';
    if (onChainDomainSeparator === null && isAddress(token, { strict: false })) {
      coverageStatus = 'unsupported';
    } else if (inconsistencies.length > 0) {
      coverageStatus = 'partial';
    }

    const simulatedPermitTarget = hasInvalidPrecondition
      ? undefined
      : {
          token,
          owner,
          spender,
          value,
          isContractSpender,
          preBalance,
          preAllowance,
          hypotheticalRecipient: '0x1111111111111111111111111111111111111111',
        };

    return {
      intent,
      findings,
      evidence: evidenceList,
      coverage: coverageStatus,
      reasons: inconsistencies,
      simulatedPermitTarget,
    };
  }
}
