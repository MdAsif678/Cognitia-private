import React, { useEffect, useState } from 'react';
import {
  PendingRequestSnapshot,
  RequestStatus,
  BackgroundToSidepanelMessage,
  SidepanelAction,
} from '../shared/types';
import { ARCHITECTURAL_LIMITATION_DISCLAIMER } from '../shared/constants';
import { ALL_FIXTURES } from '../shared/fixtures';
import { Loading } from './components/Loading';
import { RiskReport } from './components/RiskReport';
import { AnalysisUnavailable } from './components/AnalysisUnavailable';
import { StaleReport } from './components/StaleReport';
import { Rejected } from './components/Rejected';
import { Forwarding } from './components/Forwarding';
import { Failed } from './components/Failed';

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

  return (
    <div style={appContainerStyle}>
      {/* Top Header / Security Status Bar */}
      <header style={headerStyle}>
        <div style={logoGroupStyle}>
          <div style={shieldBadgeStyle}>🛡️</div>
          <div>
            <h1 style={titleStyle}>Pre-Execution Interceptor</h1>
            <span style={subtitleStyle}>Transaction & Signature Simulator</span>
          </div>
        </div>
        <div style={pulseStatusStyle}>
          <span style={greenDotStyle} />
          <span style={statusTextStyle}>{fixtureKey === 'live' ? 'Armed' : 'Fixture Preview'}</span>
        </div>
      </header>

      {/* Visual Verification Toolbar */}
      <div style={fixtureToolbarStyle}>
        <span style={fixtureToolbarLabelStyle}>FIXTURE PREVIEW:</span>
        <select
          id="fixture-selector"
          value={fixtureKey}
          onChange={(e) => handleSelectFixture(e.target.value)}
          style={fixtureSelectStyle}
        >
          <option value="live">⚡ Live Interceptor (Waiting for DApp)</option>
          <option value="benign">1. Benign Transfer (0.05 ETH)</option>
          <option value="nftApproval">2. NFT setApprovalForAll (BAYC)</option>
          <option value="unlimitedErc20">3. Unlimited ERC20 Approval (USDC)</option>
          <option value="reverted">4. Reverted Transaction</option>
          <option value="conditionalPermit">5. Conditional Permit (EIP-712)</option>
          <option value="failedAnalysis">6. Failed Analysis (Unverified)</option>
        </select>
      </div>

      {/* Main View Switcher */}
      <main style={mainContentStyle}>
        {/* State: IDLE */}
        {status === 'IDLE' && (
          <div style={idleContainerStyle}>
            <div style={idleIconStyle}>⚡</div>
            <h2 style={idleHeadingStyle}>Listening for Transactions</h2>
            <p style={idleDescStyle}>
              Supported calls (<code style={inlineCodeStyle}>eth_sendTransaction</code>,{' '}
              <code style={inlineCodeStyle}>eth_signTypedData_v4</code>,{' '}
              <code style={inlineCodeStyle}>personal_sign</code>) are intercepted in the browser page context before MetaMask opens.
            </p>

            <div style={disclaimerCardStyle}>
              <h4 style={disclaimerTitleStyle}>Prototype Scope Notice</h4>
              <p style={disclaimerTextStyle}>{ARCHITECTURAL_LIMITATION_DISCLAIMER}</p>
            </div>
          </div>
        )}

        {/* State 1: LOADING */}
        {(status === 'INTERCEPTED' || status === 'ANALYZING') && (
          <Loading snapshot={activeRequest} />
        )}

        {/* State 2: RISK REPORT */}
        {status === 'ANALYSIS_READY' && activeRequest && (
          <RiskReport
            snapshot={activeRequest}
            analysis={activeRequest.analysis}
            report={activeRequest.analysis?.report}
            onContinue={handleContinue}
            onReject={handleReject}
          />
        )}

        {/* State 3: ANALYSIS UNAVAILABLE */}
        {status === 'ANALYSIS_UNAVAILABLE' && (
          <AnalysisUnavailable
            snapshot={activeRequest}
            errorMessage={statusError}
            onContinue={handleContinue}
            onReject={handleReject}
          />
        )}

        {/* State 4: STALE REPORT */}
        {status === 'STALE' && (
          <StaleReport snapshot={activeRequest} onReject={handleReject} onReset={handleReset} />
        )}

        {/* State 5: REJECTED */}
        {status === 'REJECTED' && (
          <Rejected snapshot={activeRequest} reason={statusError} onReset={handleReset} />
        )}

        {/* State 6: FORWARDING */}
        {(status === 'FORWARDING' || status === 'COMPLETED') && (
          <Forwarding snapshot={activeRequest} />
        )}

        {/* State 7: FAILED */}
        {status === 'FAILED' && (
          <Failed snapshot={activeRequest} error={statusError} onReset={handleReset} />
        )}
      </main>
    </div>
  );
};

const appContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  backgroundColor: '#0b0f19',
  color: '#f1f5f9',
  fontFamily: 'Outfit, -apple-system, BlinkMacSystemFont, sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 16px',
  backgroundColor: '#0f172a',
  borderBottom: '1px solid #1e293b',
};

const logoGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const shieldBadgeStyle: React.CSSProperties = {
  fontSize: '20px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#f8fafc',
  letterSpacing: '-0.2px',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#94a3b8',
  display: 'block',
};

const pulseStatusStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  backgroundColor: 'rgba(34, 197, 94, 0.1)',
  padding: '4px 8px',
  borderRadius: '12px',
  border: '1px solid rgba(34, 197, 94, 0.2)',
};

const greenDotStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  backgroundColor: '#22c55e',
};

const statusTextStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#4ade80',
};

const mainContentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
};

const idleContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '40px 16px',
  textAlign: 'center',
};

const idleIconStyle: React.CSSProperties = {
  fontSize: '36px',
  marginBottom: '16px',
  opacity: 0.8,
};

const idleHeadingStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#f8fafc',
  marginBottom: '8px',
  letterSpacing: '-0.3px',
};

const idleDescStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  lineHeight: 1.5,
  maxWidth: '320px',
  marginBottom: '24px',
};

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  backgroundColor: '#1e293b',
  color: '#cbd5e1',
  padding: '2px 4px',
  borderRadius: '4px',
};

const disclaimerCardStyle: React.CSSProperties = {
  backgroundColor: '#131b2e',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '14px',
  textAlign: 'left',
  width: '100%',
};

const disclaimerTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#f59e0b',
  textTransform: 'uppercase',
  marginBottom: '6px',
};

const disclaimerTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  lineHeight: 1.4,
  whiteSpace: 'pre-line',
};

const fixtureToolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '8px 16px',
  background: '#090d16',
  borderBottom: '1px solid #1e293b',
};

const fixtureToolbarLabelStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  color: '#6366f1',
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap',
};

const fixtureSelectStyle: React.CSSProperties = {
  flex: 1,
  background: '#131b2e',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: '6px',
  padding: '4px 8px',
  fontSize: '11px',
  fontFamily: 'Outfit, sans-serif',
  cursor: 'pointer',
  outline: 'none',
};

