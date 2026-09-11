import React, { useEffect, useState } from 'react';
import {
  PendingRequestSnapshot,
  RequestStatus,
  BackgroundToSidepanelMessage,
  SidepanelAction,
} from '../shared/types';
import { ARCHITECTURAL_LIMITATION_DISCLAIMER } from '../shared/constants';
import { ALL_FIXTURES } from '../shared/fixtures';
import { Icon } from './components/Icon';
import { Loading } from './components/Loading';
import { RiskReport } from './components/RiskReport';
import { AnalysisUnavailable } from './components/AnalysisUnavailable';
import { StaleReport } from './components/StaleReport';
import { Rejected } from './components/Rejected';
import { Forwarding } from './components/Forwarding';
import { Failed } from './components/Failed';
import './styles.css';

/** Developer preview entries. "live" is the real interceptor. */
const FIXTURE_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'live', label: 'Live interceptor (waiting for a dapp)' },
  { key: 'benign', label: '1. Benign transfer (0.05 ETH)' },
  { key: 'nftApproval', label: '2. NFT setApprovalForAll (BAYC)' },
  { key: 'unlimitedErc20', label: '3. Unlimited ERC-20 approval (USDC)' },
  { key: 'reverted', label: '4. Reverted transaction' },
  { key: 'conditionalPermit', label: '5. Conditional permit (EIP-712)' },
  { key: 'failedAnalysis', label: '6. Failed analysis (unverified)' },
];

const SUPPORTED_METHODS = ['eth_sendTransaction', 'eth_signTypedData_v4', 'personal_sign'];

export const App: React.FC = () => {
  const [activeRequest, setActiveRequest] = useState<PendingRequestSnapshot | null>(null);
  const [status, setStatus] = useState<RequestStatus>('IDLE');
  const [statusError, setStatusError] = useState<string | undefined>();
  const [fixtureKey, setFixtureKey] = useState<string>('live');

  // Hydrate active request from service worker on mount
  useEffect(() => {
    const fetchActive = async () => {
      const getMsg: SidepanelAction = { type: 'GET_ACTIVE_REQUEST' };
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage(getMsg, (response: { snapshot: PendingRequestSnapshot | null }) => {
            if (response?.snapshot) {
              setActiveRequest(response.snapshot);
              setStatus(response.snapshot.status);
              setStatusError(response.snapshot.error);
            }
          });
        }
      } catch (err) {
        console.warn('[SidePanel] Failed to retrieve active request:', err);
      }
    };

    fetchActive();

    // Listen for real-time status updates broadcasted by the service worker
    const messageListener = (message: BackgroundToSidepanelMessage) => {
      if (message.type === 'REQUEST_STATUS_UPDATED') {
        setStatus(message.status);
        setStatusError(message.error);
        setActiveRequest((prev) => {
          if (!prev || prev.requestId !== message.requestId) {
            // A request intercepted after the panel opened (or a newer one): load its snapshot,
            // otherwise ANALYSIS_READY has nothing to render.
            fetchActive();
            return prev;
          }
          return {
            ...prev,
            status: message.status,
            analysis: message.analysis ?? prev.analysis,
            error: message.error ?? prev.error,
          };
        });
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener);
      };
    }
  }, []);

  const handleContinue = (requestId: string) => {
    // Send exactly one USER_CLICK_CONTINUE decision
    const action: SidepanelAction = {
      type: 'USER_CLICK_CONTINUE',
      requestId,
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(action);
    }
    setStatus('FORWARDING');
  };

  const handleReject = (requestId: string, reason?: string) => {
    // Reject request with error code 4001
    const action: SidepanelAction = {
      type: 'USER_CLICK_REJECT',
      requestId,
      reason,
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(action);
    }
    setStatus('REJECTED');
  };

  const handleReset = () => {
    setActiveRequest(null);
    setStatus('IDLE');
    setStatusError(undefined);
    setFixtureKey('live');
  };

  const handleSelectFixture = (key: string) => {
    setFixtureKey(key);
    if (key === 'live') {
      handleReset();
    } else if (ALL_FIXTURES[key]) {
      const fix = ALL_FIXTURES[key];
      setActiveRequest(fix.snapshot);
      setStatus('ANALYSIS_READY');
      setStatusError(undefined);
    }
  };

  const isLive = fixtureKey === 'live';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="shield" size={16} />
          </span>
          <div>
            <h1 className="brand-name">Cognitia®</h1>
            <div className="brand-sub">Interceptor</div>
          </div>
        </div>
        <div className="live" data-mode={isLive ? 'live' : 'preview'} role="status">
          <span className="live-dot" aria-hidden="true" />
          {isLive ? 'Armed' : 'Preview'}
        </div>
      </header>

      {/* Developer preview of the six reference reports */}
      <div className="devbar">
        <label className="devbar-label" htmlFor="fixture-selector">
          Preview
        </label>
        <select
          id="fixture-selector"
          className="select"
          value={fixtureKey}
          onChange={(e) => handleSelectFixture(e.target.value)}
        >
          {FIXTURE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <main className="view">
        {status === 'IDLE' && (
          <section className="idle enter">
            <span className="idle-mark">
              <Icon name="lock" size={20} />
            </span>
            <h2>Listening for transactions</h2>
            <p>
              Signing requests are held in the page before MetaMask opens, simulated on a forked chain, and shown
              here with their real effects.
            </p>
            <div className="tags">
              {SUPPORTED_METHODS.map((method) => (
                <code key={method} className="pill">
                  {method}
                </code>
              ))}
            </div>
            <details className="disclosure disclosure--inline">
              <summary>
                <span>Prototype scope notice</span>
                <Icon name="chevron" size={14} className="chev" />
              </summary>
              <p className="notice-text">{ARCHITECTURAL_LIMITATION_DISCLAIMER}</p>
            </details>
          </section>
        )}

        {(status === 'INTERCEPTED' || status === 'ANALYZING') && <Loading snapshot={activeRequest} />}

        {status === 'ANALYSIS_READY' && activeRequest && (
          <RiskReport
            key={activeRequest.requestId}
            snapshot={activeRequest}
            analysis={activeRequest.analysis}
            report={activeRequest.analysis?.report}
            onContinue={handleContinue}
            onReject={handleReject}
          />
        )}

        {status === 'ANALYSIS_UNAVAILABLE' && (
          <AnalysisUnavailable
            snapshot={activeRequest}
            errorMessage={statusError}
            onContinue={handleContinue}
            onReject={handleReject}
          />
        )}

        {status === 'STALE' && (
          <StaleReport snapshot={activeRequest} onReject={handleReject} onReset={handleReset} />
        )}

        {status === 'REJECTED' && <Rejected snapshot={activeRequest} reason={statusError} onReset={handleReset} />}

        {(status === 'FORWARDING' || status === 'COMPLETED') && <Forwarding snapshot={activeRequest} />}

        {status === 'FAILED' && <Failed snapshot={activeRequest} error={statusError} onReset={handleReset} />}
      </main>
    </div>
  );
};
