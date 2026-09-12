import React, { useEffect, useRef, useState } from 'react';
import {
  PendingRequestSnapshot,
  RequestStatus,
  BackgroundToSidepanelMessage,
  SidepanelAction,
} from '../shared/types';
import { ARCHITECTURAL_LIMITATION_DISCLAIMER } from '../shared/constants';
import { Icon } from './components/Icon';
import { Loading } from './components/Loading';
import { RiskReport } from './components/RiskReport';
import { AnalysisUnavailable } from './components/AnalysisUnavailable';
import { StaleReport } from './components/StaleReport';
import { Rejected } from './components/Rejected';
import { Forwarding } from './components/Forwarding';
import { Failed } from './components/Failed';
import { LogView } from './components/LogView';
import './styles.css';

const SUPPORTED_METHODS = ['eth_sendTransaction', 'eth_signTypedData_v4', 'personal_sign'];

export const App: React.FC = () => {
  const [activeRequest, setActiveRequest] = useState<PendingRequestSnapshot | null>(null);
  const [status, setStatus] = useState<RequestStatus>('IDLE');
  const [statusError, setStatusError] = useState<string | undefined>();
  const view = useRef<HTMLElement>(null);
  useEffect(() => { view.current?.scrollTo(0, 0); }, [activeRequest?.requestId, status]);
  // The log replaces the live view in place; the interception flow underneath is untouched.
  const [showLog, setShowLog] = useState(false);
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
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="shield" size={16} />
          </span>
          <div>
            <h1 className="brand-name">Cognitia<sup>®</sup></h1>
            <div className="brand-sub">Wallet protection</div>
          </div>
        </div>
        <div className="topbar-end">
          <div className="live" data-mode="live" role="status">
            <span className="live-dot" aria-hidden="true" />
            {['INTERCEPTED', 'ANALYZING'].includes(status) ? 'Analyzing' : status === 'ANALYSIS_READY' ? 'Review' : 'Active'}
          </div>
          <button
            type="button"
            className="log-toggle"
            aria-pressed={showLog}
            aria-label={showLog ? 'Close the request log' : 'Open the request log'}
            onClick={() => setShowLog((open) => !open)}
          >
            <Icon name={showLog ? 'x' : 'list'} size={13} />
            <span>Log</span>
          </button>
        </div>
      </header>

      <main className="view" ref={view}>
        {showLog && <LogView />}

        {!showLog && status === 'IDLE' && (
          <section className="idle enter">
            <span className="idle-mark">
              <Icon name="lock" size={20} />
            </span>
            <h2>Know before<br />you sign.</h2>
            <p>
              Connect your wallet on a dapp, then make a request. Cognitia holds it, simulates its effects, and brings the risk report here before wallet confirmation.
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
                <span>What protection covers</span>
                <Icon name="chevron" size={14} className="chev" />
              </summary>
              <p className="notice-text">{ARCHITECTURAL_LIMITATION_DISCLAIMER}</p>
            </details>
          </section>
        )}

        {!showLog && (status === 'INTERCEPTED' || status === 'ANALYZING') && (
          <Loading snapshot={activeRequest} />
        )}

        {!showLog && status === 'ANALYSIS_READY' && activeRequest && (
          <RiskReport
            key={activeRequest.requestId}
            snapshot={activeRequest}
            analysis={activeRequest.analysis}
            report={activeRequest.analysis?.report}
            onContinue={handleContinue}
            onReject={handleReject}
          />
        )}

        {!showLog && status === 'ANALYSIS_UNAVAILABLE' && (
          <AnalysisUnavailable
            snapshot={activeRequest}
            errorMessage={statusError}
            onContinue={handleContinue}
            onReject={handleReject}
          />
        )}

        {!showLog && status === 'STALE' && (
          <StaleReport snapshot={activeRequest} onReject={handleReject} onReset={handleReset} />
        )}

        {!showLog && status === 'REJECTED' && (
          <Rejected snapshot={activeRequest} reason={statusError} onReset={handleReset} />
        )}

        {!showLog && (status === 'FORWARDING' || status === 'COMPLETED') && (
          <Forwarding snapshot={activeRequest} />
        )}

        {!showLog && status === 'FAILED' && (
          <Failed snapshot={activeRequest} error={statusError} onReset={handleReset} />
        )}
      </main>
    </div>
  );
};
