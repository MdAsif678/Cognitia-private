import React, { useState } from 'react';
import { PendingRequestSnapshot } from '../../shared/types';
import { Icon } from './Icon';
import { StatusScreen } from './StatusScreen';

interface StaleReportProps {
  snapshot: PendingRequestSnapshot | null;
  onReject: (requestId: string) => void;
  onReset: () => void;
}

/** The account or chain changed mid-analysis, so the report no longer describes this request. */
export const StaleReport: React.FC<StaleReportProps> = ({ snapshot, onReject, onReset }) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleReject = () => {
    if (!snapshot || isProcessing) return;
    setIsProcessing(true);
    onReject(snapshot.requestId);
  };

  return (
    <StatusScreen
      tone="warning"
      icon="alert"
      title="Request changed"
      description="The account or network changed while this request was being analyzed."
      notice={
        <div className="callout" data-tone="warning">
          <Icon name="info" size={16} />
          <div>
            <strong>Analysis invalidated</strong>
            Results for a different account or network cannot be reused. Doing so could approve something you
            never reviewed.
          </div>
        </div>
      }
      facts={
        snapshot
          ? [
              { label: 'Original method', value: snapshot.method, mono: true },
              { label: 'Origin', value: snapshot.origin, mono: true },
            ]
          : undefined
      }
      footnote="Start the transaction again from the dapp to run a fresh analysis."
    >
      <div className="actions-row">
        <button type="button" className="btn btn-danger" onClick={handleReject} disabled={isProcessing}>
          <Icon name="x" size={15} />
          {isProcessing ? 'Rejecting' : 'Reject request'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={isProcessing}>
          Dismiss
        </button>
      </div>
    </StatusScreen>
  );
};
