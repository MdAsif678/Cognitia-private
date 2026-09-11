import React, { useState } from 'react';
import { PendingRequestSnapshot } from '../../shared/types';

interface AnalysisUnavailableProps {
  snapshot: PendingRequestSnapshot | null;
  errorMessage?: string;
  onContinue: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export const AnalysisUnavailable: React.FC<AnalysisUnavailableProps> = ({
  snapshot,
  errorMessage,
  onContinue,
  onReject,
}) => {
  const [acknowledgedRisk, setAcknowledgedRisk] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleReject = () => {
    if (!snapshot || isProcessing) return;
    setIsProcessing(true);
    onReject(snapshot.requestId);
  };

  const handleContinue = () => {
    if (!snapshot || !acknowledgedRisk || isProcessing) return;
    setIsProcessing(true);
    onContinue(snapshot.requestId);
  };

  return (
    <div style={containerStyle}>
      {/* Warning Status Banner (Never Green) */}
      <div style={alertBannerStyle}>
        <span style={alertIconStyle}>⚠️</span>
        <div style={alertTextGroupStyle}>
          <span style={alertBadgeStyle}>UNVERIFIED TRANSACTION</span>
          <span style={alertSubtextStyle}>Backend inspection failed or timed out</span>
        </div>
      </div>

      <h2 style={titleStyle}>Analysis unavailable</h2>

      <p style={descriptionStyle}>
        We couldn't verify this request. No safety result is available.
      </p>

      {errorMessage && (
        <div style={errorBoxStyle}>
          <span style={errorLabelStyle}>Details:</span> {errorMessage}
        </div>
      )}

      {/* Request Details */}
      {snapshot && (
        <div style={detailsCardStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>Method:</span>
            <code style={methodStyle}>{snapshot.method}</code>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Origin:</span>
            <span style={valueStyle}>{snapshot.origin}</span>
          </div>
        </div>
      )}

      {/* Explicit User Acknowledgment */}
      <div style={checkboxContainerStyle}>
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={acknowledgedRisk}
            onChange={(e) => setAcknowledgedRisk(e.target.checked)}
            style={checkboxStyle}
          />
          <span>I understand that this request was not analyzed and may execute malicious drain or transfer operations.</span>
        </label>
      </div>

      {/* Primary Actions */}
      <div style={actionsStyle}>
        <button
          type="button"
          onClick={handleReject}
          disabled={isProcessing}
          style={{
            ...rejectBtnStyle,
            opacity: isProcessing ? 0.6 : 1,
            cursor: isProcessing ? 'not-allowed' : 'pointer',
          }}
        >
          {isProcessing ? 'Processing...' : 'Reject'}
        </button>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!acknowledgedRisk || isProcessing}
          style={{
            ...continueBtnStyle,
            opacity: !acknowledgedRisk || isProcessing ? 0.4 : 1,
            cursor: !acknowledgedRisk || isProcessing ? 'not-allowed' : 'pointer',
          }}
        >
          <div style={continueTextGroupStyle}>
            <span>{isProcessing ? 'Opening MetaMask...' : 'Continue to MetaMask →'}</span>
            <span style={continueSubtextStyle}>Proceed without security analysis</span>
          </div>
        </button>
      </div>

      <div style={footerNoticeStyle}>
        Never automatically forwards requests after an analysis failure.
      </div>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '20px 16px',
  gap: '14px',
};

const alertBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  backgroundColor: 'rgba(239, 68, 68, 0.15)',
  border: '1px solid #ef4444',
  padding: '14px',
  borderRadius: '10px',
};

const alertIconStyle: React.CSSProperties = {
  fontSize: '24px',
};

const alertTextGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const alertBadgeStyle: React.CSSProperties = {
  color: '#ef4444',
  fontWeight: 800,
  fontSize: '12px',
  letterSpacing: '0.5px',
};

const alertSubtextStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '11px',
  marginTop: '2px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#f8fafc',
  letterSpacing: '-0.3px',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#cbd5e1',
  lineHeight: 1.4,
};

const errorBoxStyle: React.CSSProperties = {
  backgroundColor: '#131b2e',
  border: '1px solid #1e293b',
  color: '#f87171',
  padding: '10px 12px',
  borderRadius: '8px',
  fontSize: '11px',
  fontFamily: 'JetBrains Mono, monospace',
};

const errorLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  color: '#94a3b8',
};

const detailsCardStyle: React.CSSProperties = {
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '12px',
};

const labelStyle: React.CSSProperties = {
  color: '#64748b',
};

const methodStyle: React.CSSProperties = {
  backgroundColor: 'rgba(99, 102, 241, 0.15)',
  color: '#818cf8',
  padding: '2px 6px',
  borderRadius: '4px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
};

const valueStyle: React.CSSProperties = {
  color: '#cbd5e1',
};

const checkboxContainerStyle: React.CSSProperties = {
  background: '#131b2e',
  border: '1px solid #334155',
  borderRadius: '8px',
  padding: '12px',
  marginTop: '4px',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  fontSize: '11px',
  color: '#cbd5e1',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const checkboxStyle: React.CSSProperties = {
  marginTop: '2px',
  cursor: 'pointer',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  marginTop: '8px',
};

const rejectBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 14px',
  borderRadius: '10px',
  border: '1px solid #ef4444',
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  color: '#ef4444',
  fontWeight: 700,
  fontSize: '13px',
  cursor: 'pointer',
};

const continueBtnStyle: React.CSSProperties = {
  flex: 1.4,
  padding: '12px 14px',
  borderRadius: '10px',
  border: 'none',
  backgroundColor: '#d97706',
  color: '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const continueTextGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const continueSubtextStyle: React.CSSProperties = {
  fontSize: '9px',
  opacity: 0.9,
  marginTop: '1px',
};

const footerNoticeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
  textAlign: 'center',
  lineHeight: 1.3,
  marginTop: '4px',
};
