import React, { useState } from 'react';
import { PendingRequestSnapshot } from '../../shared/types';
import { Icon } from './Icon';
import { StatusScreen } from './StatusScreen';

interface AnalysisUnavailableProps {
  snapshot: PendingRequestSnapshot | null;
  errorMessage?: string;
  onContinue: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

/**
 * The backend failed or timed out. This screen is never green, never forwards on
 * its own, and only enables Continue after an explicit acknowledgement.
 */
export const AnalysisUnavailable: React.FC<AnalysisUnavailableProps> = ({
  snapshot,
  errorMessage,
  onContinue,
  onReject,
}) => {
  const [acknowledgedRisk, setAcknowledgedRisk] = useState(false);
  const [pending, setPending] = useState<'continue' | 'reject' | null>(null);
  const isProcessing = pending !== null;

  const handleReject = () => {
    if (!snapshot || isProcessing) return;
    setPending('reject');
    onReject(snapshot.requestId);
  };

  const handleContinue = () => {
    if (!snapshot || !acknowledgedRisk || isProcessing) return;
    setPending('continue');
    onContinue(snapshot.requestId);
  };

  return (
    <StatusScreen
      tone="warning"
      icon="alert"
      title="Analysis unavailable"
      description="This request could not be verified. There is no safety result, so treat it as unknown."
      notice={
        <>
          <div className="callout" data-tone="warning">
            <Icon name="alert" size={16} />
            <div>
              <strong>Unverified transaction</strong>
              Backend inspection failed or timed out. Nothing about what this request does is known.
            </div>
          </div>
          {errorMessage && (
            <div className="callout" data-tone="neutral">
              <Icon name="info" size={16} />
              <div>
                <strong>Details</strong>
                {errorMessage}
              </div>
            </div>
          )}
        </>
      }
      facts={
        snapshot
          ? [
              { label: 'Method', value: snapshot.method, mono: true },
              { label: 'Origin', value: snapshot.origin, mono: true },
            ]
          : undefined
      }
      footnote="Never automatically forwards requests after an analysis failure."
    >
      <label className="check" data-checked={acknowledgedRisk ? 'true' : 'false'}>
        <input
          type="checkbox"
          checked={acknowledgedRisk}
          onChange={(e) => setAcknowledgedRisk(e.target.checked)}
        />
        <span>I understand this request was not analyzed and may drain or transfer assets.</span>
      </label>

      <div className="actions-row">
        <button type="button" className="btn btn-danger" onClick={handleReject} disabled={isProcessing}>
          <Icon name="x" size={15} />
          {pending === 'reject' ? 'Rejecting' : 'Reject'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleContinue}
          disabled={!acknowledgedRisk || isProcessing}
        >
          {pending === 'continue' ? 'Opening MetaMask' : 'Continue to MetaMask'}
          <span className="btn-icon">
            <Icon name="arrow" size={13} />
          </span>
        </button>
      </div>
      <div style={{ marginTop: '10px', width: '100%' }}>
        <button
          type="button"
          id="btn-detailed-analysis-unavail"
          className="btn btn-ghost"
          style={{
            width: '100%',
            justifyContent: 'center',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            padding: '8px 12px',
            border: '1px solid var(--line-2, #ccc)',
            borderRadius: '6px',
            background: 'var(--surface, #fff)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
          onClick={() => {
            try {
              const url = new URL('http://localhost:3000/analysis.html');
              url.searchParams.set('requestId', snapshot?.requestId || '');
              url.searchParams.set('severity', 'high');
              url.searchParams.set('method', snapshot?.method || '');
              url.searchParams.set('origin', snapshot?.origin || '');
              url.searchParams.set('account', snapshot?.account || '');
              if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                chrome.tabs.create({ url: url.toString() });
              } else {
                window.open(url.toString(), '_blank');
              }
            } catch (err) {
              console.error('[Sidepanel] Failed to open detailed analysis page:', err);
            }
          }}
        >
          <span>Detailed Analysis</span>
          <Icon name="arrow" size={13} />
        </button>
      </div>
      <p className="footnote">Continue proceeds without any security analysis.</p>
    </StatusScreen>
  );
};
