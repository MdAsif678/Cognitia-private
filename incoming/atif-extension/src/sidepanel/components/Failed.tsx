import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';
import { Icon } from './Icon';
import { StatusScreen } from './StatusScreen';

interface FailedProps {
  snapshot: PendingRequestSnapshot | null;
  error?: string;
  onReset: () => void;
}

/** The wallet or the network errored after the request was forwarded. */
export const Failed: React.FC<FailedProps> = ({ snapshot, error, onReset }) => (
  <StatusScreen
    tone="danger"
    icon="alert"
    title="Wallet request failed"
    description="MetaMask or the network returned an error after the request was forwarded."
    notice={
      <div className="callout" data-tone="danger">
        <Icon name="alert" size={16} />
        <div>
          <strong>Provider error</strong>
          <pre className="code">{error ?? 'Unknown provider failure or execution revert.'}</pre>
        </div>
      </div>
    }
    facts={
      snapshot
        ? [
            { label: 'Attempted method', value: snapshot.method, mono: true },
            { label: 'Provider', value: snapshot.providerInfo.name },
          ]
        : undefined
    }
  >
    <div className="actions-inline">
      <button type="button" className="btn btn-ghost" onClick={onReset}>
        Back to standby
      </button>
    </div>
  </StatusScreen>
);
