import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';
import { Icon } from './Icon';
import { StatusScreen } from './StatusScreen';

interface ForwardingProps {
  snapshot: PendingRequestSnapshot | null;
}

/** The user chose Continue: the untouched request is now with the wallet. */
export const Forwarding: React.FC<ForwardingProps> = ({ snapshot }) => (
  <StatusScreen
    tone="info"
    icon="wallet"
    busy
    title="Open your wallet"
    description="The reviewed request has been released to your selected wallet. Your wallet still requires confirmation."
    facts={
      snapshot
        ? [
            { label: 'Method', value: snapshot.method, mono: true },
            { label: 'Provider', value: snapshot.providerInfo.name },
            { label: 'Parameters', value: 'Unmodified, exact match' },
          ]
        : undefined
    }
    footnote={
      <>
        <Icon name="info" size={12} />
        If the wallet prompt does not appear, open your wallet from the browser toolbar.
      </>
    }
  />
);
