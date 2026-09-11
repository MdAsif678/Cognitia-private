import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';
import { Icon } from './Icon';
import { Fact, StatusScreen } from './StatusScreen';

interface LoadingProps {
  snapshot: PendingRequestSnapshot | null;
}

const shortAccount = (account: string) => `${account.slice(0, 6)}...${account.slice(-4)}`;

/** Analysis in flight: a skeleton shaped like the report that is about to replace it. */
export const Loading: React.FC<LoadingProps> = ({ snapshot }) => {
  const facts: Fact[] = [];
  if (snapshot) {
    facts.push({ label: 'Method', value: snapshot.method, mono: true });
    if (snapshot.chainId) facts.push({ label: 'Network', value: snapshot.chainId, mono: true });
    if (snapshot.account) {
      facts.push({
        label: 'Account',
        value: <span title={snapshot.account}>{shortAccount(snapshot.account)}</span>,
        mono: true,
      });
    }
    facts.push({ label: 'Origin', value: snapshot.origin, mono: true });
  }

  return (
    <StatusScreen
      tone="neutral"
      icon="clock"
      busy
      title="Checking transaction"
      description="Simulating this request on a forked chain before MetaMask opens."
      notice={
        <div className="skeleton" aria-hidden="true">
          <div className="sk sk--label" />
          <div className="sk sk--title" />
          <div className="sk sk--line" />
          <div className="sk sk--line short" />
          <div className="sk-rows">
            <div className="sk sk--row" />
            <div className="sk sk--row" />
            <div className="sk sk--row" />
          </div>
        </div>
      }
      facts={facts}
      footnote={
        <>
          <Icon name="lock" size={12} />
          Held in memory. MetaMask is not called without your approval.
        </>
      }
    />
  );
};
