'use client';

import React, { useState } from 'react';
import { type AnalysisReport } from '@/schemas/report';
import { formatTokenAmount } from '@/utils/tokenFormatting';

interface SamplePreset {
  name: string;
  type: 'transaction' | 'eip712' | 'personal_sign';
  description: string;
  isDemoThreat?: boolean;
  payload: Record<string, unknown>;
}

const SAMPLE_PRESETS: SamplePreset[] = [
  {
    name: 'Standard Transfer (Low Observed Risk)',
    type: 'transaction',
    description: 'Benign 1 ETH native transfer to a standard account.',
    payload: {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      value: '1000000000000000000',
      calldata: '0x',
    },
  },
  {
    name: 'Inferno Drainer Permit (Critical)',
    type: 'eip712',
    description: 'ERC-2612 permit authorizing documented Inferno Drainer spender contract.',
    payload: {
      type: 'eip712',
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      selectedChainId: 1,
      payload: {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
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
          version: '2',
          chainId: 1,
          verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
        message: {
          owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          spender: '0x0000db5c8B030ae5034102f866416f8B25530182', // Inferno Drainer
          value: '10000000000',
          nonce: '0',
          deadline: '2000000000',
        },
      },
    },
  },
  {
    name: 'PinkDrainer NFT Operator (Critical)',
    type: 'transaction',
    description: 'setApprovalForAll(true) targeting documented PinkDrainer operator contract.',
    payload: {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
      value: '0',
      calldata:
        '0xa22cb465000000000000000000000000000000000000543666fe5bc9635f793b821415050000000000000000000000000000000000000000000000000000000000000001',
    },
  },
  {
    name: 'Unlimited USDT Approval (High)',
    type: 'transaction',
    description: 'Grants max uint256 token allowance to an unverified spender.',
    payload: {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: '0',
      calldata:
        '0x095ea7b30000000000000000000000009999999999999999999999999999999999999999ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    },
  },
  {
    name: 'DAI-Style Permit (Unsupported)',
    type: 'eip712',
    description: 'Unsupported DAI permit format with allowed boolean flag.',
    payload: {
      type: 'eip712',
      expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      selectedChainId: 1,
      payload: {
        types: {
          Permit: [
            { name: 'holder', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
            { name: 'allowed', type: 'bool' },
          ],
        },
        primaryType: 'Permit',
        domain: {
          name: 'Dai Stablecoin',
          version: '1',
          chainId: 1,
          verifyingContract: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        },
        message: {
          holder: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
          spender: '0x1111111254fb6c44bac0bed2854e76f90643097d',
          nonce: '0',
          expiry: '2000000000',
          allowed: true,
        },
      },
    },
  },
  {
    name: 'Unknown Function Calldata (Unknown)',
    type: 'transaction',
    description: 'Unverified selector 0x12345678 with unresolved execution effects.',
    payload: {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      value: '0',
      calldata: '0x123456780000000000000000000000000000000000000000000000000000000000000001',
    },
  },
  {
    name: 'Synthetic Demo Threat Vector (Demo Flagged)',
    type: 'transaction',
    description: 'Approval targeting synthetic demo spender (demoOnly: true).',
    isDemoThreat: true,
    payload: {
      type: 'transaction',
      chainId: 1,
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      value: '0',
      calldata:
        '0x095ea7b3000000000000000000000000deaddeaddeaddeaddeaddeaddeaddeaddead000100000000000000000000000000000000000000000000000000000000000f4240',
      includeDemo: true,
    },
  },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'transaction' | 'eip712' | 'personal_sign'>('transaction');
  const [requestJson, setRequestJson] = useState<string>(
    JSON.stringify(SAMPLE_PRESETS[0].payload, null, 2)
  );
  const [includeDemo, setIncludeDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);

  const handleSelectTab = (tab: 'transaction' | 'eip712' | 'personal_sign') => {
    setActiveTab(tab);
    setReport(null);
    setErrorMsg(null);

    if (tab === 'transaction') {
      setRequestJson(JSON.stringify(SAMPLE_PRESETS[0].payload, null, 2));
    } else if (tab === 'eip712') {
      setRequestJson(JSON.stringify(SAMPLE_PRESETS[1].payload, null, 2));
    } else {
      setRequestJson(
        JSON.stringify(
          {
            type: 'personal_sign',
            expectedSigner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            rawMessage: '0x48656c6c6f20576f726c64', // "Hello World"
            chainId: 1,
            domainOrOrigin: 'https://app.uniswap.org',
          },
          null,
          2
        )
      );
    }
  };

  const handleLoadPreset = (preset: SamplePreset) => {
    setActiveTab(preset.type);
    setRequestJson(JSON.stringify(preset.payload, null, 2));
    setIncludeDemo(Boolean(preset.isDemoThreat));
    setReport(null);
    setErrorMsg(null);
    setShowPresetsMenu(false);
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setErrorMsg(null);
    setReport(null);

    try {
      const parsedBody = JSON.parse(requestJson);
      if (includeDemo) {
        parsedBody.includeDemo = true;
      }

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedBody),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.message || data.error || 'Analysis failed');
      } else {
        setReport(data);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid JSON format in request payload');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cognitia-report-${report.requestId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasDemoFindings = Boolean(
    report?.findings.some((f) => f.title.includes('[DEMO ONLY]')) ||
    (report?.simulationResult as any)?.isDemo
  );

  return (
    <div className="container">
      <header>
        <div className="logo-row">
          <div className="title-badge">
            <h1 className="brand-title">Cognitia Risk Engine</h1>
            <span className="pill-tag">v1.0.0 Findings Engine</span>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button
              className="btn-secondary"
              onClick={() => setShowPresetsMenu(!showPresetsMenu)}
              aria-expanded={showPresetsMenu}
              aria-label="Toggle sample test vectors menu"
            >
              📂 Sample Vectors
            </button>
            <span className="pill-tag">Pinned Fork Snapshot Active</span>
          </div>
        </div>

        <p className="subtitle">
          Deterministic EVM calldata & signature analyzer. Evaluates spending authority, isolated state deltas, conditional permits, and severity-ranked findings.
        </p>

        {/* Global Metadata Bar */}
        <div className="meta-bar">
          <span><strong>Chain:</strong> Ethereum Mainnet (1)</span>
          <span>•</span>
          <span><strong>Analysis Snapshot:</strong> Pinned Block #21400000</span>
          {report && (
            <>
              <span>•</span>
              <span><strong>Analyzed At:</strong> {new Date(report.timestamp).toLocaleString()}</span>
            </>
          )}
        </div>
      </header>

      {/* Preset Vectors Dropdown (Behind Explicit Action) */}
      {showPresetsMenu && (
        <div className="presets-container" role="region" aria-label="Sample test vectors">
          <div style={{ width: '100%', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            Select a verified scenario or demo vector to load payload into editor:
          </div>
          {SAMPLE_PRESETS.map((p, idx) => (
            <button
              key={idx}
              className={`preset-btn ${p.isDemoThreat ? 'demo-action' : ''}`}
              onClick={() => handleLoadPreset(p)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Demo Warning Banner */}
      {hasDemoFindings && (
        <div className="demo-banner" role="alert">
          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          <div>
            <strong>DEMO ONLY RESULTS:</strong> One or more findings originate from synthetic test indicators flagged for sandbox testing. This does not represent an unlabeled production verdict.
          </div>
        </div>
      )}

      {/* Input Mode Tabs */}
      <div className="tabs" role="tablist" aria-label="Analysis input mode">
        <button
          role="tab"
          aria-selected={activeTab === 'transaction'}
          className={`tab-btn ${activeTab === 'transaction' ? 'active' : ''}`}
          onClick={() => handleSelectTab('transaction')}
        >
          Transaction Calldata
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'eip712'}
          className={`tab-btn ${activeTab === 'eip712' ? 'active' : ''}`}
          onClick={() => handleSelectTab('eip712')}
        >
          EIP-712 Typed Data
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'personal_sign'}
          className={`tab-btn ${activeTab === 'personal_sign' ? 'active' : ''}`}
          onClick={() => handleSelectTab('personal_sign')}
        >
          personal_sign Payload
        </button>
      </div>

      <div className="grid-layout">
        {/* Left Column: Request Input */}
        <div className="card">
          <div className="card-title">
            <span>Input Request</span>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeDemo}
                onChange={(e) => setIncludeDemo(e.target.checked)}
              />
              Enable Demo Dataset
            </label>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="request-json-input">
              AnalysisRequest JSON Payload
            </label>
            <textarea
              id="request-json-input"
              className="form-textarea"
              value={requestJson}
              onChange={(e) => setRequestJson(e.target.value)}
              spellCheck={false}
              aria-label="AnalysisRequest JSON input"
            />
          </div>

          <button
            className="btn-primary"
            onClick={handleAnalyze}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <div className="spinner" /> Analyzing on Isolated Fork...
              </>
            ) : (
              'Run Risk Analysis'
            )}
          </button>

          {errorMsg && (
            <div
              role="alert"
              style={{
                padding: '0.8rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '6px',
                color: '#f87171',
                fontSize: '0.85rem',
              }}
            >
              <strong>Error:</strong> {errorMsg}
            </div>
          )}
        </div>

        {/* Right Column: Findings & Comprehensive Output */}
        <div className="card">
          <div className="card-title">
            <span>Assessment Verdict</span>
            {report && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`severity-badge severity-${report.overallSeverity}`}>
                  {report.overallSeverity === 'low' ? 'Low observed risk' : report.overallSeverity} ({report.riskScore}/100)
                </span>
                <span className={`coverage-pill ${report.coverage.status}`}>
                  Coverage: {report.coverage.status}
                </span>
              </div>
            )}
          </div>

          {!report && !loading && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '4rem 1rem' }}>
              Select an input mode, customize payload if desired, and click <strong>Run Risk Analysis</strong> to inspect spending authority, state overrides, and severity-ranked findings.
            </div>
          )}

          {report && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Executive Plain-English Action Summary */}
              <div style={{ padding: '0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.9rem', lineHeight: '1.45' }}>
                <div className="form-label" style={{ marginBottom: '0.3rem' }}>Action Summary</div>
                <div>{report.summary}</div>
              </div>

              {/* Coverage Breakdown */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '0.6rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '100%', marginBottom: '0.2rem' }}>
                  Coverage Components (Independent of Severity):
                </div>
                <span className={`coverage-pill ${report.coverage.components.calldataDecoding}`}>
                  Calldata: {report.coverage.components.calldataDecoding}
                </span>
                <span className={`coverage-pill ${report.coverage.components.signatureAnalysis}`}>
                  Signatures: {report.coverage.components.signatureAnalysis}
                </span>
                <span className={`coverage-pill ${report.coverage.components.simulation}`}>
                  Simulation: {report.coverage.components.simulation}
                </span>
                <span className={`coverage-pill ${report.coverage.components.threatMatching}`}>
                  Threat Match: {report.coverage.components.threatMatching}
                </span>
              </div>

              {/* Spending Authority Panel (Who can spend what, how much, until when) */}
              <div className="spending-authority-card">
                <div className="form-label" style={{ color: 'var(--accent-blue)' }}>
                  Spending Authority Breakdown
                </div>
                <div className="spending-grid">
                  <div className="spending-item">
                    <span className="spending-label">Grantor / Owner:</span>
                    <span className="spending-val">
                      {report.decodedIntent.owner || report.decodedIntent.caller || 'Transaction Sender'}
                    </span>
                  </div>

                  <div className="spending-item">
                    <span className="spending-label">Authorized Spender:</span>
                    <span className="spending-val">
                      {report.decodedIntent.spenderOrOperator ||
                        report.decodedIntent.parameters?.find((p) => p.name === 'spender' || p.name === 'operator')?.value ||
                        'None (Direct Call)'}
                    </span>
                  </div>

                  <div className="spending-item">
                    <span className="spending-label">Asset / Target:</span>
                    <span className="spending-val">
                      {report.decodedIntent.targetContract || 'N/A'}
                    </span>
                  </div>

                  <div className="spending-item">
                    <span className="spending-label">Amount / Allowance:</span>
                    <span className="spending-val">
                      {(() => {
                        const amtParam = report.decodedIntent.parameters?.find(
                          (p) => p.name === 'amount' || p.name === 'value'
                        )?.value || report.decodedIntent.amount;

                        const token = report.decodedIntent.targetContract;
                        const formatted = formatTokenAmount(amtParam, token);
                        return (
                          <div>
                            <div><strong>{formatted.formatted}</strong></div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Raw: {formatted.raw}
                              {formatted.unverifiedNote && (
                                <span> ({formatted.unverifiedNote})</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </span>
                  </div>

                  <div className="spending-item">
                    <span className="spending-label">Expiration / Deadline:</span>
                    <span className="spending-val">
                      {(() => {
                        const deadline = report.decodedIntent.parameters?.find(
                          (p) => p.name === 'deadline' || p.name === 'expiry'
                        )?.value;
                        if (!deadline) return 'Perpetual / No Expiration';
                        try {
                          const date = new Date(Number(deadline) * 1000);
                          return `${date.toUTCString()} (Unix: ${deadline})`;
                        } catch {
                          return deadline;
                        }
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Conditional Permit Outcomes Panel (Clearly Separate Panel) */}
              {report.simulationResult?.conditionalLabel && (
                <div className="conditional-banner" role="region" aria-label="Conditional permit outcome">
                  <div className="conditional-title">
                    <span>⚡ {report.simulationResult.conditionalLabel}</span>
                  </div>
                  <div className="conditional-desc">
                    <strong>Notice:</strong> This simulation models hypothetical state changes if this unsigned permit is signed and confirmed on-chain. This is a modeled conditional outcome, NOT an observed transaction execution effect.
                  </div>
                  {report.simulationResult.assetDeltas.length > 0 && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <div className="spending-label" style={{ marginBottom: '0.2rem' }}>Modeled Balance Changes:</div>
                      <ul style={{ paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                        {report.simulationResult.assetDeltas.map((d, i) => (
                          <li key={i}>
                            Account {d.account}: {formatTokenAmount(d.amountDelta, d.token).formatted} (Raw: {d.amountDelta})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Actual Simulated Asset Movements (Where available for transactions) */}
              {report.simulationResult && !report.simulationResult.conditionalLabel && report.simulationResult.assetDeltas.length > 0 && (
                <div>
                  <div className="form-label" style={{ marginBottom: '0.4rem' }}>
                    Observed State Delatas (Isolated Simulation)
                  </div>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Token</th>
                          <th>Balance Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.simulationResult.assetDeltas.map((delta, i) => {
                          const isPos = BigInt(delta.amountDelta) > 0n;
                          const fmt = formatTokenAmount(delta.amountDelta, delta.token);
                          return (
                            <tr key={i}>
                              <td style={{ fontFamily: 'monospace' }}>{delta.account}</td>
                              <td style={{ fontFamily: 'monospace' }}>{delta.token}</td>
                              <td className={isPos ? 'delta-positive' : 'delta-negative'}>
                                {isPos ? `+${fmt.formatted}` : fmt.formatted}
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  Raw: {delta.amountDelta}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Severity-Ranked Findings Deck */}
              <div>
                <div className="form-label" style={{ marginBottom: '0.5rem' }}>
                  Ranked Findings ({report.findings.length})
                </div>
                <div className="findings-list">
                  {report.findings.map((finding) => (
                    <div key={finding.id} className={`finding-item ${finding.severity}`}>
                      <div className="finding-header">
                        <span className="finding-title">{finding.title}</span>
                        <span className={`severity-badge severity-${finding.severity}`}>
                          {finding.severity}
                        </span>
                      </div>
                      <p className="finding-explanation">{finding.plainEnglishExplanation}</p>

                      <div className="finding-meta">
                        <span><strong>Confidence:</strong> {finding.confidence.level} ({finding.confidence.reason})</span>
                        <span>•</span>
                        <span><strong>Context:</strong> {finding.executionContext}</span>
                      </div>

                      {/* Evidence References & Sources */}
                      {finding.evidenceIds.length > 0 && (
                        <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <span className="spending-label">Concrete Evidence References:</span>
                          {finding.evidenceIds.map((evId) => {
                            const ev = report.evidence[evId];
                            if (!ev) return null;
                            const raw = ev.rawSupportingData as Record<string, unknown>;
                            return (
                              <div key={evId} className="evidence-block">
                                <div className="evidence-header">
                                  <span>Type: <code>{ev.type}</code></span>
                                  {Boolean(raw?.entityRole) && (
                                    <span className="role-tag">Role: {String(raw.entityRole)}</span>
                                  )}
                                </div>
                                <div><strong>Provenance:</strong> {ev.provenance}</div>
                                {Boolean(raw?.sourceUrl) && (
                                  <div>
                                    <strong>Source Link:</strong>{' '}
                                    <a
                                      href={String(raw.sourceUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: '#60a5fa', textDecoration: 'underline' }}
                                    >
                                      {String(raw.sourceUrl)}
                                    </a>
                                  </div>
                                )}
                                {Boolean(raw?.matchDisclaimers) && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {String(raw.matchDisclaimers)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {finding.remediation && (
                        <div style={{ fontSize: '0.8rem', color: '#facc15', background: 'rgba(234, 179, 8, 0.08)', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                          <strong>Remediation:</strong> {finding.remediation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Unknowns, Unsupported Adapters & Simulation Assumptions */}
              <div style={{ padding: '0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div className="form-label" style={{ marginBottom: '0.4rem' }}>
                  Unknowns & Simulation Assumptions
                </div>
                {(report.decodedIntent.unresolvedQuestions?.length ?? 0) > 0 ? (
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {report.decodedIntent.unresolvedQuestions?.map((q, idx) => (
                      <li key={idx}>{q}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    No unresolved decoding questions.
                  </div>
                )}
                {report.simulationResult?.assumptions && report.simulationResult.assumptions.length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <strong>Assumptions:</strong> {report.simulationResult.assumptions.join(' • ')}
                  </div>
                )}
              </div>

              {/* Download JSON Report & Raw Input */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                <button className="btn-secondary" onClick={handleDownloadReport}>
                  📥 Download Report (.json)
                </button>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Request ID: <code>{report.requestId}</code>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
