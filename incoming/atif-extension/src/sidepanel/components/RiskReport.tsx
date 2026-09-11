import React, { useState } from 'react';
import {
  PendingRequestSnapshot,
  AnalysisResult,
} from '../../shared/types';
import {
  AnalysisReport,
  ReportSeverity,
} from '../../shared/api-contract';

export interface RiskReportProps {
  snapshot: PendingRequestSnapshot;
  analysis?: AnalysisResult;
  report?: AnalysisReport;
  onContinue: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

/**
 * Strict Severity Mapping per specification:
 * critical -> CRITICAL
 * high -> HIGH RISK
 * medium -> MEDIUM RISK
 * low -> LOW RISK
 * unknown -> UNKNOWN RISK
 */
export function mapSeverityLabel(severity: string | undefined): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
} {
  const s = (severity || 'unknown').toLowerCase();
  switch (s) {
    case 'critical':
      return {
        label: 'CRITICAL',
        color: '#ef4444',
        bgColor: 'rgba(239, 68, 68, 0.15)',
        borderColor: '#ef4444',
        icon: '🚨',
      };
    case 'high':
      return {
        label: 'HIGH RISK',
        color: '#f97316',
        bgColor: 'rgba(249, 115, 22, 0.15)',
        borderColor: '#f97316',
        icon: '⚠️',
      };
    case 'medium':
      return {
        label: 'MEDIUM RISK',
        color: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.15)',
        borderColor: '#f59e0b',
        icon: '⚠️',
      };
    case 'low':
      return {
        label: 'LOW RISK',
        color: '#22c55e',
        bgColor: 'rgba(34, 197, 94, 0.15)',
        borderColor: '#22c55e',
        icon: '🛡️',
      };
    case 'unknown':
    default:
      return {
        label: 'UNKNOWN RISK',
        color: '#94a3b8',
        bgColor: 'rgba(148, 163, 184, 0.15)',
        borderColor: '#64748b',
        icon: '❓',
      };
  }
}

