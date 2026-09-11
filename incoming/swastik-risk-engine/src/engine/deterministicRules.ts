import { type DecodedIntent } from '../schemas/intent';
import { type Finding, type Severity } from '../schemas/finding';
import { type Evidence } from '../schemas/evidence';
import { type SimulationResult } from '../schemas/simulation';
import { type ThreatRecord, type ThreatMatchEvidence, type EntityRole } from '../providers/types';
import { type TrustRegistryProvider, defaultTrustRegistry } from '../providers/trustRegistry';
import { type CoverageStatus } from '../schemas/coverage';

export const FINDINGS_ENGINE_VERSION = '1.0.0';

export const MAX_UINT256 = (1n << 256n) - 1n; // type(uint256).max
export const EXCESSIVE_FINITE_THRESHOLD = 1n << 128n; // 2^128

export interface RuleEvaluationContext {
  intent: DecodedIntent;
  threatMatches: (ThreatRecord | ThreatMatchEvidence)[];
  simulationResult?: SimulationResult;
  evidenceMap: Record<string, Evidence>;
  originDomain?: string;
  chainId: number;
  trustRegistry?: TrustRegistryProvider;
  calldataCoverage?: CoverageStatus;
  simulationCoverage?: CoverageStatus;
  caller?: string;
  delegatecallTargets?: Array<{ address: string; isVerified: boolean; observedLoss?: boolean }>;
}

