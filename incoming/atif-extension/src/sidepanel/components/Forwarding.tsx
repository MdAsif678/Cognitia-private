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
    title="Opening MetaMask"
    description="The exact original request is being forwarded. Review and sign it inside MetaMask."
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
        If the MetaMask popup does not appear, click the MetaMask icon in the browser toolbar.
      </>
    }
  />
);
