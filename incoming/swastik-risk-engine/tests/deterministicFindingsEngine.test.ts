import { describe, it, expect } from 'vitest';
import {
  evaluateDeterministicRules,
  MAX_UINT256,
  EXCESSIVE_FINITE_THRESHOLD,
  FINDINGS_ENGINE_VERSION,
} from '../src/engine/deterministicRules';
import { RiskEngine } from '../src/engine/riskEngine';
import { defaultThreatProvider, VersionedThreatStore } from '../src/providers/threatProvider';
import { DefaultTrustRegistry, defaultTrustRegistry } from '../src/providers/trustRegistry';
import { defaultInMemorySimulator } from '../src/simulator/inMemorySimulator';
import { type DecodedIntent } from '../src/schemas/intent';
import { type Evidence } from '../src/schemas/evidence';
import { type SimulationResult } from '../src/schemas/simulation';

describe('Deterministic, Versioned Findings Engine', () => {
  it('exports valid findings engine version identifier', () => {
    expect(FINDINGS_ENGINE_VERSION).toBe('1.0.0');
  });

  describe('Table-Driven Rule Evaluations & Counterexamples', () => {
    interface RuleTestCase {
      name: string;
      description: string;
      intent: DecodedIntent;
      threatMatches?: any[];
      simulationResult?: SimulationResult;
      delegatecallTargets?: Array<{ address: string; isVerified: boolean; observedLoss?: boolean }>;
      caller?: string;
      calldataCoverage?: 'complete' | 'partial' | 'unsupported';
      simulationCoverage?: 'complete' | 'partial' | 'unsupported';
      expectedSeverity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
      expectedRuleIds: string[];
      forbiddenRuleIds?: string[];
      assertions?: (findings: any[], evidenceMap: Record<string, Evidence>) => void;
    }

    const testCases: RuleTestCase[] = [
      // 1. Malicious Spender Grant vs Revocation
      {
        name: 'Malicious Spender: Nonzero spending authority -> Critical',
        description: 'Grants nonzero approval to documented Inferno Drainer',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x0000db5c8b030ae5034102f866416f8b25530182' }, // Inferno
            { name: 'amount', type: 'uint256', value: '1000000' },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: defaultThreatProvider.matchAddress('0x0000db5c8b030ae5034102f866416f8b25530182', 1, 'spender'),
        expectedSeverity: 'critical',
        expectedRuleIds: ['documented_malicious_spender'],
        forbiddenRuleIds: ['erc20_allowance_revocation_malicious_spender'],
        assertions: (findings, evidence) => {
          const f = findings.find((x) => x.ruleId === 'documented_malicious_spender');
          expect(f.severity).toBe('critical');
          expect(f.plainEnglishExplanation).toContain('verified threat actor');
          expect(f.executionContext).toBe('decoded_intent');
          expect(f.evidenceIds.length).toBeGreaterThan(0);
        },
      },
      {
        name: 'Malicious Spender: Revocation approve(spender, 0) -> Low (not Critical)',
        description: 'Stripping existing allowance from Inferno Drainer is a protective revocation',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x0000db5c8b030ae5034102f866416f8b25530182' },
            { name: 'amount', type: 'uint256', value: '0' },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: defaultThreatProvider.matchAddress('0x0000db5c8b030ae5034102f866416f8b25530182', 1, 'spender'),
        expectedSeverity: 'low',
        expectedRuleIds: ['erc20_allowance_revocation_malicious_spender'],
        forbiddenRuleIds: ['documented_malicious_spender'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'erc20_allowance_revocation_malicious_spender');
          expect(f.severity).toBe('low');
          expect(f.plainEnglishExplanation).toContain('protective revocation');
        },
      },
      {
        name: 'Malicious Spender: Unsigned permit -> Critical under conditional_modeling',
        description: 'Permit authorization evaluated under conditional context',
        intent: {
          type: 'eip712',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'permit',
          parameters: [
            { name: 'spender', type: 'address', value: '0x0000db5c8b030ae5034102f866416f8b25530182' },
            { name: 'value', type: 'uint256', value: '5000000000' },
          ],
          rawCalldata: '0x',
          isUnknownFunction: false,
        } as any,
        threatMatches: defaultThreatProvider.matchAddress('0x0000db5c8b030ae5034102f866416f8b25530182', 1, 'spender'),
        expectedSeverity: 'critical',
        expectedRuleIds: ['documented_malicious_spender'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'documented_malicious_spender');
          expect(f.severity).toBe('critical');
          expect(f.executionContext).toBe('conditional_modeling');
          expect(f.plainEnglishExplanation).toContain('granted only if signed and accepted');
        },
      },

      // 2. Unlimited vs Excessive Finite vs Normal ERC-20 Approvals
      {
        name: 'Unlimited ERC-20 Approval (type(uint256).max) to Unknown Spender -> High',
        description: 'Exact max uint256 granted to unverified spender',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x1111111111111111111111111111111111111111' }, // Unknown
            { name: 'amount', type: 'uint256', value: MAX_UINT256.toString() },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'high',
        expectedRuleIds: ['unlimited_approval_unknown_spender'],
        forbiddenRuleIds: ['excessive_finite_erc20_approval_unknown_spender'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'unlimited_approval_unknown_spender');
          expect(f.severity).toBe('high');
          expect(f.plainEnglishExplanation).toContain('maximum possible 2^256 - 1');
          expect(f.plainEnglishExplanation).toContain('absence from a threat database does not establish trust');
        },
      },
      {
        name: 'Excessive Finite ERC-20 Approval (2^128) to Unknown Spender -> Medium',
        description: 'Finite large allowance categorized separately from max uint256',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x1111111111111111111111111111111111111111' },
            { name: 'amount', type: 'uint256', value: EXCESSIVE_FINITE_THRESHOLD.toString() },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'medium',
        expectedRuleIds: ['excessive_finite_erc20_approval_unknown_spender'],
        forbiddenRuleIds: ['unlimited_approval_unknown_spender'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'excessive_finite_erc20_approval_unknown_spender');
          expect(f.severity).toBe('medium');
          expect(f.plainEnglishExplanation).toContain('unusually large finite allowance');
        },
      },
      {
        name: 'Normal Finite Approval (100) to Unknown Spender -> Low observed risk',
        description: 'Standard trade allowance triggers neither unlimited nor excessive rules',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x1111111111111111111111111111111111111111' },
            { name: 'amount', type: 'uint256', value: '100' },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'low',
        expectedRuleIds: ['expected_transfer_no_suspicious_findings'],
        forbiddenRuleIds: [
          'unlimited_approval_unknown_spender',
          'excessive_finite_erc20_approval_unknown_spender',
        ],
      },
      {
        name: 'Unlimited Approval to Verified Trusted Spender (Uniswap) -> Bypass Unknown Warning',
        description: 'Approved address verified in TrustRegistry as canonical Uniswap router',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' }, // Uniswap V3 SwapRouter02
            { name: 'amount', type: 'uint256', value: MAX_UINT256.toString() },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'low',
        expectedRuleIds: ['expected_transfer_no_suspicious_findings'],
        forbiddenRuleIds: ['unlimited_approval_unknown_spender'],
      },
      {
        name: 'Standard Allowance Revocation approve(unknown, 0) -> Low',
        description: 'Resetting allowance to 0 for unknown spender',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: '0x1111111111111111111111111111111111111111' },
            { name: 'amount', type: 'uint256', value: '0' },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'low',
        expectedRuleIds: ['erc20_allowance_revocation'],
        forbiddenRuleIds: ['unlimited_approval_unknown_spender'],
      },

      // 3. Collection-Wide NFT Approvals: Grant vs Revocation vs Trusted
      {
        name: 'NFT Approval: setApprovalForAll(unknown, true) -> High',
        description: 'Full collection access granted to unknown operator',
        intent: {
          type: 'transaction',
          targetContract: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          functionName: 'setApprovalForAll',
          parameters: [
            { name: 'operator', type: 'address', value: '0x2222222222222222222222222222222222222222' }, // Unknown
            { name: 'approved', type: 'bool', value: 'true' },
          ],
          rawCalldata: '0xa22cb465',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'high',
        expectedRuleIds: ['collection_wide_nft_approval'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'collection_wide_nft_approval');
          expect(f.severity).toBe('high');
          expect(f.plainEnglishExplanation).toContain('setApprovalForAll(true)');
          expect(f.plainEnglishExplanation).toContain('absence from a threat database does not establish trust');
        },
      },
      {
        name: 'NFT Approval Revocation: setApprovalForAll(unknown, false) -> Low',
        description: 'Revoking operator permission does NOT trigger high finding',
        intent: {
          type: 'transaction',
          targetContract: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          functionName: 'setApprovalForAll',
          parameters: [
            { name: 'operator', type: 'address', value: '0x2222222222222222222222222222222222222222' },
            { name: 'approved', type: 'bool', value: 'false' },
          ],
          rawCalldata: '0xa22cb465',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'low',
        expectedRuleIds: ['nft_approval_revocation'],
        forbiddenRuleIds: ['collection_wide_nft_approval'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'nft_approval_revocation');
          expect(f.severity).toBe('low');
          expect(f.plainEnglishExplanation).toContain('revokes collection-wide NFT transfer permissions');
        },
      },
      {
        name: 'NFT Approval to Trusted Operator (OpenSea Seaport) -> Bypass Unknown Warning',
        description: 'Operator is verified in TrustRegistry',
        intent: {
          type: 'transaction',
          targetContract: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
          functionName: 'setApprovalForAll',
          parameters: [
            { name: 'operator', type: 'address', value: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC' }, // Seaport 1.5
            { name: 'approved', type: 'bool', value: 'true' },
          ],
          rawCalldata: '0xa22cb465',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        expectedSeverity: 'low',
        expectedRuleIds: ['expected_transfer_no_suspicious_findings'],
        forbiddenRuleIds: ['collection_wide_nft_approval'],
      },

      // 4. Simulated Asset Outflow to Malicious Recipient (Observed vs Modeled)
      {
        name: 'Observed Simulated Outflow to Malicious Recipient -> Critical',
        description: 'Transaction simulation observed net outflow to Tornado Gov Exploiter',
        intent: {
          type: 'transaction',
          targetContract: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
          functionName: 'swapExactTokensForTokens',
          rawCalldata: '0x38ed1739',
          isUnknownFunction: false,
        } as any,
        threatMatches: defaultThreatProvider.matchAddress('0x592340957ebc9e4afb0e9af221d06fdddf789de9', 1, 'recipient'),
        simulationResult: {
          success: true,
          revertReason: undefined,
          assetDeltas: [
            { account: '0x592340957ebc9e4afb0e9af221d06fdddf789de9', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amountDelta: '1000000000' },
          ],
          logs: [],
          callTraces: [],
          assumptions: ['Local fork snapshot'],
          executionContext: 'observed_simulation',
        } as unknown as SimulationResult,
        expectedSeverity: 'critical',
        expectedRuleIds: ['simulated_outflow_malicious_recipient'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'simulated_outflow_malicious_recipient');
          expect(f.severity).toBe('critical');
          expect(f.executionContext).toBe('observed_simulation');
          expect(f.title).toContain('Observed Simulated Asset Outflow');
        },
      },
      {
        name: 'Conditional Modeled Permit Outflow -> Never described as observed effect',
        description: 'Unsigned permit simulation has conditionalLabel',
        intent: {
          type: 'eip712',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'permit',
          parameters: [
            { name: 'spender', type: 'address', value: '0x0000db5c8b030ae5034102f866416f8b25530182' },
          ],
          rawCalldata: '0x',
          isUnknownFunction: false,
        } as any,
        threatMatches: defaultThreatProvider.matchAddress('0x0000db5c8b030ae5034102f866416f8b25530182', 1, 'spender'),
        simulationResult: {
          success: true,
          revertReason: undefined,
          assetDeltas: [
            { account: '0x0000db5c8b030ae5034102f866416f8b25530182', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amountDelta: '5000000000' },
          ],
          logs: [],
          callTraces: [],
          conditionalLabel: 'Conditional outcome if this permit is signed and accepted.',
          assumptions: ['State override impersonation'],
          executionContext: 'conditional_modeling',
        } as unknown as SimulationResult,
        expectedSeverity: 'critical',
        expectedRuleIds: ['simulated_outflow_malicious_recipient', 'documented_malicious_spender'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'simulated_outflow_malicious_recipient');
          expect(f.executionContext).toBe('conditional_modeling');
          expect(f.plainEnglishExplanation).toContain('NOT an observed transaction effect');
        },
      },

      // 5. Unknown Function with Unresolved Effects
      {
        name: 'Unknown Function -> Severity unknown, warning, unverified code NOT labeled malicious',
        description: 'Unverified selector with no verified ABI definition',
        intent: {
          type: 'transaction',
          targetContract: '0x3333333333333333333333333333333333333333',
          selector: '0x12345678',
          rawCalldata: '0x1234567800000000000000000000000000000000',
          isUnknownFunction: true,
        } as any,
        threatMatches: [],
        expectedSeverity: 'unknown',
        expectedRuleIds: ['unknown_function_unresolved_effects'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'unknown_function_unresolved_effects');
          expect(f.severity).toBe('unknown');
          expect(f.plainEnglishExplanation).toContain('unverified code is not proven malicious');
          expect(f.plainEnglishExplanation).not.toContain('malicious contract');
        },
      },

      // 6. Unverified Delegatecall Target
      {
        name: 'Unverified Delegatecall Target: Investigation Recommended -> Medium',
        description: 'Contract delegates execution to an unverified target without observed loss',
        intent: {
          type: 'transaction',
          targetContract: '0x4444444444444444444444444444444444444444',
          functionName: 'execute',
          rawCalldata: '0x61461954',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        delegatecallTargets: [
          { address: '0x5555555555555555555555555555555555555555', isVerified: false, observedLoss: false },
        ],
        expectedSeverity: 'medium',
        expectedRuleIds: ['unverified_delegatecall_target'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'unverified_delegatecall_target');
          expect(f.severity).toBe('medium');
          expect(f.plainEnglishExplanation).toContain('delegatecall executes foreign code');
        },
      },
      {
        name: 'Unverified Delegatecall Target with Observed Asset Outflow -> High',
        description: 'Contract delegates execution to unverified target with unexpected loss',
        intent: {
          type: 'transaction',
          targetContract: '0x4444444444444444444444444444444444444444',
          functionName: 'execute',
          rawCalldata: '0x61461954',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        delegatecallTargets: [
          { address: '0x5555555555555555555555555555555555555555', isVerified: false, observedLoss: true },
        ],
        expectedSeverity: 'high',
        expectedRuleIds: ['unverified_delegatecall_target'],
        assertions: (findings) => {
          const f = findings.find((x) => x.ruleId === 'unverified_delegatecall_target');
          expect(f.severity).toBe('high');
        },
      },

      // 7. transferFrom: Caller differs from Owner is NOT flagged
      {
        name: 'transferFrom where Caller differs from Owner -> Not flagged merely because caller != owner',
        description: 'Standard delegated router transfer',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'transferFrom',
          parameters: [
            { name: 'from', type: 'address', value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }, // owner (Vitalik)
            { name: 'to', type: 'address', value: '0x7777777777777777777777777777777777777777' }, // benign recipient
            { name: 'amount', type: 'uint256', value: '500' },
          ],
          rawCalldata: '0x23b872dd',
          isUnknownFunction: false,
        } as any,
        caller: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap Router (differs from owner)
        threatMatches: [],
        expectedSeverity: 'low',
        expectedRuleIds: ['expected_transfer_no_suspicious_findings'],
        assertions: (findings) => {
          expect(findings.length).toBe(1);
          expect(findings[0].ruleId).toBe('expected_transfer_no_suspicious_findings');
        },
      },

      // 8. Coverage vs Low Observed Risk
      {
        name: 'Expected transfer with Incomplete Simulation Coverage -> Warning retained, cannot claim low risk',
        description: 'Simulation failed/partial coverage prevents low risk verdict',
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'transfer',
          parameters: [
            { name: 'to', type: 'address', value: '0x7777777777777777777777777777777777777777' },
            { name: 'amount', type: 'uint256', value: '10' },
          ],
          rawCalldata: '0xa9059cbb',
          isUnknownFunction: false,
        } as any,
        threatMatches: [],
        calldataCoverage: 'complete',
        simulationCoverage: 'partial', // Incomplete!
        expectedSeverity: 'unknown',
        expectedRuleIds: ['incomplete_analysis_coverage'],
        forbiddenRuleIds: ['expected_transfer_no_suspicious_findings'],
      },
    ];

    for (const tc of testCases) {
      it(`${tc.name}`, () => {
        const evidenceMap: Record<string, Evidence> = {};
        const findings = evaluateDeterministicRules({
          intent: tc.intent,
          threatMatches: tc.threatMatches || [],
          simulationResult: tc.simulationResult,
          evidenceMap,
          chainId: 1,
          trustRegistry: defaultTrustRegistry,
          calldataCoverage: tc.calldataCoverage || 'complete',
          simulationCoverage: tc.simulationCoverage || 'complete',
          caller: tc.caller,
          delegatecallTargets: tc.delegatecallTargets,
        });

        // Check expected rule IDs
        for (const rId of tc.expectedRuleIds) {
          expect(findings.some((f) => f.ruleId === rId), `Expected finding with ruleId '${rId}'`).toBe(true);
        }

        // Check forbidden rule IDs
        if (tc.forbiddenRuleIds) {
          for (const rId of tc.forbiddenRuleIds) {
            expect(findings.some((f) => f.ruleId === rId), `Did not expect finding with ruleId '${rId}'`).toBe(false);
          }
        }

        // Check maximum severity across findings
        const severities = findings.map((f) => f.severity);
        if (tc.expectedSeverity === 'critical') {
          expect(severities).toContain('critical');
        } else if (tc.expectedSeverity === 'high') {
          expect(severities).toContain('high');
        } else if (tc.expectedSeverity === 'medium') {
          expect(severities).toContain('medium');
        } else if (tc.expectedSeverity === 'unknown') {
          expect(severities).toContain('unknown');
        } else {
          expect(severities.every((s) => s === 'low')).toBe(true);
        }

        if (tc.assertions) {
          tc.assertions(findings, evidenceMap);
        }
      });
    }
  });

  describe('Demo Evidence Isolation', () => {
    it('labels findings originating from demo indicators with [DEMO ONLY] prefix', () => {
      const sandboxStore = new VersionedThreatStore({ includeDemo: true });
      const demoSpender = '0xDeadDeaDDeADdeAddeAddEAddeadDeaDDEAd0001';
      const demoMatches = sandboxStore.matchAddress(demoSpender, 1, 'spender');

      const evidenceMap: Record<string, Evidence> = {};
      const findings = evaluateDeterministicRules({
        intent: {
          type: 'transaction',
          targetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          functionName: 'approve',
          parameters: [
            { name: 'spender', type: 'address', value: demoSpender },
            { name: 'amount', type: 'uint256', value: '1000' },
          ],
          rawCalldata: '0x095ea7b3',
          isUnknownFunction: false,
        } as any,
        threatMatches: demoMatches,
        evidenceMap,
        chainId: 1,
      });

      const finding = findings.find((f) => f.ruleId === 'documented_malicious_spender');
      expect(finding).toBeDefined();
      expect(finding?.title).toContain('[DEMO ONLY]');
      expect(finding?.severity).toBe('critical');

      // Check evidence map contains demo metadata
      const ev = Object.values(evidenceMap).find((e) => (e.rawSupportingData as any).demoOnly === true);
      expect(ev).toBeDefined();
    });
  });

  describe('RiskEngine End-to-End Severity & Coverage Decoupling', () => {
    const engine = new RiskEngine({
      simulationProvider: defaultInMemorySimulator,
    });

    it('retains visible unknown function warning while preserving critical severity from threat match', async () => {
      // Transaction invoking an unknown function selector, targeting the documented drainer contract
      const multiRiskTx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x0000db5c8b030ae5034102f866416f8b25530182', // Documented Drainer
        value: '0',
        calldata: '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001', // unknown selector
      };

      const report = await engine.analyze(multiRiskTx);

      // Overall severity is critical due to drainer match
      expect(report.overallSeverity).toBe('critical');

      // Coverage is partial due to unknown function selector
      expect(report.coverage.components.calldataDecoding).toBe('partial');
      expect(report.coverage.status).toBe('partial');

      // Both critical finding AND unknown function finding remain clearly visible!
      const critFinding = report.findings.find((f) => f.severity === 'critical');
      const unknownFinding = report.findings.find((f) => f.severity === 'unknown');

      expect(critFinding).toBeDefined();
      expect(critFinding?.ruleId).toBe('documented_malicious_target');

      expect(unknownFinding).toBeDefined();
      expect(unknownFinding?.ruleId).toBe('unknown_function_unresolved_effects');
    });

    it('prevents low risk verdict when simulation fails, retaining visible warning', async () => {
      const failingSimulator = {
        name: 'FailingSimulator',
        isAvailable: async () => true,
        simulateTransaction: async () => {
          throw new Error('Fork RPC node disconnected');
        },
        simulateConditionalPermit: async () => {
          throw new Error('Fork RPC node disconnected');
        },
      };

      const engineWithFailingSim = new RiskEngine({
        simulationProvider: failingSimulator,
      });

      const simpleTransfer = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        // transfer(0x7777777777777777777777777777777777777777, 100)
        calldata:
          '0xa9059cbb00000000000000000000000077777777777777777777777777777777777777770000000000000000000000000000000000000000000000000000000000000064',
      };

      const report = await engineWithFailingSim.analyze(simpleTransfer);

      // Coverage must NOT be complete
      expect(report.coverage.components.simulation).toBe('failed');
      expect(report.coverage.status).toBe('failed');

      // Severity cannot be low!
      expect(report.overallSeverity).not.toBe('low');
      expect(report.overallSeverity).toBe('unknown');
    });
  });
});