export function evaluateDeterministicRules(ctx: RuleEvaluationContext): Finding[] {
  const findings: Finding[] = [];
  const {
    intent,
    threatMatches,
    simulationResult,
    evidenceMap,
    chainId,
    trustRegistry = defaultTrustRegistry,
    calldataCoverage = 'complete',
    simulationCoverage = 'complete',
  } = ctx;

  // Flatten all calls (root + nested calls)
  const allCalls: DecodedIntent[] = [];
  function collectCalls(call: DecodedIntent) {
    allCalls.push(call);
    if (call.nestedCalls) {
      for (const nested of call.nestedCalls) {
        collectCalls(nested);
      }
    }
  }
  collectCalls(intent);

  const getThreatRole = (t: ThreatRecord | ThreatMatchEvidence, fallback: EntityRole): EntityRole => {
    if ('entityRole' in t && t.entityRole) return t.entityRole;
    return fallback;
  };

  const isDemoThreat = (t: ThreatRecord | ThreatMatchEvidence): boolean => {
    if ('isDemo' in t && t.isDemo) return true;
    return Boolean(t.demoOnly);
  };

  // Helper to record threat evidence in evidenceMap
  const recordThreatEvidence = (
    evId: string,
    threat: ThreatRecord | ThreatMatchEvidence,
    relevantAddresses: string[],
    role: EntityRole
  ) => {
    const freshness = 'freshness' in threat ? threat.freshness : undefined;
    evidenceMap[evId] = {
      id: evId,
      type:
        threat.matchType === 'address'
          ? 'address_match'
          : threat.matchType === 'codehash'
          ? 'codehash_match'
          : threat.matchType === 'domain'
          ? 'domain_match'
          : 'behavioral',
      provenance: threat.sourceUrl,
      relevantAddresses,
      chainId,
      rawSupportingData: {
        threatId: threat.id,
        label: threat.label,
        matchedValue: threat.matchValue,
        matchType: threat.matchType,
        confidence: threat.confidence,
        freshness,
        entityRole: role,
        demoOnly: isDemoThreat(threat),
        sourceUrl: threat.sourceUrl,
        engineVersion: FINDINGS_ENGINE_VERSION,
        matchDisclaimers:
          'An indicator match identifies a cataloged entity/pattern in security intelligence feeds, but does not in itself constitute mathematical proof of asset loss without observing permissions or execution effects.',
      },
    };
  };

  // 1. Phishing Domain Match
  const domainThreat = threatMatches.find((t) => t.matchType === 'domain');
  if (domainThreat) {
    const evId = `ev-domain-${domainThreat.id}`;
    const isDemo = isDemoThreat(domainThreat);
    const demoPrefix = isDemo ? '[DEMO ONLY] ' : '';
    recordThreatEvidence(evId, domainThreat, [], 'target');

    findings.push({
      id: `finding-phishing-domain-${Date.now()}`,
      ruleId: 'documented_phishing_domain',
      severity: 'critical',
      title: `${demoPrefix}Transaction Originates from Documented Phishing Domain`,
      plainEnglishExplanation: `This request originated from or interacts with a documented phishing domain (${domainThreat.matchValue}), cataloged in security threat feeds (${domainThreat.sourceUrl}). Interacting with this site will likely drain your wallet. (Note: A domain threat match alone identifies a cataloged phishing source, but does not in itself prove asset loss).`,
      evidenceIds: [evId],
      confidence: { level: 'high', reason: 'Direct host/domain match against documented phishing catalog' },
      assumptions: ['Host domain was accurately reported by client context'],
      executionContext: 'decoded_intent',
      remediation: 'Immediately close the webpage and do not sign or approve any transactions.',
    });
  }

  // 2. Exact Bytecode / Implementation Codehash Match
  const codehashThreats = threatMatches.filter((t) => t.matchType === 'codehash');
  for (const codeThreat of codehashThreats) {
    const evId = `ev-codehash-${codeThreat.id}`;
    const isDemo = isDemoThreat(codeThreat);
    const demoPrefix = isDemo ? '[DEMO ONLY] ' : '';
    const role = getThreatRole(codeThreat, 'implementation');
    const targetAddr = intent.targetContract || '0x0000000000000000000000000000000000000000';
    recordThreatEvidence(evId, codeThreat, [targetAddr], role);

    findings.push({
      id: `finding-malicious-bytecode-${Date.now()}-${codeThreat.id}`,
      ruleId: 'documented_malicious_bytecode',
      severity: 'critical',
      title: `${demoPrefix}Documented Malicious Contract Runtime Bytecode Detected`,
      plainEnglishExplanation: `The contract's runtime bytecode hash matches a documented malicious implementation or drainer forwarder (${codeThreat.label}). (Note: A runtime bytecode match identifies an identical compiled binary pattern, but does not in itself prove asset loss).`,
      evidenceIds: [evId],
      confidence: { level: 'high', reason: 'Exact runtime bytecode keccak256 hash match against documented threat database' },
      assumptions: ['Runtime bytecode was fetched at the pinned block from isolated fork snapshot'],
      executionContext: 'decoded_intent',
      remediation: 'Do NOT interact with this contract. The underlying bytecode matches an identified drainer.',
    });
  }

  // 3. Documented Malicious Spender / Operator / Target Address Matches
  const addressThreats = threatMatches.filter((t) => t.matchType === 'address');

  // 3a. Target Contract Address Match
  if (intent.targetContract) {
    const targetNorm = intent.targetContract.toLowerCase();
    const matchedTargetThreat = addressThreats.find((t) => t.matchValue.toLowerCase() === targetNorm);
    if (matchedTargetThreat) {
      const evId = `ev-malicious-target-${matchedTargetThreat.id}`;
      const isDemo = isDemoThreat(matchedTargetThreat);
      const demoPrefix = isDemo ? '[DEMO ONLY] ' : '';
      const role = getThreatRole(matchedTargetThreat, 'target');
      recordThreatEvidence(evId, matchedTargetThreat, [intent.targetContract], role);

      findings.push({
        id: `finding-malicious-target-${Date.now()}-${matchedTargetThreat.id}`,
        ruleId: 'documented_malicious_target',
        severity: 'critical',
        title: `${demoPrefix}Transaction Directly Targets Documented Malicious Contract`,
        plainEnglishExplanation: `The target contract (${intent.targetContract}) is a verified threat actor (${matchedTargetThreat.label}). Calling this contract risks immediate compromise. (Note: An address match identifies a cataloged actor, but does not in itself prove asset loss).`,
        evidenceIds: [evId],
        confidence: { level: 'high', reason: 'Exact address match against documented threat actor database' },
        assumptions: ['Target contract address was correctly specified in transaction request'],
        executionContext: 'decoded_intent',
        remediation: 'Do NOT submit this transaction. The destination is a flagged threat actor.',
      });
    }
  }

  // 3b. Malicious Spender receiving spending authority
  for (const call of allCalls) {
    if (call.functionName === 'approve' || call.functionName === 'permit' || call.functionName?.includes('permit2')) {
      const spenderParam = call.parameters?.find((p) => p.name === 'spender' || p.name === 'operator');
      const amountParam = call.parameters?.find((p) => p.name === 'amount' || p.name === 'value');

      if (spenderParam) {
        const spender = spenderParam.value.toLowerCase();
        const matchedThreat = addressThreats.find((t) => t.matchValue.toLowerCase() === spender);

        if (matchedThreat) {
          let isZeroAmount = false;
          if (amountParam?.value) {
            try {
              isZeroAmount = BigInt(amountParam.value) === 0n;
            } catch {
              // fallback
            }
          }

          if (isZeroAmount) {
            // Revocation: approve(threat, 0)
            // Stripping authority from a malicious spender is a protective revocation, NOT a critical grant!
            const evId = `ev-malicious-spender-revocation-${matchedThreat.id}`;
            const role = getThreatRole(matchedThreat, 'spender');
            recordThreatEvidence(evId, matchedThreat, [spenderParam.value], role);

            findings.push({
              id: `finding-malicious-spender-revocation-${Date.now()}-${matchedThreat.id}`,
              ruleId: 'erc20_allowance_revocation_malicious_spender',
              severity: 'low',
              title: 'ERC-20 Allowance Revocation for Documented Threat Actor',
              plainEnglishExplanation: `This transaction sets the token allowance to 0 for address ${spenderParam.value}. This is a protective revocation that clears existing spending authority from a documented threat actor (${matchedThreat.label}).`,
              evidenceIds: [evId],
              confidence: { level: 'high', reason: 'Explicit approve(0) detected targeting documented threat actor' },
              assumptions: ['Target token honors standard allowance depletion to zero'],
              executionContext: call.type === 'eip712' ? 'conditional_modeling' : 'decoded_intent',
            });
          } else {
            // Nonzero spending authority granted -> Critical!
            const evId = `ev-malicious-spender-${matchedThreat.id}`;
            const isDemo = isDemoThreat(matchedThreat);
            const demoPrefix = isDemo ? '[DEMO ONLY] ' : '';
            const role = getThreatRole(matchedThreat, 'spender');
            recordThreatEvidence(evId, matchedThreat, [spenderParam.value], role);

            const isConditionalPermit = call.type === 'eip712';
            const contextText = isConditionalPermit
              ? `This unsigned permit grants spending authority (${amountParam?.value || 'nonzero'} units) to address ${spenderParam.value}, which is a verified threat actor (${matchedThreat.label}). If signed and accepted on-chain, this entity would be authorized to siphon your tokens. (Note: Authority would be granted only if signed and accepted).`
              : `This transaction grants token spending authority (${amountParam?.value || 'nonzero'} units) to address ${spenderParam.value}, which is a verified threat actor (${matchedThreat.label}). This entity will immediately steal authorized tokens. (Note: An address match identifies a cataloged actor, but does not in itself prove asset loss).`;

            findings.push({
              id: `finding-malicious-spender-${Date.now()}-${matchedThreat.id}`,
              ruleId: 'documented_malicious_spender',
              severity: 'critical',
              title: `${demoPrefix}${isConditionalPermit ? 'Conditional Authority to Documented Malicious Spender' : 'Documented Malicious Spender Receives Nonzero Spending Authority'}`,
              plainEnglishExplanation: contextText,
              evidenceIds: [evId],
              confidence: { level: 'high', reason: 'Exact address match against documented threat actor database' },
              assumptions: ['Target token smart contract honors standard allowance / permit semantics'],
              executionContext: isConditionalPermit ? 'conditional_modeling' : 'decoded_intent',
              remediation: 'Do NOT sign or send this transaction. The spender address is an identified drainer.',
            });
          }
        }
      }
    }

    // 3c. Malicious Operator in setApprovalForAll
    if (call.functionName === 'setApprovalForAll') {
      const operatorParam = call.parameters?.find((p) => p.name === 'operator');
      const approvedParam = call.parameters?.find((p) => p.name === 'approved');

      if (operatorParam) {
        const operatorNorm = operatorParam.value.toLowerCase();
        const matchedThreat = addressThreats.find((t) => t.matchValue.toLowerCase() === operatorNorm);

        if (matchedThreat) {
          const isApproved = approvedParam?.value === 'true';

          if (isApproved) {
            // Grant to threat -> Critical
            const evId = `ev-malicious-operator-${matchedThreat.id}`;
            const isDemo = isDemoThreat(matchedThreat);
            const demoPrefix = isDemo ? '[DEMO ONLY] ' : '';
            const role = getThreatRole(matchedThreat, 'operator');
            recordThreatEvidence(evId, matchedThreat, [operatorParam.value], role);

            findings.push({
              id: `finding-malicious-operator-${Date.now()}-${matchedThreat.id}`,
              ruleId: 'documented_malicious_operator',
              severity: 'critical',
              title: `${demoPrefix}Documented Malicious Operator Granted Collection-Wide NFT Authority`,
              plainEnglishExplanation: `This transaction calls setApprovalForAll(true) for operator ${operatorParam.value}, which is an identified threat actor (${matchedThreat.label}). This entity will immediately steal your NFTs. (Note: An address match alone identifies a cataloged actor, but does not in itself prove asset loss).`,
              evidenceIds: [evId],
              confidence: { level: 'high', reason: 'Exact address match against documented threat actor database' },
              assumptions: ['Target contract complies with ERC-721 or ERC-1155 standards'],
              executionContext: 'decoded_intent',
              remediation: 'Do NOT approve this operator. The operator address is an identified phishing drainer.',
            });
          } else {
            // Revocation from threat: setApprovalForAll(threat, false)
            const evId = `ev-malicious-operator-revocation-${matchedThreat.id}`;
            const role = getThreatRole(matchedThreat, 'operator');
            recordThreatEvidence(evId, matchedThreat, [operatorParam.value], role);

            findings.push({
              id: `finding-malicious-operator-revocation-${Date.now()}-${matchedThreat.id}`,
              ruleId: 'nft_approval_revocation',
              severity: 'low',
              title: 'Collection-Wide NFT Approval Revocation for Documented Threat Actor',
              plainEnglishExplanation: `This transaction calls setApprovalForAll(false) for operator ${operatorParam.value}. This revokes collection-wide NFT authority from a documented threat actor (${matchedThreat.label}).`,
              evidenceIds: [evId],
              confidence: { level: 'high', reason: 'Explicit setApprovalForAll(false) detected targeting threat actor' },
              assumptions: ['Target contract complies with standard ERC-721 / ERC-1155 operator mechanics'],
              executionContext: 'decoded_intent',
            });
          }
        }
      }
    }
  }

  // 3d. Observed simulated asset outflow to a documented malicious recipient -> Critical
  if (simulationResult && simulationResult.assetDeltas.length > 0) {
    for (const delta of simulationResult.assetDeltas) {
      const deltaVal = BigInt(delta.amountDelta);
      if (deltaVal > 0n) {
        const matchedRecipientThreat = addressThreats.find(
          (t) => t.matchValue.toLowerCase() === delta.account.toLowerCase()
        );
        if (matchedRecipientThreat) {
          const evId = `ev-malicious-outflow-${matchedRecipientThreat.id}`;
          const isDemo = isDemoThreat(matchedRecipientThreat);
          const demoPrefix = isDemo ? '[DEMO ONLY] ' : '';
          const role = getThreatRole(matchedRecipientThreat, 'recipient');
          recordThreatEvidence(evId, matchedRecipientThreat, [delta.account, delta.token], role);

          const isConditional = Boolean(simulationResult.conditionalLabel);
          const title = isConditional
            ? `${demoPrefix}Modeled Conditional Asset Outflow to Documented Threat Actor`
            : `${demoPrefix}Observed Simulated Asset Outflow to Documented Malicious Recipient`;

          const explanation = isConditional
            ? `Hypothetical modeled outcome if this unsigned permit is signed and accepted: assets (${delta.amountDelta} units of token ${delta.token}) would be transferred to a known threat actor (${matchedRecipientThreat.label}). This is a modeled conditional outcome, NOT an observed transaction effect.`
            : `Isolated simulation revealed that assets (${delta.amountDelta} units of token ${delta.token}) will be transferred to a known threat actor (${matchedRecipientThreat.label}). (Note: While simulation observed balance deltas, a catalog match identifies the recipient).`;

          findings.push({
            id: `finding-malicious-outflow-${Date.now()}`,
            ruleId: 'simulated_outflow_malicious_recipient',
            severity: 'critical',
            title,
            plainEnglishExplanation: explanation,
            evidenceIds: [evId],
            confidence: { level: 'high', reason: 'Simulation balance delta directed to documented malicious address' },
            assumptions: simulationResult.assumptions,
            executionContext: isConditional ? 'conditional_modeling' : 'observed_simulation',
            remediation: 'Cancel this transaction immediately.',
          });
        }
      }
    }
  }

  // 4. Unlimited / Excessive / Revocation ERC-20 Approvals to Unknown Spenders
  for (const call of allCalls) {
    if (call.functionName === 'approve' || call.functionName === 'permit') {
      const amountParam = call.parameters?.find((p) => p.name === 'amount' || p.name === 'value');
      const spenderParam = call.parameters?.find((p) => p.name === 'spender');

      if (amountParam && spenderParam) {
        try {
          const amt = BigInt(amountParam.value);
          const spender = spenderParam.value;
          const isThreat = addressThreats.some((t) => t.matchValue.toLowerCase() === spender.toLowerCase());

          if (!isThreat) {
            const trustRes = trustRegistry.resolveTrust(spender, chainId);

            if (amt === 0n) {
              // approve(0): Allowance revocation
              const evId = `ev-allowance-revocation-${Date.now()}`;
              evidenceMap[evId] = {
                id: evId,
                type: 'behavioral',
                provenance: 'CalldataIntentDecoder',
                relevantAddresses: [spender],
                chainId,
                rawSupportingData: { spender, amount: '0', trustResolution: trustRes },
              };

              findings.push({
                id: `finding-allowance-revocation-${Date.now()}`,
                ruleId: 'erc20_allowance_revocation',
                severity: 'low',
                title: 'ERC-20 Allowance Revoked (Reset to 0)',
                plainEnglishExplanation: `This transaction resets token spending allowance to 0 for spender ${spender}. This successfully revokes existing token spending permissions.`,
                evidenceIds: [evId],
                confidence: { level: 'high', reason: 'Explicit approve(0) detected in calldata' },
                assumptions: ['Target token honors standard allowance reduction to zero'],
                executionContext: call.type === 'eip712' ? 'conditional_modeling' : 'decoded_intent',
              });
            } else if (!trustRes.isTrusted) {
              // Spender is UNKNOWN (not verified in trust registry)
              if (amt === MAX_UINT256) {
                // Exact type(uint256).max -> Unlimited ERC-20 Approval (High)
                const evId = `ev-unlimited-approval-${Date.now()}`;
                evidenceMap[evId] = {
                  id: evId,
                  type: 'behavioral',
                  provenance: 'CalldataIntentDecoder',
                  relevantAddresses: [spender],
                  chainId,
                  rawSupportingData: {
                    spender,
                    amount: amountParam.value,
                    trustResolution: trustRes,
                  },
                };

                findings.push({
                  id: `finding-unlimited-approval-${Date.now()}`,
                  ruleId: 'unlimited_approval_unknown_spender',
                  severity: 'high',
                  title: 'Unlimited ERC-20 Approval to Unknown Spender',
                  plainEnglishExplanation: `You are granting an unlimited allowance (maximum possible 2^256 - 1) to address ${spender}. Available trust and identity evidence cannot verify this spender (absence from a threat database does not establish trust). If this contract is compromised or malicious, it can siphon your entire token balance at any time.`,
                  evidenceIds: [evId],
                  confidence: { level: 'high', reason: 'Approved value equals exact type(uint256).max (2^256 - 1)' },
                  assumptions: ['Target token honors standard allowance depletion rules'],
                  executionContext: call.type === 'eip712' ? 'conditional_modeling' : 'decoded_intent',
                  remediation: 'Reduce the approval amount to only the exact amount required for the immediate trade.',
                });
              } else if (amt >= EXCESSIVE_FINITE_THRESHOLD) {
                // Finite but unusually large approval (>= 2^128) -> Medium
                const evId = `ev-excessive-approval-${Date.now()}`;
                evidenceMap[evId] = {
                  id: evId,
                  type: 'behavioral',
                  provenance: 'CalldataIntentDecoder',
                  relevantAddresses: [spender],
                  chainId,
                  rawSupportingData: {
                    spender,
                    amount: amountParam.value,
                    trustResolution: trustRes,
                  },
                };

                findings.push({
                  id: `finding-excessive-finite-approval-${Date.now()}`,
                  ruleId: 'excessive_finite_erc20_approval_unknown_spender',
                  severity: 'medium',
                  title: 'Excessive Finite ERC-20 Approval to Unknown Spender',
                  plainEnglishExplanation: `You are granting an unusually large finite allowance (${amountParam.value} units, exceeding 2^128) to an unknown spender (${spender}). Available trust and identity evidence does not establish trust for this address.`,
                  evidenceIds: [evId],
                  confidence: { level: 'high', reason: 'Approved value exceeds 2^128 threshold but is finite' },
                  assumptions: ['Target token honors standard allowance depletion rules'],
                  executionContext: call.type === 'eip712' ? 'conditional_modeling' : 'decoded_intent',
                  remediation: 'Consider approving only the exact amount needed for this operation.',
                });
              }
            }
          }
        } catch {
          // Parse fail
        }
      }
    }
  }

  // 5. Collection-wide NFT approval to an unknown operator -> High
  for (const call of allCalls) {
    if (call.functionName === 'setApprovalForAll') {
      const approvedParam = call.parameters?.find((p) => p.name === 'approved');
      const operatorParam = call.parameters?.find((p) => p.name === 'operator');

      if (approvedParam && operatorParam) {
        const operator = operatorParam.value;
        const isThreat = addressThreats.some((t) => t.matchValue.toLowerCase() === operator.toLowerCase());

        if (!isThreat) {
          const isApproved = approvedParam.value === 'true';
          const trustRes = trustRegistry.resolveTrust(operator, chainId);

          if (isApproved) {
            if (!trustRes.isTrusted) {
              // setApprovalForAll(true) to UNKNOWN operator -> High
              const evId = `ev-nft-approval-for-all-${Date.now()}`;
              evidenceMap[evId] = {
                id: evId,
                type: 'behavioral',
                provenance: 'CalldataIntentDecoder',
                relevantAddresses: [operator],
                chainId,
                rawSupportingData: { operator, approved: true, trustResolution: trustRes },
              };

              findings.push({
                id: `finding-nft-setapprovalforall-${Date.now()}`,
                ruleId: 'collection_wide_nft_approval',
                severity: 'high',
                title: 'Collection-Wide NFT Approval to Unknown Operator',
                plainEnglishExplanation: `This transaction calls setApprovalForAll(true) for operator ${operator}. Available trust and identity evidence cannot verify this operator (absence from a threat database does not establish trust). This gives the operator full permission to transfer EVERY NFT you own in this contract without further confirmation.`,
                evidenceIds: [evId],
                confidence: { level: 'high', reason: 'Explicit setApprovalForAll(true) detected targeting unverified operator' },
                assumptions: ['Target contract complies with ERC-721 or ERC-1155 standards'],
                executionContext: 'decoded_intent',
                remediation: 'Do not approve unless this operator is an established marketplace contract whose address you have verified.',
              });
            }
          } else {
            // setApprovalForAll(false) -> Revocation (Low)
            const evId = `ev-nft-revocation-${Date.now()}`;
            evidenceMap[evId] = {
              id: evId,
              type: 'behavioral',
              provenance: 'CalldataIntentDecoder',
              relevantAddresses: [operator],
              chainId,
              rawSupportingData: { operator, approved: false, trustResolution: trustRes },
            };

            findings.push({
              id: `finding-nft-revocation-${Date.now()}`,
              ruleId: 'nft_approval_revocation',
              severity: 'low',
              title: 'Collection-Wide NFT Approval Revoked',
              plainEnglishExplanation: `This transaction calls setApprovalForAll(false) for operator ${operator}. This revokes collection-wide NFT transfer permissions.`,
              evidenceIds: [evId],
              confidence: { level: 'high', reason: 'Explicit setApprovalForAll(false) detected in decoded calldata' },
              assumptions: ['Target contract complies with ERC-721 or ERC-1155 standards'],
              executionContext: 'decoded_intent',
            });
          }
        }
      }
    }
  }

  // 6. Unknown function with unresolved effects -> Unknown coverage; warning (severity: unknown)
  // Principle: Do NOT label unverified code malicious!
  for (const call of allCalls) {
    if (call.isUnknownFunction) {
      const evId = `ev-unknown-fn-${call.selector || 'raw'}`;
      evidenceMap[evId] = {
        id: evId,
        type: 'ast_analysis',
        provenance: 'CalldataIntentDecoder',
        relevantAddresses: call.targetContract ? [call.targetContract] : [],
        chainId,
        rawSupportingData: { rawCalldata: call.rawCalldata, selector: call.selector },
      };

      findings.push({
        id: `finding-unknown-function-${Date.now()}`,
        ruleId: 'unknown_function_unresolved_effects',
        severity: 'unknown',
        title: 'Transaction Invokes Unknown Function with Unresolved Effects',
        plainEnglishExplanation: `The transaction calldata targets an unknown function selector (${call.selector}). The target contract code is unverified and cannot be resolved from verified ABI registries. This unverified code is not proven malicious, but its execution path and on-chain effects cannot be deterministically verified.`,
        evidenceIds: [evId],
        confidence: { level: 'medium', reason: 'Selector lookup found no verified ABI definition' },
        assumptions: ['Raw calldata was not tampered with'],
        executionContext: 'decoded_intent',
        remediation: 'Verify the contract on a block explorer and confirm the intended function before signing.',
      });
    }
  }

  // 7. Unverified Delegatecall Target -> Investigate; severity depends on effects and other evidence
  if (ctx.delegatecallTargets && ctx.delegatecallTargets.length > 0) {
    for (const dt of ctx.delegatecallTargets) {
      const isMalicious = addressThreats.some((t) => t.matchValue.toLowerCase() === dt.address.toLowerCase());

      const evId = `ev-delegatecall-${dt.address}`;
      evidenceMap[evId] = {
        id: evId,
        type: 'rpc_trace',
        provenance: 'SimulationTraceInspector',
        relevantAddresses: [dt.address],
        chainId,
        rawSupportingData: { delegatecallTarget: dt },
      };

      if (isMalicious) {
        findings.push({
          id: `finding-delegatecall-malicious-${Date.now()}`,
          ruleId: 'delegatecall_to_documented_malicious_target',
          severity: 'critical',
          title: 'Contract Execution Delegates Control to Documented Threat Actor',
          plainEnglishExplanation: `The transaction execution trace shows a delegatecall to address ${dt.address}, which is a verified malicious threat actor. In the EVM, delegatecall grants the target contract complete control over caller storage and assets.`,
          evidenceIds: [evId],
          confidence: { level: 'high', reason: 'Delegatecall target matches documented threat database' },
          assumptions: ['Trace accurately reflects EVM delegatecall execution'],
          executionContext: 'observed_simulation',
          remediation: 'Cancel this transaction immediately.',
        });
      } else if (!dt.isVerified) {
        // Unverified delegatecall target
        const severity: Severity = dt.observedLoss ? 'high' : 'medium';
        const title = dt.observedLoss
          ? 'Unverified Delegatecall Target with Observed Asset Movement'
          : 'Unverified Delegatecall Target: Investigation Recommended';

        findings.push({
          id: `finding-delegatecall-unverified-${Date.now()}`,
          ruleId: 'unverified_delegatecall_target',
          severity,
          title,
          plainEnglishExplanation: `The executing contract executes a delegatecall to unverified address ${dt.address}. In the EVM, delegatecall executes foreign code within the caller's storage and authorization context. Severity is evaluated from target provenance and observed state effects (${dt.observedLoss ? 'unexpected asset outflow observed' : 'no immediate adverse outflow observed'}).`,
          evidenceIds: [evId],
          confidence: { level: 'medium', reason: 'Delegatecall target has no verified contract source in registry' },
          assumptions: ['Delegatecall target code is immutable during execution'],
          executionContext: 'observed_simulation',
          remediation: 'Verify that the delegatecall target is an intended module or proxy implementation.',
        });
      }
    }
  }

  // 8. Evaluation of transferFrom: Do NOT flag transferFrom merely because caller differs from owner
  for (const call of allCalls) {
    if (call.functionName === 'transferFrom' || call.functionName === 'safeTransferFrom') {
      const fromParam = call.parameters?.find((p) => p.name === 'from');
      const toParam = call.parameters?.find((p) => p.name === 'to' || p.name === 'dst' || p.name === 'recipient');
      const caller = ctx.caller || intent.caller;

      if (fromParam && caller && caller.toLowerCase() !== fromParam.value.toLowerCase()) {
        // Caller differs from owner: standard delegated transfer mechanism!
        // Evaluate actual authorization and recipient rather than generating a spurious caller mismatch warning.
        if (toParam) {
          const isRecipientMalicious = addressThreats.some(
            (t) => t.matchValue.toLowerCase() === toParam.value.toLowerCase()
          );
          if (isRecipientMalicious) {
            // Already caught by malicious recipient rules
          }
        }
      }
    }
  }

  // 9. Coverage vs Expected Transfer Evaluation
  // Low observed risk requires: zero critical/high/medium/unknown findings AND sufficient coverage.
  const hasIncompleteCoverage =
    calldataCoverage === 'partial' ||
    calldataCoverage === 'unsupported' ||
    simulationCoverage === 'partial' ||
    simulationCoverage === 'unsupported';

  if (findings.length === 0) {
    if (hasIncompleteCoverage) {
      // Retain visible warning: cannot claim low risk when coverage is incomplete!
      const evId = `ev-incomplete-coverage-${Date.now()}`;
      evidenceMap[evId] = {
        id: evId,
        type: 'ast_analysis',
        provenance: 'FindingsEngineCoverageChecker',
        relevantAddresses: intent.targetContract ? [intent.targetContract] : [],
        chainId,
        rawSupportingData: { calldataCoverage, simulationCoverage },
      };

      findings.push({
        id: `finding-incomplete-coverage-${Date.now()}`,
        ruleId: 'incomplete_analysis_coverage',
        severity: 'unknown',
        title: 'Incomplete Analysis Coverage: Cannot Confirm Low Risk',
        plainEnglishExplanation: `While no known threat indicators were triggered, analysis coverage is incomplete (calldata decoding: ${calldataCoverage}, simulation: ${simulationCoverage}). A low observed risk verdict requires sufficient analysis coverage. Unresolved effects may exist.`,
        evidenceIds: [evId],
        confidence: { level: 'medium', reason: 'Coverage status indicates partial or unsupported components' },
        assumptions: ['Uninspected components could contain unverified logic'],
        executionContext: 'decoded_intent',
      });
    } else {
      // Complete coverage + zero suspicious findings -> Low observed risk (severity: low)
      const isTransfer = allCalls.some(
        (c) =>
          c.functionName === 'transfer' ||
          c.functionName === 'native_transfer' ||
          c.functionName === 'V3_SWAP_EXACT_IN' ||
          c.functionName === 'transferFrom'
      );

      const evId = `ev-expected-transfer-${Date.now()}`;
      evidenceMap[evId] = {
        id: evId,
        type: 'ast_analysis',
        provenance: 'DeterministicRulesEngine',
        relevantAddresses: intent.targetContract ? [intent.targetContract] : [],
        chainId,
        rawSupportingData: { intentSummary: intent.functionName },
      };

      findings.push({
        id: `finding-low-risk-${Date.now()}`,
        ruleId: 'expected_transfer_no_suspicious_findings',
        severity: 'low',
        title: isTransfer ? 'Standard Transfer with No Suspicious Findings' : 'Low Observed Risk',
        plainEnglishExplanation:
          'No malicious threat matches found in current threat indicator dataset, nor unlimited allowances or unverified contract patterns detected for this transaction. Analysis coverage is complete. (Note: "No match" means only that no match was found in this specific dataset, not a guarantee of absolute safety).',
        evidenceIds: [evId],
        confidence: { level: 'high', reason: 'All deterministic rules passed and simulation showed standard execution' },
        assumptions: ['Target contract operates according to expected open-source standard logic'],
        executionContext: simulationResult ? simulationResult.executionContext : 'decoded_intent',
      });
    }
  }

  return findings;
}
