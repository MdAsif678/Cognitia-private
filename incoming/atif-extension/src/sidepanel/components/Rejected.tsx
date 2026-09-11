import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';
import { Fact, StatusScreen } from './StatusScreen';

interface RejectedProps {
  snapshot: PendingRequestSnapshot | null;
  reason?: string;
  onReset: () => void;
}

/** The user chose Reject: the site got EIP-1193 error 4001 and the wallet was never involved. */
export const Rejected: React.FC<RejectedProps> = ({ snapshot, reason, onReset }) => {
  const facts: Fact[] = [{ label: 'Status', value: 'EIP-1193 4001', mono: true }];
  if (reason) facts.push({ label: 'Reason', value: reason });
  if (snapshot) facts.push({ label: 'Method', value: snapshot.method, mono: true });

  return (
    <StatusScreen
      tone="neutral"
      icon="x"
      title="Request rejected"
      description="MetaMask was never opened. The site received EIP-1193 error 4001 (user rejected)."
      facts={facts}
    >
      <div className="actions-inline">
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Back to standby
        </button>
      </div>
    </StatusScreen>
  );
};
