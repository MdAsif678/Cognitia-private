import React, { useState } from 'react';
import { PendingRequestSnapshot, AnalysisResult } from '../../shared/types';
import { AnalysisReport, ReportSeverity } from '../../shared/api-contract';
import { Icon, IconName } from './Icon';
import { StateDiff } from './StateDiff';
import '../styles.css';

export interface RiskReportProps {
  snapshot: PendingRequestSnapshot;
  analysis?: AnalysisResult;
  report?: AnalysisReport;
  onContinue: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export type SeverityTone = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface SeverityMeta {
  label: string;
  tone: SeverityTone;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: IconName;
}

/**
 * Strict severity mapping per specification:
 * critical -> CRITICAL
 * high     -> HIGH RISK
 * medium   -> MEDIUM RISK
 * low      -> LOW RISK
 * unknown  -> UNKNOWN RISK
 *
 * The label is emitted exactly as listed (tests assert the uppercase string).
 * On screen the hero styles it as a display headline in sentence case
 * ("High risk." / "Critical.") via CSS text-transform; the DOM text is unchanged.
 */
export function mapSeverityLabel(severity: string | undefined): SeverityMeta {
  const s = (severity || 'unknown').toLowerCase();
  switch (s) {
    case 'critical':
      return {
        label: 'CRITICAL',
        tone: 'critical',
        color: '#e5484d',
        bgColor: 'rgba(229, 72, 77, 0.12)',
        borderColor: 'rgba(229, 72, 77, 0.45)',
        icon: 'ban',
      };
    case 'high':
      return {
        label: 'HIGH RISK',
        tone: 'high',
        color: '#ec8b3c',
        bgColor: 'rgba(236, 139, 60, 0.12)',
        borderColor: 'rgba(236, 139, 60, 0.45)',
        icon: 'alert',
      };
    case 'medium':
      return {
        label: 'MEDIUM RISK',
        tone: 'medium',
        color: '#d7a63f',
        bgColor: 'rgba(215, 166, 63, 0.12)',
        borderColor: 'rgba(215, 166, 63, 0.45)',
        icon: 'alert',
      };
    case 'low':
      return {
        label: 'LOW RISK',
        tone: 'low',
        color: '#4cc38a',
        bgColor: 'rgba(76, 195, 138, 0.12)',
        borderColor: 'rgba(76, 195, 138, 0.45)',
        icon: 'shield',
      };
    case 'unknown':
    default:
      return {
        label: 'UNKNOWN RISK',
        tone: 'unknown',
        color: '#8b909c',
        bgColor: 'rgba(139, 144, 156, 0.12)',
        borderColor: 'rgba(139, 144, 156, 0.45)',
        icon: 'info',
      };
  }
}

/**
 * Backend summaries lead with the severity word the hero already shows
 * ("HIGH RISK: ..." / "CRITICAL: ..."). Strip that, then split the first
 * sentence off as the headline so the rest can sit under it as body copy.
 */
const SUMMARY_PREFIX =
  /^\s*(critical risk|critical|high risk|medium risk|caution|low observed risk|low risk|unknown risk|analysis unavailable)\s*[:—–-]+\s*/i;

export function splitSummary(summary: string): { lead: string; rest?: string } {
  const text = summary.replace(SUMMARY_PREFIX, '').trim() || summary.trim();
  const match = /^(.+?[.!?])\s+(?=[A-Z0-9])/.exec(text);
  if (match && match[1].length >= 24 && text.length - match[1].length > 12) {
    return { lead: match[1], rest: text.slice(match[1].length).trim() };
  }
  return { lead: text };
}

const stagger = (index: number): React.CSSProperties => ({ '--i': index } as React.CSSProperties);

export const RiskReport: React.FC<RiskReportProps> = ({
  snapshot,
  analysis,
  report: explicitReport,
  onContinue,
  onReject,
}) => {
  const [pending, setPending] = useState<'continue' | 'reject' | null>(null);
  const isProcessing = pending !== null;

  // Consume the real AnalysisReport: explicit prop takes precedence, then analysis.report
  const report: AnalysisReport = explicitReport ?? analysis?.report ?? buildFallbackReport(snapshot, analysis);

  const handleContinueClick = () => {
    if (isProcessing) return;
    setPending('continue');
    onContinue(snapshot.requestId);
  };

  const handleRejectClick = () => {
    if (isProcessing) return;
    setPending('reject');
    onReject(snapshot.requestId);
  };

  const sevMeta = mapSeverityLabel(report.severity);
  const details = parseSigningDetails(snapshot);
  const summary = splitSummary(report.summary);
  // The visually primary button follows the verdict: reject leads for anything
  // dangerous or unknown, continue leads only when the simulation looked benign.
  const preferReject = sevMeta.tone === 'critical' || sevMeta.tone === 'high' || sevMeta.tone === 'unknown';
  const gaps = report.coverage.missing.length;
  const assumptions = report.simulation.assumptions;

  const rejectButton = (
    <button
      key="reject"
      type="button"
      id="btn-reject"
      className={preferReject ? 'btn btn-danger' : 'btn btn-ghost'}
      onClick={handleRejectClick}
      disabled={isProcessing}
    >
      <Icon name="x" size={15} />
      {pending === 'reject' ? 'Rejecting' : 'Reject'}
    </button>
  );
  const continueButton = (
    <button
      key="continue"
      type="button"
      id="btn-continue-metamask"
      className={preferReject ? 'btn btn-ghost' : 'btn btn-primary'}
      onClick={handleContinueClick}
      disabled={isProcessing || report.status === 'failed' || (!explicitReport && !analysis?.report)}
    >
      {pending === 'continue' ? 'Opening wallet' : 'Continue to wallet'}
      <span className="btn-icon">
        <Icon name="arrow" size={13} />
      </span>
    </button>
  );

  return (
    <article className="report" id="risk-report-container" data-severity={sevMeta.tone}>
      {/* 1. Severity and plain-language summary */}
      <header className="hero enter" id="section-severity" style={stagger(0)}>
        <div className="hero-row">
          <div className="sev">
            <span className="sev-mark">
              <Icon name={sevMeta.icon} size={18} />
            </span>
            <span className="sev-label">{sevMeta.label}</span>
          </div>
          <span className="chip">{report.status}</span>
        </div>
        <h2 className="headline" id="section-summary">
          {summary.lead}
        </h2>
        {summary.rest && <p className="hero-sub">{summary.rest}</p>}
        <p className="hero-origin">
          Requested by <span className="mono">{snapshot.origin}</span>
          {snapshot.origin !== 'replay' && <span className="hero-flag">Intercepted</span>}
        </p>
      </header>

      {/* 2. What the user is actually signing or sending */}
      <section className="block enter" id="section-signing-details" style={stagger(1)}>
        <div className="block-h">
          <h3 className="block-title">What you are signing</h3>
        </div>
        <dl className="kv">
          <dt>Action</dt>
          <dd>
            {details.methodLabel}
            <span className="mono dim">{snapshot.method}</span>
          </dd>
          <dt>Network</dt>
          <dd>
            {details.chainLabel}
            <span className="mono dim">id {report.fork?.chainId ?? snapshot.chainId ?? 'n/a'}</span>
          </dd>
          <dt>Account</dt>
          <dd className="mono" title={snapshot.account}>
            {details.accountFormatted}
          </dd>
          <dt>Target</dt>
          <dd className="mono" title={details.targetFull}>
            {details.targetFormatted}
          </dd>
          <dt>Value</dt>
          <dd className={details.valueEth !== '0 AUR' ? 'strong' : undefined}>{details.valueEth}</dd>
          <dt>Origin</dt>
          <dd className="mono">{snapshot.origin}</dd>
        </dl>
        {details.messagePreview && (
          <details className="disclosure disclosure--inline">
            <summary>
              <span>{details.messageHeader}</span>
              <Icon name="chevron" size={14} className="chev" />
            </summary>
            <pre className="code">{details.messagePreview}</pre>
          </details>
        )}
      </section>

      {/* 3. Immediate effects: what changes the moment this executes */}
      <section className="block enter" id="section-immediate-effects" style={stagger(2)}>
        <div className="block-h">
          <h3 className="block-title">Immediate effects</h3>
          <span className="count">{report.immediateChanges.length}</span>
        </div>
        {report.immediateChanges.length === 0 ? (
          <p className="empty">No immediate changes observed within the available analysis coverage.</p>
        ) : (
          <ul className="ledger">
            {report.immediateChanges.map((change, idx) => (
              <li key={idx} className="ledger-row">
                <div className="ledger-head">
                  <span className="tag">Immediate effect</span>
                  <span className="ledger-kind">{formatChangeType(change.type)}</span>
                </div>
                <div className="ledger-main">
                  <span className="ledger-asset">{change.asset ?? 'Unknown asset'}</span>
                  {change.amount && <span className="ledger-amount">{change.amount}</span>}
                </div>
                <StateDiff change={change} report={report} />
                {(change.from || change.to || change.spender) && (
                  <div className="ledger-parties">
                    {change.from && <span title={change.from}>from {formatAddress(change.from)}</span>}
                    {change.to && <span title={change.to}>to {formatAddress(change.to)}</span>}
                    {change.spender && <span title={change.spender}>spender {formatAddress(change.spender)}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(report.conditionalChanges?.length ?? 0) > 0 && <section className="block" id="section-conditional-effects">
        <div className="block-h"><h3 className="block-title">If this signature is used</h3></div>
        <p className="empty">Conditional effects, assuming a valid authorization is submitted. Signing alone does not move these assets.</p>
        <ul className="ledger">{report.conditionalChanges!.map((change, index) => <li className="ledger-row" key={index}>
          <div className="ledger-head"><span className="tag tag--later">Conditional effect</span><span className="ledger-kind">{formatChangeType(change.type)}</span></div>
          <div className="ledger-main"><span className="ledger-asset">{change.asset ?? change.token ?? 'Unknown asset'}</span><span className="ledger-amount">{change.amount}</span></div>
          <StateDiff change={change} report={report} />
          {(change.spender || change.operator) && <p className="mono">Spender {formatAddress(change.spender ?? change.operator)}</p>}
        </li>)}</ul>
      </section>}

      {/* 4. Potential exposure: what stays open for later */}
      <section className="block enter" id="section-potential-exposure" style={stagger(3)}>
        <div className="block-h">
          <h3 className="block-title">Potential exposure</h3>
          <span className="count">{report.potentialExposure.length}</span>
        </div>
        {report.potentialExposure.length === 0 ? (
          <p className="empty">
            <Icon name="check" size={14} />
            No potential exposure observed within the available analysis coverage.
          </p>
        ) : (
          <ul className="ledger">
            {report.potentialExposure.map((exposure, idx) => (
              <li key={idx} className="ledger-row">
                <div className="ledger-head">
                  <span className="tag tag--later">Potential exposure</span>
                  <span className="ledger-kind">{formatExposureKind(exposure.kind)}</span>
                </div>
                {(exposure.asset || exposure.amount) && (
                  <div className="ledger-main">
                    <span className="ledger-asset">{exposure.asset ?? 'Exposed asset'}</span>
                    {exposure.amount && <span className="ledger-amount ledger-amount--risk">{exposure.amount}</span>}
                  </div>
                )}
                {exposure.description && <p className="ledger-desc">{exposure.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Findings: severity, title, explanation, evidence, confidence */}
      <section className="block enter" id="section-findings" style={stagger(4)}>
        <div className="block-h">
          <h3 className="block-title">Findings</h3>
          <span className="count">{report.findings.length}</span>
        </div>
        {report.findings.length === 0 ? (
          <p className="empty">
            <Icon name="check" size={14} />
            No risk findings within the available analysis coverage.
          </p>
        ) : (
          <ul className="findings">
            {report.findings.map((finding, idx) => {
              const fSev = mapSeverityLabel(finding.severity);
              const explanationText = finding.explanation || finding.description;
              const evidenceText: string | undefined =
                typeof finding.evidence === 'string'
                  ? finding.evidence
                  : finding.evidence !== undefined && finding.evidence !== null
                    ? JSON.stringify(finding.evidence, null, 2)
                    : undefined;
              return (
                <li key={finding.id || idx} className="finding" data-severity={fSev.tone}>
                  <span className="finding-dot" aria-hidden="true" />
                  <div className="finding-body">
                    <div className="finding-meta">
                      <span className="finding-sev">{fSev.label}</span>
                      {finding.confidence && <span>Confidence: {finding.confidence}</span>}
                    </div>
                    <h4 className="finding-title">{finding.title}</h4>
                    <p className="finding-text">{explanationText}</p>
                    {evidenceText && (
                      <details className="disclosure disclosure--inline">
                        <summary>
                          <span>Evidence</span>
                          <Icon name="chevron" size={14} className="chev" />
                        </summary>
                        <pre className="code">{evidenceText}</pre>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 6. Simulation state */}
      <section className="block enter" id="section-simulation-state" style={stagger(5)}>
        <div className="block-h">
          <h3 className="block-title">Simulation</h3>
        </div>

        {report.simulation.outcome === 'revert' && (
          <div className="callout" data-tone="danger" id="simulation-reverted-notice">
            <Icon name="ban" size={16} />
            <div>
              <strong>Transaction simulation reverted</strong>
              The call fails on current chain state. Sent on-chain, it would fail and still cost gas.
            </div>
          </div>
        )}

        {report.simulation.mode === 'conditional-signature' && (
          <div className="callout" data-tone="info" id="simulation-conditional-notice">
            <Icon name="info" size={16} />
            <div>
              <strong>Conditional outcome</strong>
              Signing moves nothing by itself. The effect depends on who submits the signature and on chain
              state at that time.
              {assumptions.length > 0 && (
                <>
                  <span className="callout-h">Simulation Assumptions:</span>
                  <ul className="assumptions">
                    {assumptions.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {report.simulation.mode === 'unsupported' && (
          <div className="callout" data-tone="warning" id="simulation-unsupported-notice">
            <Icon name="alert" size={16} />
            <div>
              <strong>Unsupported analysis</strong>
              This payload could not be simulated, or the backend could not start a fork for it.
            </div>
          </div>
        )}

        {report.simulation.mode === 'transaction' && report.simulation.outcome === 'success' && (
          <div className="callout" data-tone="success">
            <Icon name="check" size={16} />
            <div>
              <strong>Fork Simulation Succeeded</strong>
              Executed in an isolated fork at block {report.fork?.blockNumber ?? 'n/a'} without reverting.
            </div>
          </div>
        )}

        {report.simulation.mode === 'transaction' && report.simulation.outcome === 'not-executed' && (
          <div className="callout" data-tone="warning">
            <Icon name="alert" size={16} />
            <div>
              <strong>Not executed</strong>
              The node refused to run this request on the fork, so its effect is unknown.
            </div>
          </div>
        )}
      </section>

      {/* 7. Evidence and coverage (open by default only when something is missing) */}
      <details className="disclosure block-disclosure enter" id="section-evidence" style={stagger(6)} open={gaps > 0}>
        <summary>
          <span>Evidence and coverage</span>
          {gaps > 0 && (
            <span className="summary-flag">
              {gaps} {gaps === 1 ? 'gap' : 'gaps'}
            </span>
          )}
          <Icon name="chevron" size={14} className="chev" />
        </summary>
        <div className="disclosure-body">
          {gaps > 0 && (
            <div className="callout" data-tone="warning" id="coverage-warning-notice">
              <Icon name="alert" size={16} />
              <div>
                <strong>Coverage Limitation Warning</strong>
                These checks could not be completed by the analyzer:
                <div className="pills">
                  {report.coverage.missing.map((item, idx) => (
                    <span key={idx} className="pill pill--warn">
                      {item.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <dl className="kv">
            <dt>Fork chain</dt>
            <dd>{report.fork ? `Chain ID ${report.fork.chainId}` : 'No fork (analysis failed)'}</dd>
            <dt>Block</dt>
            <dd className="mono">{report.fork?.blockNumber ?? 'n/a'}</dd>
            <dt>Block hash</dt>
            <dd className="mono" title={report.fork?.blockHash}>
              {report.fork ? formatAddress(report.fork.blockHash, 10, 8) : 'n/a'}
            </dd>
            <dt>Request hash</dt>
            <dd className="mono" title={report.requestHash}>
              {formatAddress(report.requestHash, 10, 8)}
            </dd>
          </dl>

          {report.coverage.checked.length > 0 && (
            <div>
              <span className="kv-h">Verified checks</span>
              <div className="pills">
                {report.coverage.checked.map((item, idx) => (
                  <span key={idx} className="pill">
                    <Icon name="check" size={11} />
                    {item.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {Boolean(report.evidence) && (
            <div>
              <span className="kv-h">Execution trace</span>
              <pre className="code">
                {typeof report.evidence === 'object' && report.evidence !== null
                  ? JSON.stringify(report.evidence, null, 2)
                  : String(report.evidence)}
              </pre>
            </div>
          )}
        </div>
      </details>

      {/* 8. Developer details: the raw request and report */}
      <details className="disclosure block-disclosure enter" style={stagger(7)}>
        <summary>
          <span>Developer details</span>
          <Icon name="chevron" size={14} className="chev" />
        </summary>
        <div className="disclosure-body">
          <pre className="code">
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
      </details>

      {/* 9. Reject / Continue. The request itself is never modified. */}
      <footer className="actions" id="section-actions">
        <div className="actions-row">
          {/* The primary button is emitted first so DOM, tab and visual order agree. */}
          {(preferReject ? [rejectButton, continueButton] : [continueButton, rejectButton])}
        </div>
        <div style={{ marginTop: '10px', width: '100%' }}>
          <button
            type="button"
            id="btn-detailed-analysis"
            className="btn btn-ghost"
            onClick={() => {
              const blob = new Blob([JSON.stringify({ request: snapshot, report }, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `cognitia-${snapshot.requestId}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <span>Download full analysis</span>
            <Icon name="arrow" size={13} />
          </button>
        </div>
        <p className="footnote">
          {preferReject ? 'Rejecting is the safe choice for this request. ' : ''}
          Reject cancels the request before wallet confirmation.
        </p>
      </footer>
    </article>
  );
};

// =============================================================
// Helpers
// =============================================================

function buildFallbackReport(snapshot: PendingRequestSnapshot, analysis?: AnalysisResult): AnalysisReport {
  return {
    requestId: snapshot.requestId,
    requestHash: '0x' + '00'.repeat(32),
    status: 'failed',
    severity: 'unknown',
    summary: 'Analysis unavailable. No verified report was received.',
    fork: null,
    simulation: {
      mode: 'unsupported',
      outcome: 'not-executed',
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
}

function formatAddress(addr?: string, prefixLen = 6, suffixLen = 4): string {
  if (!addr) return 'Unknown';
  if (addr.length <= prefixLen + suffixLen) return addr;
  return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`;
}

function formatChangeType(type: string): string {
  switch (type) {
    case 'native_transfer':
      return 'Native AUR Transfer';
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
  targetFull?: string;
  valueEth: string;
  messageHeader?: string;
  messagePreview?: string;
} {
  const method = snapshot.method;
  let methodLabel = 'Transaction interaction';
  if (method === 'eth_sendTransaction') methodLabel = 'Send transaction';
  if (method === 'eth_signTypedData_v4') methodLabel = 'Sign typed data (EIP-712)';
  if (method === 'personal_sign') methodLabel = 'Sign message';

  let chainLabel = 'Aurum Mainnet';
  if (snapshot.chainId === '0x89' || snapshot.chainId === '137') chainLabel = 'Nimbus Chain';
  else if (snapshot.chainId === '0xaa36a7' || snapshot.chainId === '11155111') chainLabel = 'Aurum Testnet';
  else if (snapshot.chainId === '0x7a69' || snapshot.chainId === '31337') chainLabel = 'Aurum Local';
  else if (snapshot.chainId && snapshot.chainId !== '0x1' && snapshot.chainId !== '1') chainLabel = `Chain ${snapshot.chainId}`;

  const accountFormatted = snapshot.account
    ? `${snapshot.account.slice(0, 8)}...${snapshot.account.slice(-6)}`
    : 'Active account';

  let targetFormatted = 'Contract / recipient';
  let targetFull: string | undefined;
  let valueEth = '0 AUR';
  let messageHeader: string | undefined;
  let messagePreview: string | undefined;

  const rawParams = snapshot.rawParams || [];

  if (method === 'eth_sendTransaction') {
    const tx = typeof rawParams[0] === 'object' && rawParams[0] !== null ? (rawParams[0] as Record<string, unknown>) : {};
    if (typeof tx.to === 'string') {
      targetFull = tx.to;
      targetFormatted = `${tx.to.slice(0, 8)}...${tx.to.slice(-6)}`;
    }
    if (typeof tx.value === 'string') {
      if (tx.value.startsWith('0x')) {
        const wei = BigInt(tx.value);
        const ethVal = Number(wei) / 1e18;
        valueEth = `${ethVal} AUR`;
      } else {
        valueEth = `${tx.value} AUR`;
      }
    }
    if (typeof tx.data === 'string' && tx.data.length > 2) {
      messageHeader = 'Calldata';
      messagePreview = tx.data;
    }
  } else if (method === 'personal_sign') {
    const msgParam = rawParams[0];
    targetFormatted = 'Off-chain signature';
    messageHeader = 'Message to sign';
    if (typeof msgParam === 'string') {
      if (msgParam.startsWith('0x')) {
        try {
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
    targetFormatted = 'EIP-712 verifying contract';
    messageHeader = 'Typed data';
    const typedParam = rawParams[1];
    if (typeof typedParam === 'string') {
      try {
        const parsed = JSON.parse(typedParam);
        if (parsed.domain?.verifyingContract) {
          targetFull = String(parsed.domain.verifyingContract);
          targetFormatted = formatAddress(targetFull);
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
    targetFull,
    valueEth,
    messageHeader,
    messagePreview,
  };
}
