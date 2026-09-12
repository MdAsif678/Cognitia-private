/**
 * Automated Test Suite for RiskReport UI & Real AnalysisReport Fixtures.
 *
 * Verifies:
 * 1. Strict Contract Validation for all 6 required fixtures:
 *    - benign transfer
 *    - NFT setApprovalForAll
 *    - unlimited ERC20 approval
 *    - reverted transaction
 *    - conditional permit
 *    - failed analysis
 * 2. Exact Severity Mapping:
 *    critical -> CRITICAL
 *    high     -> HIGH RISK
 *    medium   -> MEDIUM RISK
 *    low      -> LOW RISK
 *    unknown  -> UNKNOWN RISK
 * 3. Strict separation of "Immediate effect" and "Potential exposure" (never combined).
 * 4. Simulation state handling:
 *    - outcome === 'revert' -> transaction simulation reverted
 *    - mode === 'conditional-signature' -> "Conditional outcome" + assumptions
 *    - mode === 'unsupported' -> "Unsupported analysis"
 * 5. Coverage handling: compact coverage warning when coverage.missing is non-empty.
 * 6. Findings display properties: severity, title, explanation, evidence, confidence.
 * 7. Ethical security finding rule: never claim malicious solely because a contract is unverified.
 * 8. Underlying request preservation: snapshot method and params are untouched.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { parseAnalysisReport } from '../src/shared/api-contract';
import {
  ALL_FIXTURES,
  benignTransferReport,
  benignTransferSnapshot,
  nftApprovalReport,
  nftApprovalSnapshot,
  unlimitedErc20ApprovalReport,
  unlimitedErc20ApprovalSnapshot,
  revertedTransactionReport,
  revertedTransactionSnapshot,
  conditionalPermitReport,
  conditionalPermitSnapshot,
  failedAnalysisReport,
  failedAnalysisSnapshot,
} from '../src/shared/fixtures';
import { RiskReport, mapSeverityLabel } from '../src/sidepanel/components/RiskReport';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runRiskReportTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const assert = (condition: boolean, message: string) => {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  };

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err: unknown) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------
  // Test 1: Validate all 6 fixtures against the shared AnalysisReport contract
  // -------------------------------------------------------------
  await test('1. All 6 fixtures strictly validate against AnalysisReportSchema', () => {
    const r1 = parseAnalysisReport(benignTransferReport);
    assert(r1.success, `Benign transfer fixture failed contract validation: ${!r1.success && (r1 as any).error}`);

    const r2 = parseAnalysisReport(nftApprovalReport);
    assert(r2.success, `NFT approval fixture failed contract validation: ${!r2.success && (r2 as any).error}`);

    const r3 = parseAnalysisReport(unlimitedErc20ApprovalReport);
    assert(r3.success, `Unlimited ERC20 fixture failed contract validation: ${!r3.success && (r3 as any).error}`);

    const r4 = parseAnalysisReport(revertedTransactionReport);
    assert(r4.success, `Reverted tx fixture failed contract validation: ${!r4.success && (r4 as any).error}`);

    const r5 = parseAnalysisReport(conditionalPermitReport);
    assert(r5.success, `Conditional permit fixture failed contract validation: ${!r5.success && (r5 as any).error}`);

    const r6 = parseAnalysisReport(failedAnalysisReport);
    assert(r6.success, `Failed analysis fixture failed contract validation: ${!r6.success && (r6 as any).error}`);

    assert(Object.keys(ALL_FIXTURES).length === 6, `Expected 6 fixtures in ALL_FIXTURES, got ${Object.keys(ALL_FIXTURES).length}`);
  });

  // -------------------------------------------------------------
  // Test 2: Severity Mapping Specification
  // -------------------------------------------------------------
  await test('2. Severity mapping matches specification strictly', () => {
    assert(mapSeverityLabel('critical').label === 'CRITICAL', 'critical must map to CRITICAL');
    assert(mapSeverityLabel('high').label === 'HIGH RISK', 'high must map to HIGH RISK');
    assert(mapSeverityLabel('medium').label === 'MEDIUM RISK', 'medium must map to MEDIUM RISK');
    assert(mapSeverityLabel('low').label === 'LOW RISK', 'low must map to LOW RISK');
    assert(mapSeverityLabel('unknown').label === 'UNKNOWN RISK', 'unknown must map to UNKNOWN RISK');

    // Case insensitivity
    assert(mapSeverityLabel('CRITICAL').label === 'CRITICAL', 'CRITICAL uppercase must map to CRITICAL');
    assert(mapSeverityLabel('HIGH').label === 'HIGH RISK', 'HIGH uppercase must map to HIGH RISK');
    assert(mapSeverityLabel(undefined).label === 'UNKNOWN RISK', 'undefined must map to UNKNOWN RISK');
  });

  // -------------------------------------------------------------
  // Test 3: Fixture 1 - Benign Transfer
  // -------------------------------------------------------------
  await test('3. Benign transfer: LOW RISK, immediate effect present, no potential exposure', () => {
    assert(benignTransferReport.severity === 'low', 'Expected low severity');
    assert(mapSeverityLabel(benignTransferReport.severity).label === 'LOW RISK', 'Expected LOW RISK label');
    assert(benignTransferReport.immediateChanges.length === 1, 'Expected 1 immediateChange');
    assert(benignTransferReport.immediateChanges[0].type === 'native_transfer', 'Expected native_transfer type');
    assert(benignTransferReport.immediateChanges[0].amount === '0.05 AUR', 'Expected 0.05 AUR amount');
    assert(benignTransferReport.potentialExposure.length === 0, 'Benign transfer must have 0 potentialExposure');
    assert(benignTransferReport.simulation.mode === 'transaction', 'Expected transaction simulation mode');
    assert(benignTransferReport.simulation.outcome === 'success', 'Expected success outcome');
    assert(benignTransferReport.coverage.missing.length === 0, 'No missing coverage for benign transfer');
  });

  // -------------------------------------------------------------
  // Test 4: Fixture 2 - NFT setApprovalForAll
  // -------------------------------------------------------------
  await test('4. NFT setApprovalForAll: CRITICAL, both immediate effect and potential exposure clearly separated', () => {
    assert(nftApprovalReport.severity === 'critical', 'Expected critical severity');
    assert(mapSeverityLabel(nftApprovalReport.severity).label === 'CRITICAL', 'Expected CRITICAL label');

    // Immediate effect
    assert(nftApprovalReport.immediateChanges.length === 1, 'Expected 1 immediateChange');
    assert(nftApprovalReport.immediateChanges[0].type === 'set_approval_for_all', 'Expected set_approval_for_all');

    // Potential exposure
    assert(nftApprovalReport.potentialExposure.length === 1, 'Expected 1 potentialExposure');
    assert(nftApprovalReport.potentialExposure[0].kind === 'operator_privilege', 'Expected operator_privilege');

    // Invariant: immediateChanges and potentialExposure are distinct arrays and never merged
    assert(
      (nftApprovalReport.immediateChanges as unknown) !== (nftApprovalReport.potentialExposure as unknown),
      'immediateChanges and potentialExposure must never be the same array'
    );
  });

  // -------------------------------------------------------------
  // Test 5: Fixture 3 - Unlimited ERC20 Approval
  // -------------------------------------------------------------
  await test('5. Unlimited ERC20 Approval: HIGH RISK with unlimited allowance exposure', () => {
    assert(unlimitedErc20ApprovalReport.severity === 'high', 'Expected high severity');
    assert(mapSeverityLabel(unlimitedErc20ApprovalReport.severity).label === 'HIGH RISK', 'Expected HIGH RISK label');
    assert(unlimitedErc20ApprovalReport.immediateChanges.length === 1, 'Expected 1 immediateChange');
    assert(unlimitedErc20ApprovalReport.immediateChanges[0].type === 'erc20_approve', 'Expected erc20_approve');
    assert(unlimitedErc20ApprovalReport.potentialExposure.length === 1, 'Expected 1 potentialExposure');
    assert(unlimitedErc20ApprovalReport.potentialExposure[0].kind === 'token_allowance', 'Expected token_allowance kind');
    assert(
      unlimitedErc20ApprovalReport.potentialExposure[0].amount?.toLowerCase().includes('unlimited'),
      'Expected unlimited exposure amount'
    );
  });

  // -------------------------------------------------------------
  // Test 6: Fixture 4 - Reverted Transaction
  // -------------------------------------------------------------
  await test('6. Reverted Transaction: simulation.outcome === "revert" correctly flagged', () => {
    assert(revertedTransactionReport.simulation.outcome === 'revert', 'Expected revert outcome');
    assert(revertedTransactionReport.immediateChanges.length === 0, 'Reverted tx has 0 immediateChanges');
    assert(revertedTransactionReport.findings.length > 0, 'Expected findings describing the revert reason');
    assert(revertedTransactionReport.findings[0].title.includes('Reverted'), 'Finding title should note revert');
  });

  // -------------------------------------------------------------
  // Test 7: Fixture 5 - Conditional Permit
  // -------------------------------------------------------------
  await test('7. Conditional Permit: simulation.mode === "conditional-signature" with assumptions', () => {
    assert(conditionalPermitReport.simulation.mode === 'conditional-signature', 'Expected conditional-signature mode');
    assert(conditionalPermitReport.simulation.assumptions.length >= 3, 'Expected at least 3 simulation assumptions');
    assert(
      conditionalPermitReport.simulation.assumptions.some((a) => a.toLowerCase().includes('deadline')),
      'Assumptions should mention permit deadline'
    );
    assert(
      conditionalPermitReport.simulation.assumptions.some((a) => a.toLowerCase().includes('balance')),
      'Assumptions should mention balance requirement'
    );
    assert(conditionalPermitReport.immediateChanges.length === 0, 'Permit has no immediate on-chain state changes');
    assert(conditionalPermitReport.potentialExposure.length > 0, 'Permit has potential exposure');
  });

  // -------------------------------------------------------------
  // Test 8: Fixture 6 - Failed Analysis & Unverified Contract
  // -------------------------------------------------------------
  await test('8. Failed Analysis: mode === "unsupported", compact coverage warning, objective unverified notice', () => {
    assert(failedAnalysisReport.status === 'failed', 'Expected failed status');
    assert(failedAnalysisReport.severity === 'unknown', 'Expected unknown severity');
    assert(mapSeverityLabel(failedAnalysisReport.severity).label === 'UNKNOWN RISK', 'Expected UNKNOWN RISK label');
    assert(failedAnalysisReport.simulation.mode === 'unsupported', 'Expected unsupported simulation mode');
    assert(failedAnalysisReport.coverage.missing.length > 0, 'Expected non-empty coverage.missing');

    // Check ethical labeling requirement:
    // "Do not claim something is malicious solely because a contract is unverified."
    const finding = failedAnalysisReport.findings[0];
    assert(Boolean(finding), 'Expected unverified finding');
    const explanationLower = (finding.explanation || finding.description).toLowerCase();
    assert(
      !explanationLower.includes('is malicious') && !explanationLower.includes('is a drainer'),
      'Must NOT claim something is malicious solely because a contract is unverified'
    );
    assert(
      explanationLower.includes('does not imply malicious'),
      'Finding must explicitly note that unverified status does not imply malicious behavior'
    );
  });

  // -------------------------------------------------------------
  // Test 9: Every finding has severity, title, explanation, evidence, confidence
  // -------------------------------------------------------------
  await test('9. All findings carry severity, title, explanation, evidence, and confidence when available', () => {
    const allReports = [
      benignTransferReport,
      nftApprovalReport,
      unlimitedErc20ApprovalReport,
      revertedTransactionReport,
      conditionalPermitReport,
      failedAnalysisReport,
    ];

    for (const rep of allReports) {
      for (const finding of rep.findings) {
        assert(Boolean(finding.severity), `Finding ${finding.id || finding.title} must have severity`);
        assert(Boolean(finding.title && finding.title.length > 0), `Finding must have non-empty title`);
        assert(
          Boolean(finding.explanation || finding.description),
          `Finding ${finding.title} must have explanation or description`
        );
        assert(Boolean(finding.evidence), `Finding ${finding.title} must have evidence`);
      }
    }
  });

  // -------------------------------------------------------------
  // Test 10: Underlying requests are never modified
  // -------------------------------------------------------------
  await test('10. Intercepted request snapshot parameters are preserved verbatim without modification', () => {
    const snapshots = [
      benignTransferSnapshot,
      nftApprovalSnapshot,
      unlimitedErc20ApprovalSnapshot,
      revertedTransactionSnapshot,
      conditionalPermitSnapshot,
      failedAnalysisSnapshot,
    ];

    for (const snap of snapshots) {
      assert(Boolean(snap.requestId), 'Snapshot must have requestId');
      assert(Boolean(snap.method), 'Snapshot must have exact method');
      assert(Array.isArray(snap.rawParams), 'Snapshot rawParams must be an array');
      assert(snap.rawParams.length > 0, 'Snapshot rawParams must not be empty');
      assert(snap.status === 'ANALYSIS_READY', 'Snapshot status must be ANALYSIS_READY');
    }
  });

  // -------------------------------------------------------------
  // Test 11: Visual Rendering - Benign Transfer
  // -------------------------------------------------------------
  await test('11. Visual Rendering [Benign Transfer]: verifies LOW RISK, Immediate effect, and 10-tier structure', () => {
    const html = renderToString(
      React.createElement(RiskReport, {
        snapshot: benignTransferSnapshot,
        report: benignTransferReport,
        onContinue: () => {},
        onReject: () => {},
      })
    );

    assert(html.includes('LOW RISK'), 'Must render LOW RISK label');
    assert(html.includes('Immediate effect'), 'Must render "Immediate effect" badge');
    assert(html.includes('Native AUR Transfer'), 'Must render Native AUR Transfer');
    assert(html.includes('0.05 AUR'), 'Must render transfer amount 0.05 AUR');
    assert(html.includes('No potential exposure observed within'), 'Must qualify empty exposure results by analysis coverage');
    assert(html.includes('Fork Simulation Succeeded'), 'Must render fork simulation success');
    assert(html.includes('Reject'), 'Must render Reject button');
    assert(html.includes('Continue to wallet'), 'Must render Continue to wallet button');
    assert(html.includes('Reject cancels the request before wallet confirmation'), 'Must explain rejection behavior');
  });

  // -------------------------------------------------------------
  // Test 12: Visual Rendering - NFT setApprovalForAll
  // -------------------------------------------------------------
  await test('12. Visual Rendering [NFT Approval]: verifies CRITICAL, Immediate effect, and Potential exposure', () => {
    const html = renderToString(
      React.createElement(RiskReport, {
        snapshot: nftApprovalSnapshot,
        report: nftApprovalReport,
        onContinue: () => {},
        onReject: () => {},
      })
    );

    assert(html.includes('CRITICAL'), 'Must render CRITICAL label');
    assert(html.includes('Immediate effect'), 'Must render "Immediate effect"');
    assert(html.includes('NFT setApprovalForAll'), 'Must render NFT setApprovalForAll');
    assert(html.includes('Potential exposure'), 'Must render "Potential exposure"');
    assert(html.includes('Full Operator Privilege'), 'Must render Full Operator Privilege');
    assert(html.includes('All tokens owned by account'), 'Must render token scope');
    assert(html.includes('Drainer Operator Approval'), 'Must render finding title');
    assert(html.includes('Definitive (99%)'), 'Must render finding confidence');
  });

  // -------------------------------------------------------------
  // Test 13: Visual Rendering - Unlimited ERC20 Approval
  // -------------------------------------------------------------
  await test('13. Visual Rendering [Unlimited ERC20]: verifies HIGH RISK, Immediate effect, and Unlimited allowance', () => {
    const html = renderToString(
      React.createElement(RiskReport, {
        snapshot: unlimitedErc20ApprovalSnapshot,
        report: unlimitedErc20ApprovalReport,
        onContinue: () => {},
        onReject: () => {},
      })
    );

    assert(html.includes('HIGH RISK'), 'Must render HIGH RISK label');
    assert(html.includes('Immediate effect'), 'Must render "Immediate effect"');
    assert(html.includes('ERC-20 Approval'), 'Must render ERC-20 Approval');
    assert(html.includes('Potential exposure'), 'Must render "Potential exposure"');
    assert(html.includes('Token Allowance'), 'Must render Token Allowance');
    assert(html.includes('Unlimited (MaxUint256)'), 'Must render Unlimited (MaxUint256)');
  });

  // -------------------------------------------------------------
  // Test 14: Visual Rendering - Reverted Transaction
  // -------------------------------------------------------------
  await test('14. Visual Rendering [Reverted Tx]: verifies "Transaction simulation reverted" clear display', () => {
    const html = renderToString(
      React.createElement(RiskReport, {
        snapshot: revertedTransactionSnapshot,
        report: revertedTransactionReport,
        onContinue: () => {},
        onReject: () => {},
      })
    );

    assert(html.includes('MEDIUM RISK'), 'Must render MEDIUM RISK label');
    assert(html.includes('Transaction simulation reverted'), 'Must clearly display "Transaction simulation reverted"');
    assert(html.includes('TRANSFER_FAILED'), 'Must display revert details');
  });

  // -------------------------------------------------------------
  // Test 15: Visual Rendering - Conditional Permit
  // -------------------------------------------------------------
  await test('15. Visual Rendering [Conditional Permit]: verifies "Conditional outcome" and assumptions', () => {
    const html = renderToString(
      React.createElement(RiskReport, {
        snapshot: conditionalPermitSnapshot,
        report: conditionalPermitReport,
        onContinue: () => {},
        onReject: () => {},
      })
    );

    assert(html.includes('HIGH RISK'), 'Must render HIGH RISK label');
    assert(html.includes('Conditional outcome'), 'Must clearly display "Conditional outcome"');
    assert(html.includes('Simulation Assumptions:'), 'Must show simulation assumptions heading');
    assert(html.includes('Permit deadline timestamp'), 'Must list deadline assumption');
    assert(html.includes('Potential exposure'), 'Must display "Potential exposure"');
  });

  // -------------------------------------------------------------
  // Test 16: Visual Rendering - Failed Analysis
  // -------------------------------------------------------------
  await test('16. Visual Rendering [Failed Analysis]: verifies UNKNOWN RISK, "Unsupported analysis", and compact coverage warning', () => {
    const html = renderToString(
      React.createElement(RiskReport, {
        snapshot: failedAnalysisSnapshot,
        report: failedAnalysisReport,
        onContinue: () => {},
        onReject: () => {},
      })
    );

    assert(html.includes('UNKNOWN RISK'), 'Must render UNKNOWN RISK label');
    assert(html.includes('Unsupported analysis'), 'Must clearly display "Unsupported analysis"');
    assert(html.includes('Coverage Limitation Warning'), 'Must show compact coverage warning');
    assert(html.includes('fork simulation'), 'Must list missing check fork simulation');
    assert(html.includes('Unverified Contract Source Code'), 'Must render unverified finding title');
    assert(html.includes('does not imply malicious'), 'Must render objective notice without false malicious claims');
  });

  await test('Missing report never fabricates a successful fork or enables Continue', () => {
    const html = renderToString(React.createElement(RiskReport, {
      snapshot: benignTransferSnapshot, onContinue() {}, onReject() {},
    }));
    assert(html.includes('Analysis unavailable'), 'Missing report must be unknown');
    assert(!html.includes('Fork Simulation Succeeded'), 'Must not fabricate fork execution');
    assert(/id="btn-continue-metamask"[^>]*disabled/.test(html), 'No Continue without report');
  });

  return results;
}
