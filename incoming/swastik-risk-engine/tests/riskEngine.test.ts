import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../src/engine/riskEngine';
import { defaultInMemorySimulator } from '../src/simulator/inMemorySimulator';

describe('RiskEngine End-to-End Severity & Findings Evaluation', () => {
  const engine = new RiskEngine({
    simulationProvider: defaultInMemorySimulator, // deterministic in-memory simulator for unit tests
  });

  it('evaluates Documented malicious spender receives spending authority as Critical', async () => {
    const maliciousPermit = {
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
          spender: '0x0000db5c8B030ae5034102f866416f8B25530182', // Documented Inferno Drainer Spender
          value: '10000000000',
          nonce: '0',
          deadline: '2000000000',
        },
      },
    };

    const report = await engine.analyze(maliciousPermit);

    expect(report.overallSeverity).toBe('critical');
    expect(report.riskScore).toBe(95);

    // Verify conditional simulation outcome label
    expect(report.simulationResult?.conditionalLabel).toBe(
      'Conditional outcome if this permit is signed and accepted.'
    );

    // Verify state override assumption disclosure
    expect(
      report.simulationResult?.assumptions.some((a) => a.includes('State override'))
    ).toBe(true);

    // Check findings format
    const critFinding = report.findings.find((f) => f.severity === 'critical');
    expect(critFinding).toBeDefined();
    expect(critFinding?.ruleId).toBe('documented_malicious_spender');
    expect(critFinding?.plainEnglishExplanation).toContain('Inferno Drainer');
    expect(critFinding?.confidence.level).toBe('high');
    expect(critFinding?.confidence.reason).toBeDefined();
    expect(critFinding?.assumptions.length).toBeGreaterThan(0);
    expect(critFinding?.executionContext).toBe('conditional_modeling');

    // Ensure report summary NEVER says safe
    expect(report.summary.toLowerCase()).not.toContain('is safe');
  });

  it('evaluates Unlimited approval to an unknown spender as High', async () => {
    const unlimitedApprovalTx = {
      type: 'transaction' as const,
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      value: '0',
      // approve(0x9999999999999999999999999999999999999999, 2^256-1)
      calldata:
        '0x095ea7b30000000000000000000000009999999999999999999999999999999999999999ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };

    const report = await engine.analyze(unlimitedApprovalTx);

    expect(report.overallSeverity).toBe('high');
    const highFinding = report.findings.find((f) => f.ruleId === 'unlimited_approval_unknown_spender');
    expect(highFinding).toBeDefined();
    expect(highFinding?.severity).toBe('high');
    expect(highFinding?.executionContext).toBe('decoded_intent');
    expect(highFinding?.plainEnglishExplanation).toContain('unlimited allowance');
  });

  it('evaluates Collection-wide NFT approval (setApprovalForAll) as High', async () => {
    const nftApprovalTx = {
      type: 'transaction' as const,
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
      value: '0',
      // setApprovalForAll(0x8888888888888888888888888888888888888888, true)
      calldata:
        '0xa22cb46500000000000000000000000088888888888888888888888888888888888888880000000000000000000000000000000000000000000000000000000000000001',
    };

    const report = await engine.analyze(nftApprovalTx);

    expect(report.overallSeverity).toBe('high');
    const nftFinding = report.findings.find((f) => f.ruleId === 'collection_wide_nft_approval');
    expect(nftFinding).toBeDefined();
    expect(nftFinding?.plainEnglishExplanation).toContain('setApprovalForAll(true)');
  });

  it('evaluates Unknown function with unresolved effects as Unknown coverage; warning (severity: unknown)', async () => {
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
    const unknownFinding = report.findings.find((f) => f.ruleId === 'unknown_function_unresolved_effects');
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding?.severity).toBe('unknown');
  });

  it('evaluates Expected transfer with no suspicious findings as Low observed risk (severity: low)', async () => {
    const safeTransferTx = {
      type: 'transaction' as const,
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      value: '1000000000000000000', // 1 ETH
      calldata: '0x',
    };

    const report = await engine.analyze(safeTransferTx);

    expect(report.overallSeverity).toBe('low');
    expect(report.findings[0].ruleId).toBe('expected_transfer_no_suspicious_findings');
    expect(report.findings[0].severity).toBe('low');
    // Summary must never say "is safe"
    expect(report.summary).toContain('LOW OBSERVED RISK');
    expect(report.summary.toLowerCase()).not.toContain('is safe');
  });
});
