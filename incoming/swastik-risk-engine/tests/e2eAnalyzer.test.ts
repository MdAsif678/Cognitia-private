import { describe, it, expect } from 'vitest';
import { POST } from '../src/app/api/analyze/route';
import { RiskEngine } from '../src/engine/riskEngine';
import { defaultInMemorySimulator } from '../src/simulator/inMemorySimulator';
import { formatTokenAmount } from '../src/utils/tokenFormatting';
import { analysisReportSchema, type AnalysisReport } from '../src/schemas/report';

describe('End-to-End Analyzer Suite', () => {
  const engine = new RiskEngine({
    simulationProvider: defaultInMemorySimulator,
  });

  const demoEngine = new RiskEngine({
    simulationProvider: defaultInMemorySimulator,
    includeDemo: true,
  });

  describe('1. Full Transaction Analysis: Calldata, Decoded Intent & Severity', () => {
    it('analyzes expected ETH transfer to benign recipient as Low Observed Risk (never "Safe")', async () => {
      const txReq = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        value: '1000000000000000000', // 1 ETH
        calldata: '0x',
      };

      const report = await engine.analyze(txReq);

      expect(report.overallSeverity).toBe('low');
      expect(report.summary).toContain('LOW OBSERVED RISK');
      // Invariant: Summary must NEVER state that a transaction is safe
      expect(report.summary.toLowerCase()).not.toContain('is safe');
      expect(report.summary.toLowerCase()).not.toContain(' safe.');

      expect(report.coverage.status).toBe('complete');
      expect(report.coverage.components.calldataDecoding).toBe('complete');
      expect(report.coverage.components.simulation).toBe('complete');

      // Asset deltas tracked in simulation
      expect(report.simulationResult?.assetDeltas.length).toBeGreaterThan(0);
      const ethDelta = report.simulationResult?.assetDeltas.find((d) => d.symbol === 'ETH');
      expect(ethDelta).toBeDefined();

      // Schema validation
      expect(() => analysisReportSchema.parse(report)).not.toThrow();
    });

    it('flags unlimited ERC-20 approval to an unknown spender as High risk with decoded_intent context', async () => {
      const unlimitedApprovalTx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        value: '0',
        // approve(0x9999999999999999999999999999999999999999, 2^256-1)
        calldata:
          '0x095ea7b30000000000000000000000009999999999999999999999999999999999999999ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      };

      const report = await engine.analyze(unlimitedApprovalTx);

      expect(report.overallSeverity).toBe('high');
      const finding = report.findings.find((f) => f.ruleId === 'unlimited_approval_unknown_spender');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.executionContext).toBe('decoded_intent');
      expect(finding?.plainEnglishExplanation).toContain('unlimited allowance');
      expect(finding?.confidence.level).toBe('high');
      expect(finding?.assumptions.length).toBeGreaterThan(0);

      // Spending authority formatted without precision loss
      const rawApprovedVal = report.decodedIntent.parameters?.find((p) => p.name === 'amount' || p.name === 'value')?.value;
      const formatted = formatTokenAmount(rawApprovedVal, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(formatted.isUnlimited).toBe(true);
      expect(formatted.formatted).toBe('Unlimited (2^256 - 1)');

      expect(() => analysisReportSchema.parse(report)).not.toThrow();
    });

    it('flags interaction with documented malicious address as Critical with source URL', async () => {
      const maliciousTx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        // approve(0x0000db5c8B030ae5034102f866416f8B25530182, 1000000) [Inferno Drainer Spender]
        calldata:
          '0x095ea7b30000000000000000000000000000db5c8b030ae5034102f866416f8b2553018200000000000000000000000000000000000000000000000000000000000f4240',
      };

      const report = await engine.analyze(maliciousTx);

      expect(report.overallSeverity).toBe('critical');
      const finding = report.findings.find((f) => f.ruleId === 'documented_malicious_spender');
      expect(finding).toBeDefined();
      expect(finding?.plainEnglishExplanation).toContain('Inferno Drainer');

      // Check that evidence has sourceUrl in provenance
      const evidence = Object.values(report.evidence);
      const threatEvidence = evidence.find((e) => e.type === 'address_match');
      expect(threatEvidence).toBeDefined();
      expect(threatEvidence?.provenance).toContain('etherscan.io');

      expect(() => analysisReportSchema.parse(report)).not.toThrow();
    });
  });

  describe('2. Conditional Permit Analysis: Spending Authority & Modeled Outcomes', () => {
    it('analyzes unsigned ERC-2612 permit with separate conditional outcome panel and disclosures', async () => {
      const permitReq = {
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
            spender: '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch router
            value: '500000000', // 500 USDC
            nonce: '0',
            deadline: '2000000000',
          },
        },
      };

      const report = await engine.analyze(permitReq);

      // Decoded intent properties
      expect(report.decodedIntent.type).toBe('eip712');
      expect(report.decodedIntent.owner).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
      expect(report.decodedIntent.spenderOrOperator).toBe('0x1111111254fb6c44bac0bed2854e76f90643097d');
      expect(report.decodedIntent.amount).toBe('500000000');
      expect(report.decodedIntent.typedDataDetails?.primaryType).toBe('Permit');
      expect(report.decodedIntent.typedDataDetails?.standard).toBe('ERC-2612');

      // Conditional simulation outcomes (distinct from transaction execution)
      expect(report.simulationResult).toBeDefined();
      expect(report.simulationResult?.executionContext).toBe('conditional_modeling');
      expect(report.simulationResult?.conditionalLabel).toBe(
        'Conditional outcome if this permit is signed and accepted.'
      );
      expect(
        report.simulationResult?.assumptions.some((a) => a.includes('State override'))
      ).toBe(true);

      // Spending authority token formatting
      const formatted = formatTokenAmount(report.decodedIntent.amount, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(formatted.symbol).toBe('USDC');
      expect(formatted.formatted).toBe('500 USDC');
      expect(formatted.isVerifiedToken).toBe(true);

      expect(() => analysisReportSchema.parse(report)).not.toThrow();
    });
  });

  describe('3. Unknown Signatures & Unsupported Adapters: Non-Zero Risk Verdicts', () => {
    it('returns unknown severity and unsupported coverage for unhandled EIP-712 schemas', async () => {
      const unsupportedEip712 = {
        type: 'eip712' as const,
        selectedChainId: 1,
        expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        payload: {
          types: {
            CustomVote: [
              { name: 'proposalId', type: 'uint256' },
              { name: 'support', type: 'bool' },
            ],
          },
          primaryType: 'CustomVote',
          domain: {
            name: 'Snapshot Governance',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
          },
          message: {
            proposalId: '42',
            support: true,
          },
        },
      };

      const report = await engine.analyze(unsupportedEip712);

      // Invariant: Must return partial/unsupported coverage, not a low-risk verdict
      expect(report.overallSeverity).not.toBe('low');
      expect(report.overallSeverity).toBe('unknown');
      expect(report.coverage.components.signatureAnalysis).toBe('unsupported');
      expect(report.summary).toContain('UNKNOWN COVERAGE');

      // Original payload preserved
      expect(report.decodedIntent.typedDataDetails?.primaryType).toBe('CustomVote');
      expect(report.decodedIntent.typedDataDetails?.fields).toEqual({
        proposalId: '42',
        support: true,
      });

      expect(() => analysisReportSchema.parse(report)).not.toThrow();
    });

    it('returns unknown severity and preserves hex/text for personal_sign', async () => {
      const personalSignReq = {
        type: 'personal_sign' as const,
        rawMessage: 'Please sign this message to authenticate with Decentralized App: 0x1234',
        expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        chainId: 1,
        domainOrOrigin: 'https://app.example.com',
      };

      const report = await engine.analyze(personalSignReq);

      expect(report.overallSeverity).not.toBe('low');
      expect(report.overallSeverity).toBe('unknown');
      expect(report.decodedIntent.personalSignDetails).toBeDefined();
      expect(report.decodedIntent.personalSignDetails?.rawBytes).toBe(personalSignReq.rawMessage);
      expect(report.decodedIntent.personalSignDetails?.isValidUtf8).toBe(true);
      expect(report.decodedIntent.personalSignDetails?.hexView).toMatch(/^0x/);

      expect(() => analysisReportSchema.parse(report)).not.toThrow();
    });
  });

  describe('4. Backend API Route Integration & Failure Handling (/api/analyze)', () => {
    it('returns 200 and AnalysisReport for valid POST request', async () => {
      const txReq = {
        type: 'transaction',
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
        value: '0',
        calldata: '0x',
      };

      const req = new Request('http://localhost:3000/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txReq),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const data = (await res.json()) as AnalysisReport;
      expect(data.requestId).toBeDefined();
      expect(data.overallSeverity).toBe('unknown');
      expect(data.coverage.components.simulation).toBe('failed');
      expect(() => analysisReportSchema.parse(data)).not.toThrow();
    });

    it('returns 400 with structured validation error for malformed request body', async () => {
      const invalidReq = {
        type: 'transaction',
        // missing required fields: from, to, chainId, calldata
        foo: 'bar',
      };

      const req = new Request('http://localhost:3000/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidReq),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const errData = await res.json();
      expect(errData.error).toBe('Validation Error');
      expect(errData.message).toContain('Invalid AnalysisRequest');
    });
  });

  describe('5. Demo Indicator Isolation & Prominent Labeling', () => {
    // Synthetic demo drainer spender address defined in DEMO_THREAT_DATABASE
    const demoSpender = '0xDeadDeaDDeADdeAddeAddEAddeadDeaDDEAd0001';
    // Calldata for approve(0xDeadDeaDDeADdeAddeAddEAddeadDeaDDEAd0001, 1000)
    const demoCalldata =
      '0x095ea7b3000000000000000000000000deaddeaddeaddeaddeaddeaddeaddeaddead000100000000000000000000000000000000000000000000000000000000000003e8';

    it('does NOT match demo threat indicators in default production mode', async () => {
      const txWithDemoSpender = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        calldata: demoCalldata,
      };

      // In production engine (includeDemo = false / omitted)
      const report = await engine.analyze(txWithDemoSpender);

      const demoFinding = report.findings.find((f) => f.ruleId === 'documented_malicious_spender');
      expect(demoFinding).toBeUndefined();

      const demoEvidence = Object.values(report.evidence).find((e) => e.rawSupportingData?.demoOnly === true);
      expect(demoEvidence).toBeUndefined();
    });

    it('matches demo threat indicator when includeDemo: true is explicitly requested', async () => {
      const txWithDemoSpender = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        calldata: demoCalldata,
      };

      const report = await demoEngine.analyze(txWithDemoSpender);

      expect(report.overallSeverity).toBe('critical');
      const demoFinding = report.findings.find((f) => f.ruleId === 'documented_malicious_spender');
      expect(demoFinding).toBeDefined();
      expect(demoFinding?.title).toContain('[DEMO ONLY]');

      const demoEvidence = Object.values(report.evidence).find((e) => e.rawSupportingData?.demoOnly === true);
      expect(demoEvidence).toBeDefined();
      expect(demoEvidence?.rawSupportingData?.label).toContain('[DEMO ONLY]');
    });

    it('API route honors includeDemo: true in request body', async () => {
      const req = new Request('http://localhost:3000/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transaction',
          chainId: 1,
          from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          value: '0',
          calldata: demoCalldata,
          includeDemo: true,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const report = (await res.json()) as AnalysisReport;
      expect(report.overallSeverity).toBe('critical');
      const hasDemoEvidence = Object.values(report.evidence).some((e) => e.rawSupportingData?.demoOnly === true);
      expect(hasDemoEvidence).toBe(true);
    });
  });

  describe('6. Token Formatting Precision & No-Guessing Invariants', () => {
    it('formats known token with exact decimals and symbol', () => {
      // USDC: 6 decimals
      const usdc = formatTokenAmount('1234567', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(usdc.symbol).toBe('USDC');
      expect(usdc.formatted).toBe('1.2345 USDC');
      expect(usdc.raw).toBe('1234567');
      expect(usdc.isVerifiedToken).toBe(true);

      // WETH: 18 decimals
      const weth = formatTokenAmount('1000000000000000000', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(weth.symbol).toBe('WETH');
      expect(weth.formatted).toBe('1 WETH');
      expect(weth.isVerifiedToken).toBe(true);
    });

    it('handles MAX_UINT256 as Unlimited and 0 as Revocation', () => {
      const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
      const unlim = formatTokenAmount(max, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(unlim.isUnlimited).toBe(true);
      expect(unlim.formatted).toBe('Unlimited (2^256 - 1)');

      const zero = formatTokenAmount('0', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(zero.isRevocation).toBe(true);
      expect(zero.formatted).toBe('0 (Revocation / None)');
    });

    it('does NOT guess decimals or symbols for unverified tokens (outputs exact raw base units)', () => {
      const unknownToken = '0x1234567890123456789012345678901234567890';
      const result = formatTokenAmount('987654321012345678', unknownToken);

      expect(result.isVerifiedToken).toBe(false);
      expect(result.symbol).toBe('unverified');
      expect(result.raw).toBe('987654321012345678');
      expect(result.formatted).toBe('987654321012345678 base units');
      expect(result.unverifiedNote).toContain('Decimals and symbol unverified');
    });
  });

  describe('7. Legitimately Authorized transferFrom vs Caller Discrepancy', () => {
    it('does not flag authorized transferFrom when caller is a verified trusted protocol', async () => {
      // Uniswap V3 SwapRouter02 calling transferFrom
      const trustedRouter = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
      const owner = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC

      // transferFrom(owner, trustedRouter, 1000000) [1 USDC]
      const transferFromCalldata =
        '0x23b872dd' +
        owner.slice(2).padStart(64, '0') +
        trustedRouter.slice(2).padStart(64, '0') +
        BigInt(1000000).toString(16).padStart(64, '0');

      const txReq = {
        type: 'transaction' as const,
        chainId: 1,
        from: trustedRouter,
        to: token,
        value: '0',
        calldata: transferFromCalldata,
      };

      const report = await engine.analyze(txReq);

      expect(report.overallSeverity).toBe('low');
      expect(report.findings.every((f) => f.severity !== 'critical' && f.severity !== 'high')).toBe(true);
      expect(report.summary).toContain('LOW OBSERVED RISK');
    });
  });

  describe('8. Collection-Wide Approvals and Protective Revocations', () => {
    it('evaluates setApprovalForAll(true) to unknown operator as High risk', async () => {
      const tx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
        value: '0',
        // setApprovalForAll(0x8888888888888888888888888888888888888888, true)
        calldata:
          '0xa22cb46500000000000000000000000088888888888888888888888888888888888888880000000000000000000000000000000000000000000000000000000000000001',
      };

      const report = await engine.analyze(tx);

      expect(report.overallSeverity).toBe('high');
      const nftFinding = report.findings.find((f) => f.ruleId === 'collection_wide_nft_approval');
      expect(nftFinding).toBeDefined();
      expect(nftFinding?.plainEnglishExplanation).toContain('setApprovalForAll(true)');
    });

    it('evaluates approve(spender, 0) as protective Low risk revocation even for malicious spender', async () => {
      const tx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        // approve(0x0000db5c8B030ae5034102f866416f8B25530182, 0) [Inferno Drainer Spender with zero allowance]
        calldata:
          '0x095ea7b30000000000000000000000000000db5c8b030ae5034102f866416f8b255301820000000000000000000000000000000000000000000000000000000000000000',
      };

      const report = await engine.analyze(tx);

      // A revocation must NOT be classified as Critical
      expect(report.overallSeverity).toBe('low');
      const revFinding = report.findings.find(
        (f) => f.ruleId === 'erc20_allowance_revocation_malicious_spender' || f.ruleId === 'erc20_allowance_revocation'
      );
      expect(revFinding).toBeDefined();
      expect(revFinding?.severity).toBe('low');
      expect(revFinding?.plainEnglishExplanation).toContain('revocation');
    });

    it('evaluates setApprovalForAll(operator, false) as protective Low risk revocation', async () => {
      const tx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
        value: '0',
        // setApprovalForAll(0x8888888888888888888888888888888888888888, false)
        calldata:
          '0xa22cb46500000000000000000000000088888888888888888888888888888888888888880000000000000000000000000000000000000000000000000000000000000000',
      };

      const report = await engine.analyze(tx);

      expect(report.overallSeverity).toBe('low');
      const revFinding = report.findings.find((f) => f.ruleId === 'nft_approval_revocation');
      expect(revFinding).toBeDefined();
      expect(revFinding?.severity).toBe('low');
    });
  });

  describe('9. Simulated Asset Outflow to Documented Threat Recipient', () => {
    it('evaluates simulated asset outflow to documented threat recipient as Critical', async () => {
      // Mock simulation provider returning outflow to Tornado Cash Governance Exploiter
      const maliciousRecipient = '0x592340957ebc9e4afb0e9af221d06fdddf789de9';
      const customSimEngine = new RiskEngine({
        simulationProvider: {
          name: 'mock_outflow_simulator',
          isAvailable: async () => true,
          simulateTransaction: async () => ({
            success: true,
            revertReason: undefined,
            assetDeltas: [
              {
                account: maliciousRecipient,
                token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                amountDelta: '50000000000', // +50,000 USDC to attacker
                symbol: 'USDC',
              },
            ],
            logs: [],
            callTraces: [],
            assumptions: ['Simulated fork execution'],
            executionContext: 'observed_simulation' as const,
            disclosedOverrides: [],
            delegatecallTargets: [],
            discoveryLimits: [],
            misleadingEvents: [],
          }),
          simulateConditionalPermit: async () => {
            throw new Error('Not implemented');
          },
        },
      });

      const tx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        value: '0',
        calldata: '0x',
      };

      const report = await customSimEngine.analyze(tx);

      expect(report.overallSeverity).toBe('critical');
      const outflowFinding = report.findings.find(
        (f) => f.ruleId === 'simulated_outflow_malicious_recipient'
      );
      expect(outflowFinding).toBeDefined();
      expect(outflowFinding?.severity).toBe('critical');
      expect(outflowFinding?.executionContext).toBe('observed_simulation');
      expect(outflowFinding?.plainEnglishExplanation).toContain('Tornado Cash Governance Exploiter');
    });
  });

  describe('10. Unknown Selector with Incomplete Coverage', () => {
    it('evaluates unknown selector with unresolved effects as unknown severity and never labels malicious', async () => {
      const unknownTx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        value: '0',
        calldata: '0x123456780000000000000000000000000000000000000000000000000000000000000001',
      };

      const report = await engine.analyze(unknownTx);

      expect(report.overallSeverity).toBe('unknown');
      expect(report.coverage.components.calldataDecoding).toBe('partial');
      const finding = report.findings.find((f) => f.ruleId === 'unknown_function_unresolved_effects');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('unknown');

      // Invariant: Unverified code is never labeled malicious without threat match
      expect(finding?.plainEnglishExplanation.toLowerCase()).not.toContain('malicious code');
      expect(report.summary.toLowerCase()).not.toContain('is safe');
    });
  });

  describe('11. Supported Nested Calls (Multicall / Batch Router)', () => {
    it('decodes nested multicall subcalls and preserves subcall execution semantics', async () => {
      // Multicall3 canonical address
      const multicall3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
      const subTarget1 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const subCalldata1 =
        '0x095ea7b30000000000000000000000001111111254fb6c44bac0bed2854e76f90643097d00000000000000000000000000000000000000000000000000000000000003e8';

      // aggregate((address,bytes)[]) selector: 0x252dba42
      // Prepare 1 subcall
      const callDataOffset = '0000000000000000000000000000000000000000000000000000000000000020';
      const callCount = '0000000000000000000000000000000000000000000000000000000000000001';
      const call1Offset = '0000000000000000000000000000000000000000000000000000000000000020';
      const targetPadded = subTarget1.slice(2).padStart(64, '0');
      const dataOffset = '0000000000000000000000000000000000000000000000000000000000000040';
      const dataLength = '0000000000000000000000000000000000000000000000000000000000000044';
      const subDataPadded = subCalldata1.slice(2).padEnd(192, '0');

      const aggregateCalldata =
        '0x252dba42' +
        callDataOffset +
        callCount +
        call1Offset +
        targetPadded +
        dataOffset +
        dataLength +
        subDataPadded;

      const tx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: multicall3,
        value: '0',
        calldata: aggregateCalldata,
      };

      const report = await engine.analyze(tx);

      expect(report.decodedIntent.functionName).toBe('aggregate');
      expect(report.decodedIntent.nestedCalls).toBeDefined();
      expect(report.decodedIntent.nestedCalls?.length).toBe(1);
      expect(report.decodedIntent.nestedCalls?.[0].functionName).toBe('approve');
      expect(report.decodedIntent.nestedCalls?.[0].target?.toLowerCase()).toBe(subTarget1.toLowerCase());
    });
  });

  describe('12. Invalid ERC-2612 Preconditions (Deadline & Domain Separator)', () => {
    it('flags expired permit deadline as High risk and omits conditional simulation', async () => {
      const expiredPermit = {
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
            value: '500000000',
            nonce: '0',
            deadline: '1000', // expired deadline
          },
        },
      };

      const report = await engine.analyze(expiredPermit);

      expect(report.overallSeverity).toBe('high');
      const expiredFinding = report.findings.find((f) => f.ruleId === 'erc2612_expired_deadline');
      expect(expiredFinding).toBeDefined();
      expect(expiredFinding?.severity).toBe('high');

      // Invariant: Do not model known-invalid inputs as valid
      expect(report.simulationResult).toBeUndefined();
    });

    it('flags domain separator mismatch as High risk and omits conditional simulation', async () => {
      const mismatchedDomainPermit = {
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
            name: 'WrongTokenName', // Mismatched name
            chainId: 1,
            verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          },
          message: {
            owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            spender: '0x1111111254fb6c44bac0bed2854e76f90643097d',
            value: '500000000',
            nonce: '0',
            deadline: '2000000000',
          },
        },
      };

      const report = await engine.analyze(mismatchedDomainPermit);

      expect(report.overallSeverity).toBe('high');
      const mismatchFinding = report.findings.find((f) => f.ruleId === 'erc2612_domain_separator_mismatch');
      expect(mismatchFinding).toBeDefined();
      expect(mismatchFinding?.severity).toBe('high');

      // Conditional simulation omitted
      expect(report.simulationResult).toBeUndefined();
    });
  });

  describe('13. Audit Invariant: Finding Structure & Execution Context Integrity', () => {
    it('verifies every finding in any produced report contains all mandatory schema fields', async () => {
      const tx = {
        type: 'transaction' as const,
        chainId: 1,
        from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        value: '0',
        // approve(0x0000db5c8B030ae5034102f866416f8B25530182, 1000000)
        calldata:
          '0x095ea7b30000000000000000000000000000db5c8b030ae5034102f866416f8b2553018200000000000000000000000000000000000000000000000000000000000f4240',
      };

      const report = await engine.analyze(tx);

      expect(report.findings.length).toBeGreaterThan(0);
      for (const f of report.findings) {
        // Mandatory fields check
        expect(f.id).toBeDefined();
        expect(f.id.length).toBeGreaterThan(0);
        expect(f.ruleId).toBeDefined();
        expect(f.ruleId.length).toBeGreaterThan(0);
        expect(['critical', 'high', 'medium', 'low', 'unknown']).toContain(f.severity);
        expect(f.title).toBeDefined();
        expect(f.title.length).toBeGreaterThan(0);
        expect(f.plainEnglishExplanation).toBeDefined();
        expect(f.plainEnglishExplanation.length).toBeGreaterThan(0);
        expect(f.evidenceIds).toBeDefined();
        expect(Array.isArray(f.evidenceIds)).toBe(true);
        expect(f.evidenceIds.length).toBeGreaterThan(0);
        expect(f.confidence).toBeDefined();
        expect(['high', 'medium', 'low']).toContain(f.confidence.level);
        expect(f.confidence.reason).toBeDefined();
        expect(f.confidence.reason.length).toBeGreaterThan(0);
        expect(Array.isArray(f.assumptions)).toBe(true);
        expect(['decoded_intent', 'observed_simulation', 'conditional_modeling']).toContain(
          f.executionContext
        );
      }
    });

    it('verifies conditional modeling is never represented as observed transaction execution', async () => {
      const permitReq = {
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
            value: '500000000',
            nonce: '0',
            deadline: '2000000000',
          },
        },
      };

      const report = await engine.analyze(permitReq);

      expect(report.simulationResult?.executionContext).toBe('conditional_modeling');
      expect(report.simulationResult?.conditionalLabel).toContain('Conditional outcome');
      // Must not claim execution
      expect(report.simulationResult?.conditionalLabel?.toLowerCase()).not.toContain('executed transaction');
    });

    it('verifies unsupported coverage is never represented as low risk or safe', async () => {
      const unsupportedEip712 = {
        type: 'eip712' as const,
        selectedChainId: 1,
        expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        payload: {
          types: {
            Permit2: [
              { name: 'details', type: 'PermitDetails' },
              { name: 'spender', type: 'address' },
              { name: 'sigDeadline', type: 'uint256' },
            ],
            PermitDetails: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint160' },
              { name: 'expiration', type: 'uint48' },
              { name: 'nonce', type: 'uint48' },
            ],
          },
          primaryType: 'Permit2',
          domain: {
            name: 'Permit2',
            chainId: 1,
            verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
          },
          message: {
            details: {
              token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              amount: '100000000',
              expiration: '2000000000',
              nonce: '0',
            },
            spender: '0x1111111254fb6c44bac0bed2854e76f90643097d',
            sigDeadline: '2000000000',
          },
        },
      };

      const report = await engine.analyze(unsupportedEip712);

      // Invariant: Permit2 is currently registered as unsupported with clear extension point
      expect(report.overallSeverity).not.toBe('low');
      expect(report.coverage.components.signatureAnalysis).toBe('unsupported');
      expect(report.summary.toLowerCase()).not.toContain('low observed risk');
      expect(report.summary.toLowerCase()).not.toContain('safe');
    });
  });
});