export const RiskReport: React.FC<RiskReportProps> = ({
  snapshot,
  analysis,
  report: explicitReport,
  onContinue,
  onReject,
}) => {
  const [showDevDetails, setShowDevDetails] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Consume the real AnalysisReport: explicit prop takes precedence, then analysis.report
  const report: AnalysisReport = explicitReport ?? analysis?.report ?? {
    requestId: snapshot.requestId,
    requestHash: '0x' + '00'.repeat(32),
    status: 'partial',
    severity: (analysis?.severity?.toLowerCase() as ReportSeverity) || 'unknown',
    summary: analysis?.summary || 'Pending risk report inspection.',
    fork: {
      chainId: typeof snapshot.chainId === 'string' && snapshot.chainId.startsWith('0x')
        ? parseInt(snapshot.chainId, 16)
        : 1,
      blockNumber: 'latest',
      blockHash: '0x' + '00'.repeat(32),
    },
    simulation: {
      mode: 'transaction',
      outcome: 'success',
      assumptions: [],
    },
    findings: (analysis?.findings || []).map((f) => ({
      id: f.id,
      severity: (f.severity?.toLowerCase() as ReportSeverity) || 'unknown',
      title: f.title,
      description: f.description,
      explanation: f.explanation,
      evidence: f.evidence,
      confidence: f.confidence,
    })),
    immediateChanges: [],
    potentialExposure: [],
    coverage: {
      checked: [],
      missing: analysis?.warnings || [],
    },
  };

  const handleContinueClick = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    onContinue(snapshot.requestId);
  };

  const handleRejectClick = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    onReject(snapshot.requestId);
  };

  const sevMeta = mapSeverityLabel(report.severity);

  // Extract signing/sending details
  const signingDetails = parseSigningDetails(snapshot);

  return (
    <div style={containerStyle} id="risk-report-container">
      {/* =========================================================
          PRIORITY 1: Severity
          critical -> CRITICAL
          high -> HIGH RISK
          medium -> MEDIUM RISK
          low -> LOW RISK
          unknown -> UNKNOWN RISK
          ========================================================= */}
      <section style={{ ...severityBannerStyle, backgroundColor: sevMeta.bgColor, borderColor: sevMeta.borderColor }} id="section-severity">
        <div style={severityLeftStyle}>
          <span style={severityIconStyle}>{sevMeta.icon}</span>
          <div>
            <div style={{ ...severityLabelStyle, color: sevMeta.color }}>{sevMeta.label}</div>
            <div style={severitySubtextStyle}>Pre-Execution Risk Assessment</div>
          </div>
        </div>
        <div style={severityStatusBadgeGroupStyle}>
          <span style={{ ...statusBadgeStyle, borderColor: sevMeta.borderColor, color: sevMeta.color }}>
            {report.status.toUpperCase()}
          </span>
        </div>
      </section>

      {/* =========================================================
          PRIORITY 2: Plain-English summary
          ========================================================= */}
      <section style={cardStyle} id="section-summary">
        <h4 style={cardHeaderStyle}>Plain-English Summary</h4>
        <p style={summaryTextStyle}>{report.summary}</p>
      </section>

      {/* =========================================================
          PRIORITY 3: What the user is actually signing/sending
          ========================================================= */}
      <section style={cardStyle} id="section-signing-details">
        <h4 style={cardHeaderStyle}>What You Are Actually Signing / Sending</h4>
        <div style={detailsGridStyle}>
          <div style={detailRowStyle}>
            <span style={detailLabelStyle}>Action / Method:</span>
            <span style={methodTagStyle}>{signingDetails.methodLabel} ({snapshot.method})</span>
          </div>

          <div style={detailRowStyle}>
            <span style={detailLabelStyle}>Network / Chain:</span>
            <span style={detailValueMonoStyle}>Chain ID {report.fork?.chainId ?? '—'} ({signingDetails.chainLabel})</span>
          </div>

          <div style={detailRowStyle}>
            <span style={detailLabelStyle}>Signing Account:</span>
            <span style={detailValueMonoStyle}>{signingDetails.accountFormatted}</span>
          </div>

          <div style={detailRowStyle}>
            <span style={detailLabelStyle}>Target Recipient / Contract:</span>
            <span style={detailValueMonoStyle}>{signingDetails.targetFormatted}</span>
          </div>

          <div style={detailRowStyle}>
            <span style={detailLabelStyle}>Direct Value (ETH):</span>
            <span style={signingDetails.valueEth !== '0 ETH' ? highValueStyle : detailValueStyle}>
              {signingDetails.valueEth}
            </span>
          </div>

          <div style={detailRowStyle}>
            <span style={detailLabelStyle}>Origin Website:</span>
            <span style={detailValueStyle}>{snapshot.origin}</span>
          </div>
        </div>

        {/* Detailed payload / message preview if present */}
        {signingDetails.messagePreview && (
          <div style={messageBoxStyle}>
            <span style={messageBoxHeaderStyle}>{signingDetails.messageHeader}:</span>
            <pre style={messageBoxContentStyle}>{signingDetails.messagePreview}</pre>
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 4: Immediate effects
          clearly label them as: "Immediate effect"
          Never combine these into one generic "loss" section.
          ========================================================= */}
      <section style={cardStyle} id="section-immediate-effects">
        <div style={sectionHeaderWithBadgeStyle}>
          <h4 style={cardHeaderStyle}>Immediate Effects</h4>
          <span style={countPillStyle}>{report.immediateChanges.length}</span>
        </div>

        {report.immediateChanges.length === 0 ? (
          <div style={emptyNoticeStyle}>
            No immediate asset transfers or state mutations detected in simulation.
          </div>
        ) : (
          <div style={itemsListStyle}>
            {report.immediateChanges.map((change, idx) => (
              <div key={idx} style={immediateCardStyle}>
                <div style={itemTopRowStyle}>
                  <span style={immediateBadgeStyle}>Immediate effect</span>
                  <span style={changeTypeBadgeStyle}>{formatChangeType(change.type)}</span>
                </div>
                <div style={changeDetailsStyle}>
                  {change.asset && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>Asset:</span>
                      <strong style={assetNameStyle}>{change.asset}</strong>
                    </div>
                  )}
                  {change.amount && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>Amount:</span>
                      <span style={amountValueStyle}>{change.amount}</span>
                    </div>
                  )}
                  {change.from && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>From:</span>
                      <code style={monoSmallStyle}>{formatAddress(change.from)}</code>
                    </div>
                  )}
                  {change.to && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>To:</span>
                      <code style={monoSmallStyle}>{formatAddress(change.to)}</code>
                    </div>
                  )}
                  {change.spender && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>Spender:</span>
                      <code style={monoSmallStyle}>{formatAddress(change.spender)}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 5: Potential exposure
          clearly label them: "Potential exposure"
          Never combine these into one generic "loss" section.
          ========================================================= */}
      <section style={cardStyle} id="section-potential-exposure">
        <div style={sectionHeaderWithBadgeStyle}>
          <h4 style={cardHeaderStyle}>Potential Exposure</h4>
          <span style={countPillStyle}>{report.potentialExposure.length}</span>
        </div>

        {report.potentialExposure.length === 0 ? (
          <div style={emptyNoticeStyle}>
            No potential exposures, deferred allowances, or lingering permissions detected.
          </div>
        ) : (
          <div style={itemsListStyle}>
            {report.potentialExposure.map((exposure, idx) => (
              <div key={idx} style={exposureCardStyle}>
                <div style={itemTopRowStyle}>
                  <span style={exposureBadgeStyle}>Potential exposure</span>
                  <span style={exposureKindBadgeStyle}>{formatExposureKind(exposure.kind)}</span>
                </div>
                <div style={changeDetailsStyle}>
                  {exposure.asset && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>Exposed Asset:</span>
                      <strong style={assetNameStyle}>{exposure.asset}</strong>
                    </div>
                  )}
                  {exposure.amount && (
                    <div style={detailRowStyle}>
                      <span style={detailLabelStyle}>Exposed Amount:</span>
                      <span style={dangerAmountStyle}>{exposure.amount}</span>
                    </div>
                  )}
                  {exposure.description && (
                    <p style={exposureDescStyle}>{exposure.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 6: Findings
          Every finding must display:
          - severity
          - title
          - explanation
          - evidence
          - confidence when available
          Do not claim something is malicious solely because a contract is unverified.
          ========================================================= */}
      <section style={cardStyle} id="section-findings">
        <div style={sectionHeaderWithBadgeStyle}>
          <h4 style={cardHeaderStyle}>Security Findings</h4>
          <span style={countPillStyle}>{report.findings.length}</span>
        </div>

        {report.findings.length === 0 ? (
          <div style={cleanNoticeStyle}>
            ✓ No malicious drain patterns or contract vulnerabilities detected.
          </div>
        ) : (
          <div style={itemsListStyle}>
            {report.findings.map((f, idx) => {
              const fSev = mapSeverityLabel(f.severity);
              const explanationText = f.explanation || f.description;
              const evidenceText: string | undefined =
                typeof f.evidence === 'string'
                  ? f.evidence
                  : f.evidence !== undefined && f.evidence !== null
                  ? JSON.stringify(f.evidence, null, 2)
                  : undefined;

              return (
                <div key={f.id || idx} style={findingCardStyle}>
                  {/* Finding Header */}
                  <div style={findingTopRowStyle}>
                    <span
                      style={{
                        ...findingSeverityBadgeStyle,
                        backgroundColor: fSev.bgColor,
                        color: fSev.color,
                        borderColor: fSev.borderColor,
                      }}
                    >
                      {fSev.label}
                    </span>
                    <strong style={findingTitleStyle}>{f.title}</strong>
                    {f.confidence && (
                      <span style={confidenceBadgeStyle}>Confidence: {f.confidence}</span>
                    )}
                  </div>

                  {/* Explanation */}
                  <div style={findingSectionStyle}>
                    <span style={findingSectionLabelStyle}>Explanation:</span>
                    <p style={findingExplanationStyle}>{explanationText}</p>
                  </div>

                  {/* Evidence */}
                  {evidenceText && (
                    <div style={findingSectionStyle}>
                      <span style={findingSectionLabelStyle}>Evidence:</span>
                      <pre style={findingEvidenceBoxStyle}>{evidenceText}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 7: Evidence
          Simulation, fork block, forensic records
          ========================================================= */}
      <section style={cardStyle} id="section-evidence">
        <h4 style={cardHeaderStyle}>Forensic & Simulation Evidence</h4>
        <div style={evidenceGridStyle}>
          <div style={evidenceItemStyle}>
            <span style={evidenceKeyStyle}>Fork Chain:</span>
            <span style={evidenceValStyle}>{report.fork ? `Chain ID ${report.fork.chainId}` : 'No fork (analysis failed)'}</span>
          </div>
          <div style={evidenceItemStyle}>
            <span style={evidenceKeyStyle}>Fork Block Height:</span>
            <span style={evidenceValStyle}>{report.fork?.blockNumber ?? '—'}</span>
          </div>
          <div style={evidenceItemStyle}>
            <span style={evidenceKeyStyle}>Fork Block Hash:</span>
            <span style={evidenceValMonoStyle}>{report.fork ? formatAddress(report.fork.blockHash, 10, 8) : '—'}</span>
          </div>
          <div style={evidenceItemStyle}>
            <span style={evidenceKeyStyle}>Request Hash:</span>
            <span style={evidenceValMonoStyle}>{formatAddress(report.requestHash, 10, 8)}</span>
          </div>
        </div>

        {/* Top-level report evidence data */}
        {Boolean(report.evidence) && (
          <div style={extraEvidenceContainerStyle}>
            <span style={evidenceExtraTitleStyle}>Execution Trace Evidence:</span>
            <pre style={evidencePreStyle}>
              {typeof report.evidence === 'object' && report.evidence !== null
                ? JSON.stringify(report.evidence, null, 2)
                : String(report.evidence)}
            </pre>
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 8: Simulation state
          If simulation.outcome === "revert":
          clearly display that the transaction simulation reverted.

          If simulation.mode === "conditional-signature":
          display: "Conditional outcome" and show the assumptions.

          If simulation.mode === "unsupported":
          display: "Unsupported analysis"
          ========================================================= */}
      <section style={cardStyle} id="section-simulation-state">
        <h4 style={cardHeaderStyle}>Simulation State</h4>

        {/* Outcome: REVERT */}
        {report.simulation.outcome === 'revert' && (
          <div style={revertAlertStyle} id="simulation-reverted-notice">
            <div style={revertAlertHeaderStyle}>
              <span style={alertIconStyle}>🛑</span>
              <strong>Transaction simulation reverted</strong>
            </div>
            <p style={revertAlertTextStyle}>
              The transaction failed and reverted execution during local fork simulation. If submitted on-chain, this transaction will fail and consume gas fees without completing.
            </p>
          </div>
        )}

        {/* Mode: CONDITIONAL SIGNATURE */}
        {report.simulation.mode === 'conditional-signature' && (
          <div style={conditionalSignatureBoxStyle} id="simulation-conditional-notice">
            <div style={conditionalHeaderStyle}>
              <span style={alertIconStyle}>ℹ️</span>
              <strong style={conditionalTitleStyle}>Conditional outcome</strong>
            </div>
            <p style={conditionalTextStyle}>
              This signature does not execute immediate on-chain transactions; outcome depends on future state conditions and third-party execution.
            </p>
            {report.simulation.assumptions.length > 0 && (
              <div style={assumptionsContainerStyle}>
                <span style={assumptionsHeadingStyle}>Simulation Assumptions:</span>
                <ul style={assumptionsListStyle}>
                  {report.simulation.assumptions.map((item, idx) => (
                    <li key={idx} style={assumptionItemStyle}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Mode: UNSUPPORTED */}
        {report.simulation.mode === 'unsupported' && (
          <div style={unsupportedBoxStyle} id="simulation-unsupported-notice">
            <div style={unsupportedHeaderStyle}>
              <span style={alertIconStyle}>⚠️</span>
              <strong style={unsupportedTitleStyle}>Unsupported analysis</strong>
            </div>
            <p style={unsupportedTextStyle}>
              The simulation mode is unsupported for this payload or the backend could not instantiate a full execution fork.
            </p>
          </div>
        )}

        {/* Normal Transaction Success */}
        {report.simulation.mode === 'transaction' && report.simulation.outcome === 'success' && (
          <div style={simulationSuccessStyle}>
            <span style={successIconStyle}>✓</span>
            <div>
              <strong>Fork Simulation Succeeded</strong>
              <div style={successSubtextStyle}>
                Executed in an isolated EVM sandbox at block {report.fork?.blockNumber ?? '—'} without state reversion.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 9: Coverage/limitations
          If coverage.missing is non-empty:
          show a compact coverage warning.
          ========================================================= */}
      <section style={cardStyle} id="section-coverage">
        <h4 style={cardHeaderStyle}>Coverage & Limitations</h4>

        {/* Compact Coverage Warning if missing non-empty */}
        {report.coverage.missing.length > 0 && (
          <div style={compactCoverageWarningStyle} id="coverage-warning-notice">
            <div style={coverageWarningHeaderStyle}>
              <span style={alertIconStyle}>⚠️</span>
              <strong>Coverage Limitation Warning</strong>
            </div>
            <p style={coverageWarningTextStyle}>
              Incomplete analysis coverage. The following checks could not be completed by the analyzer:
            </p>
            <div style={missingPillsContainerStyle}>
              {report.coverage.missing.map((item, idx) => (
                <span key={idx} style={missingPillStyle}>{item.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}

        {/* Checked items list */}
        {report.coverage.checked.length > 0 && (
          <div style={checkedChecksContainerStyle}>
            <span style={checkedHeadingStyle}>Verified Security Checks:</span>
            <div style={checkedPillsContainerStyle}>
              {report.coverage.checked.map((item, idx) => (
                <span key={idx} style={checkedPillStyle}>✓ {item.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* =========================================================
          Developer Details: Collapsible Raw JSON
          ========================================================= */}
      <section style={devSectionContainerStyle}>
        <button
          type="button"
          onClick={() => setShowDevDetails(!showDevDetails)}
          style={devToggleButtonStyle}
        >
          <span>{showDevDetails ? '▲ Hide Developer Details' : '▼ View Developer Details (Raw Parameters)'}</span>
        </button>

        {showDevDetails && (
          <div style={devDetailsContainerStyle}>
            <pre style={rawJsonStyle}>
              {JSON.stringify(
                {
                  requestId: snapshot.requestId,
                  method: snapshot.method,
                  params: snapshot.rawParams,
                  chainId: snapshot.chainId,
                  account: snapshot.account,
                  report,
                },
                null,
                2
              )}
            </pre>
          </div>
        )}
      </section>

      {/* =========================================================
          PRIORITY 10: Reject / Continue to MetaMask
          Keep Reject and Continue to MetaMask clearly visible.
          Do not modify the underlying request.
          ========================================================= */}
      <section style={actionsStickyContainerStyle} id="section-actions">
        <div style={actionsButtonGroupStyle}>
          <button
            type="button"
            id="btn-reject"
            onClick={handleRejectClick}
            disabled={isProcessing}
            style={{
              ...rejectButtonStyle,
              opacity: isProcessing ? 0.6 : 1,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            {isProcessing ? 'Processing...' : 'Reject'}
          </button>

          <button
            type="button"
            id="btn-continue-metamask"
            onClick={handleContinueClick}
            disabled={isProcessing}
            style={{
              ...continueButtonStyle,
              opacity: isProcessing ? 0.6 : 1,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            <div style={continueButtonContentStyle}>
              <span style={continueTitleStyle}>
                {isProcessing ? 'Opening MetaMask...' : 'Continue to MetaMask →'}
              </span>
              <span style={continueSubStyle}>
                Forwards unmodified request to wallet
              </span>
            </div>
          </button>
        </div>

        <div style={safetyNoticeStyle}>
          Reject safely cancels with error code 4001 without opening MetaMask.
        </div>
      </section>
    </div>
  );
};

// =============================================================
// Helper formatters
// =============================================================

function formatAddress(addr?: string, prefixLen = 6, suffixLen = 4): string {
  if (!addr) return 'Unknown';
  if (addr.length <= prefixLen + suffixLen) return addr;
  return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`;
}

function formatChangeType(type: string): string {
  switch (type) {
    case 'native_transfer':
      return 'Native ETH Transfer';
    case 'erc20_transfer':
      return 'ERC-20 Token Transfer';
    case 'erc20_approve':
      return 'ERC-20 Approval';
    case 'set_approval_for_all':
      return 'NFT setApprovalForAll';
    case 'erc721_transfer':
      return 'ERC-721 NFT Transfer';
    case 'erc1155_transfer':
      return 'ERC-1155 Batch Transfer';
    default:
      return type.replace(/_/g, ' ');
  }
}

function formatExposureKind(kind: string): string {
  switch (kind) {
    case 'token_allowance':
      return 'Token Allowance';
    case 'operator_privilege':
      return 'Full Operator Privilege';
    case 'gasless_permit':
      return 'Off-Chain Permit';
    case 'reusable_permit':
      return 'Reusable Permit';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function parseSigningDetails(snapshot: PendingRequestSnapshot): {
  methodLabel: string;
  chainLabel: string;
  accountFormatted: string;
  targetFormatted: string;
  valueEth: string;
  messageHeader?: string;
  messagePreview?: string;
} {
  const method = snapshot.method;
  let methodLabel = 'Transaction Interaction';
  if (method === 'eth_sendTransaction') methodLabel = 'Send Transaction';
  if (method === 'eth_signTypedData_v4') methodLabel = 'Sign Typed Data (EIP-712)';
  if (method === 'personal_sign') methodLabel = 'Personal Sign (Message)';

  let chainLabel = 'Ethereum Mainnet';
  if (snapshot.chainId === '0x89' || snapshot.chainId === '137') chainLabel = 'Polygon';
  else if (snapshot.chainId === '0xaa36a7' || snapshot.chainId === '11155111') chainLabel = 'Sepolia';
  else if (snapshot.chainId && snapshot.chainId !== '0x1' && snapshot.chainId !== '1') chainLabel = `Chain ${snapshot.chainId}`;

  const accountFormatted = snapshot.account
    ? `${snapshot.account.slice(0, 8)}...${snapshot.account.slice(-6)}`
    : 'Active Account';

  let targetFormatted = 'Contract / Recipient';
  let valueEth = '0 ETH';
  let messageHeader: string | undefined;
  let messagePreview: string | undefined;

  const rawParams = snapshot.rawParams || [];

  if (method === 'eth_sendTransaction') {
    const tx = typeof rawParams[0] === 'object' && rawParams[0] !== null ? (rawParams[0] as Record<string, unknown>) : {};
    if (typeof tx.to === 'string') {
      targetFormatted = `${tx.to.slice(0, 8)}...${tx.to.slice(-6)}`;
    }
    if (typeof tx.value === 'string') {
      if (tx.value.startsWith('0x')) {
        const wei = BigInt(tx.value);
        const ethVal = Number(wei) / 1e18;
        valueEth = `${ethVal} ETH`;
      } else {
        valueEth = `${tx.value} ETH`;
      }
    }
    if (typeof tx.data === 'string' && tx.data.length > 2) {
      messageHeader = 'Calldata Payload';
      messagePreview = tx.data;
    }
  } else if (method === 'personal_sign') {
    const msgParam = rawParams[0];
    targetFormatted = 'Off-Chain Signature';
    messageHeader = 'Message Being Signed';
    if (typeof msgParam === 'string') {
      if (msgParam.startsWith('0x')) {
        try {
          // Attempt hex decode
          const hex = msgParam.slice(2);
          let str = '';
          for (let i = 0; i < hex.length; i += 2) {
            str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
          }
          messagePreview = str;
        } catch {
          messagePreview = msgParam;
        }
      } else {
        messagePreview = msgParam;
      }
    }
  } else if (method === 'eth_signTypedData_v4') {
    targetFormatted = 'EIP-712 Verifying Contract';
    messageHeader = 'Structured Typed Data';
    const typedParam = rawParams[1];
    if (typeof typedParam === 'string') {
      try {
        const parsed = JSON.parse(typedParam);
        if (parsed.domain?.verifyingContract) {
          targetFormatted = formatAddress(parsed.domain.verifyingContract);
        }
        messagePreview = JSON.stringify(parsed, null, 2);
      } catch {
        messagePreview = typedParam;
      }
    }
  }

  return {
    methodLabel,
    chainLabel,
    accountFormatted,
    targetFormatted,
    valueEth,
    messageHeader,
    messagePreview,
  };
}

// =============================================================
// CSS Styles (Rich Dark Theme Aesthetics)
// =============================================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '16px',
  gap: '14px',
  color: '#f1f5f9',
  fontFamily: 'Outfit, -apple-system, BlinkMacSystemFont, sans-serif',
};

const severityBannerStyle: React.CSSProperties = {
  borderWidth: '1px',
  borderStyle: 'solid',
  borderRadius: '12px',
  padding: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
};

const severityLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
};

const severityIconStyle: React.CSSProperties = {
  fontSize: '32px',
};

const severityLabelStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 800,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
};

const severitySubtextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  marginTop: '2px',
};

const severityStatusBadgeGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
};

const statusBadgeStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  padding: '3px 8px',
  borderRadius: '6px',
  border: '1px solid',
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
};

const cardStyle: React.CSSProperties = {
  background: '#131b2e',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const cardHeaderStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#818cf8',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '4px',
};

const sectionHeaderWithBadgeStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const countPillStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  background: '#1e293b',
  color: '#94a3b8',
  padding: '2px 8px',
  borderRadius: '10px',
};

const summaryTextStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#f8fafc',
  lineHeight: 1.5,
};

const detailsGridStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const detailRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '12px',
};

const detailLabelStyle: React.CSSProperties = {
  color: '#64748b',
  fontWeight: 500,
};

const detailValueStyle: React.CSSProperties = {
  color: '#cbd5e1',
};

const detailValueMonoStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
};

const methodTagStyle: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)',
  color: '#818cf8',
  padding: '2px 8px',
  borderRadius: '4px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  fontWeight: 600,
};

const highValueStyle: React.CSSProperties = {
  color: '#38bdf8',
  fontWeight: 700,
  fontFamily: 'JetBrains Mono, monospace',
};

const messageBoxStyle: React.CSSProperties = {
  marginTop: '8px',
  background: '#0a0f1d',
  border: '1px solid #1e293b',
  borderRadius: '6px',
  padding: '8px 10px',
};

const messageBoxHeaderStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#64748b',
  fontWeight: 700,
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: '4px',
};

const messageBoxContentStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  color: '#cbd5e1',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: '120px',
  overflowY: 'auto',
};

const emptyNoticeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  fontStyle: 'italic',
  padding: '6px 0',
};

const cleanNoticeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#4ade80',
  backgroundColor: 'rgba(34, 197, 94, 0.08)',
  border: '1px solid rgba(34, 197, 94, 0.2)',
  padding: '10px',
  borderRadius: '6px',
};

const itemsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const immediateCardStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #0284c7',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const exposureCardStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #d97706',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const itemTopRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '4px',
};

const immediateBadgeStyle: React.CSSProperties = {
  background: 'rgba(2, 132, 199, 0.2)',
  color: '#38bdf8',
  border: '1px solid #0284c7',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 800,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
};

const changeTypeBadgeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  fontWeight: 600,
};

const exposureBadgeStyle: React.CSSProperties = {
  background: 'rgba(217, 119, 6, 0.2)',
  color: '#f59e0b',
  border: '1px solid #d97706',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 800,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
};

const exposureKindBadgeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#fbbf24',
  fontWeight: 600,
};

const changeDetailsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const assetNameStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: '12px',
};

const amountValueStyle: React.CSSProperties = {
  color: '#38bdf8',
  fontWeight: 700,
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '12px',
};

const dangerAmountStyle: React.CSSProperties = {
  color: '#f87171',
  fontWeight: 700,
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '12px',
};

const exposureDescStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#cbd5e1',
  lineHeight: 1.4,
  marginTop: '4px',
};

const monoSmallStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  color: '#94a3b8',
};

const findingCardStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '8px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const findingTopRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
};

const findingSeverityBadgeStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 800,
  padding: '2px 6px',
  borderRadius: '4px',
  border: '1px solid',
  letterSpacing: '0.5px',
};

const findingTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: '#f8fafc',
  flex: 1,
};

const confidenceBadgeStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  color: '#a5b4fc',
  background: 'rgba(99, 102, 241, 0.15)',
  padding: '2px 6px',
  borderRadius: '4px',
};

const findingSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
};

const findingSectionLabelStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
};

const findingExplanationStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#cbd5e1',
  lineHeight: 1.4,
};

const findingEvidenceBoxStyle: React.CSSProperties = {
  background: '#080d1a',
  border: '1px solid #1e293b',
  borderRadius: '6px',
  padding: '8px',
  fontSize: '11px',
  color: '#38bdf8',
  fontFamily: 'JetBrains Mono, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: 0,
};

const evidenceGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '8px',
};

const evidenceItemStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '6px',
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const evidenceKeyStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
};

const evidenceValStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#f1f5f9',
};

const evidenceValMonoStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  fontFamily: 'JetBrains Mono, monospace',
};

const extraEvidenceContainerStyle: React.CSSProperties = {
  marginTop: '6px',
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '6px',
  padding: '8px 10px',
};

const evidenceExtraTitleStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  marginBottom: '4px',
  display: 'block',
};

const evidencePreStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  color: '#cbd5e1',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: '120px',
  overflowY: 'auto',
  margin: 0,
};

const revertAlertStyle: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.15)',
  border: '1px solid #ef4444',
  borderRadius: '8px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const revertAlertHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: '#ef4444',
  fontSize: '13px',
};

const revertAlertTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#fca5a5',
  lineHeight: 1.4,
};

const conditionalSignatureBoxStyle: React.CSSProperties = {
  background: 'rgba(245, 158, 11, 0.12)',
  border: '1px solid #f59e0b',
  borderRadius: '8px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const conditionalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const conditionalTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#f59e0b',
};

const conditionalTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#fcd34d',
  lineHeight: 1.4,
};

const assumptionsContainerStyle: React.CSSProperties = {
  marginTop: '6px',
  paddingTop: '6px',
  borderTop: '1px solid rgba(245, 158, 11, 0.2)',
};

const assumptionsHeadingStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#fde68a',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: '4px',
};

const assumptionsListStyle: React.CSSProperties = {
  listStyleType: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
};

const assumptionItemStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#fef3c7',
  lineHeight: 1.3,
};

const unsupportedBoxStyle: React.CSSProperties = {
  background: 'rgba(148, 163, 184, 0.12)',
  border: '1px solid #64748b',
  borderRadius: '8px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const unsupportedHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const unsupportedTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#cbd5e1',
};

const unsupportedTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  lineHeight: 1.4,
};

const simulationSuccessStyle: React.CSSProperties = {
  background: 'rgba(34, 197, 94, 0.1)',
  border: '1px solid rgba(34, 197, 94, 0.25)',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: '#4ade80',
};

const successIconStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 800,
};

const successSubtextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#86efac',
  marginTop: '2px',
};

const compactCoverageWarningStyle: React.CSSProperties = {
  background: 'rgba(245, 158, 11, 0.12)',
  border: '1px solid rgba(245, 158, 11, 0.4)',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const coverageWarningHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  color: '#f59e0b',
  fontSize: '12px',
};

const coverageWarningTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#cbd5e1',
  lineHeight: 1.3,
};

const missingPillsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginTop: '4px',
};

const missingPillStyle: React.CSSProperties = {
  background: 'rgba(245, 158, 11, 0.2)',
  color: '#fde68a',
  border: '1px solid rgba(245, 158, 11, 0.4)',
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '4px',
};

const checkedChecksContainerStyle: React.CSSProperties = {
  marginTop: '4px',
};

const checkedHeadingStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  display: 'block',
  marginBottom: '4px',
};

const checkedPillsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
};

const checkedPillStyle: React.CSSProperties = {
  background: 'rgba(34, 197, 94, 0.1)',
  color: '#4ade80',
  border: '1px solid rgba(34, 197, 94, 0.2)',
  fontSize: '10px',
  padding: '2px 6px',
  borderRadius: '4px',
};

const devSectionContainerStyle: React.CSSProperties = {
  marginTop: '2px',
};

const devToggleButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#6366f1',
  cursor: 'pointer',
  fontSize: '11px',
  fontWeight: 500,
  padding: '4px 0',
  textAlign: 'left',
};

const devDetailsContainerStyle: React.CSSProperties = {
  marginTop: '6px',
  background: '#080d1a',
  border: '1px solid #1e293b',
  borderRadius: '8px',
  padding: '10px',
  maxHeight: '140px',
  overflowY: 'auto',
};

const rawJsonStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '10px',
  color: '#cbd5e1',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: 0,
};

const actionsStickyContainerStyle: React.CSSProperties = {
  position: 'sticky',
  bottom: 0,
  background: '#0b0f19',
  paddingTop: '10px',
  paddingBottom: '6px',
  borderTop: '1px solid #1e293b',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const actionsButtonGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
};

const rejectButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 14px',
  borderRadius: '10px',
  border: '1px solid #ef4444',
  backgroundColor: 'rgba(239, 68, 68, 0.12)',
  color: '#ef4444',
  fontWeight: 700,
  fontSize: '13px',
};

const continueButtonStyle: React.CSSProperties = {
  flex: 1.4,
  padding: '12px 14px',
  borderRadius: '10px',
  border: 'none',
  backgroundColor: '#4f46e5',
  color: '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const continueButtonContentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const continueTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
};

const continueSubStyle: React.CSSProperties = {
  fontSize: '10px',
  opacity: 0.85,
  marginTop: '1px',
};

const safetyNoticeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
  textAlign: 'center',
  lineHeight: 1.3,
};

const alertIconStyle: React.CSSProperties = {
  fontSize: '16px',
};
