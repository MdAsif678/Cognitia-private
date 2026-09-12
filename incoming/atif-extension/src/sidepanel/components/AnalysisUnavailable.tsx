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
          {pending === 'continue' ? 'Opening wallet' : 'Continue to wallet'}
          <span className="btn-icon">
            <Icon name="arrow" size={13} />
          </span>
        </button>
      </div>
      <p className="footnote">Continue proceeds without any security analysis.</p>
    </StatusScreen>
  );
};
