import React, { useState } from 'react';
import { PendingRequestSnapshot } from '../../shared/types';

interface StaleReportProps {
  snapshot: PendingRequestSnapshot | null;
  onReject: (requestId: string) => void;
  onReset: () => void;
}

export const StaleReport: React.FC<StaleReportProps> = ({ snapshot, onReject, onReset }) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleReject = () => {
    if (!snapshot || isProcessing) return;
    setIsProcessing(true);
    onReject(snapshot.requestId);
  };

  return (
    <div style={containerStyle}>
      <div style={iconBadgeStyle}>⚠️</div>

      <h2 style={titleStyle}>Request changed</h2>

      <p style={subtitleStyle}>
        The account or network changed while this request was being analyzed.
      </p>

      <div style={noticeCardStyle}>
        <h4 style={noticeTitleStyle}>Analysis Invalidated</h4>
        <p style={noticeTextStyle}>
          To protect your wallet, previous simulation results cannot be used because state changes on a different account or network could produce catastrophic unintended side-effects.
        </p>
      </div>

      {snapshot && (
        <div style={detailsBoxStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>Original Method:</span>
            <code style={codeStyle}>{snapshot.method}</code>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Origin:</span>
            <span style={valueStyle}>{snapshot.origin}</span>
          </div>
        </div>
      )}

      <div style={actionsContainerStyle}>
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
          {isProcessing ? 'Rejecting...' : 'Reject Request (4001)'}
        </button>

        <button
          type="button"
          onClick={onReset}
          disabled={isProcessing}
          style={dismissBtnStyle}
        >
          Dismiss
        </button>
      </div>

      <div style={footerNoticeStyle}>
        Re-initiate the transaction from the dApp to trigger a fresh security analysis.
      </div>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '36px 16px 20px',
  textAlign: 'center',
};

const iconBadgeStyle: React.CSSProperties = {
  width: '56px',
  height: '56px',
  borderRadius: '50%',
  backgroundColor: 'rgba(245, 158, 11, 0.15)',
  border: '1px solid #f59e0b',
  color: '#f59e0b',
  fontSize: '24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#f8fafc',
  marginBottom: '8px',
  letterSpacing: '-0.3px',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#cbd5e1',
  maxWidth: '300px',
  lineHeight: 1.4,
  marginBottom: '20px',
};

const noticeCardStyle: React.CSSProperties = {
  width: '100%',
  background: '#131b2e',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '14px',
  textAlign: 'left',
  marginBottom: '14px',
};

const noticeTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#f59e0b',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '4px',
};

const noticeTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  lineHeight: 1.4,
};

const detailsBoxStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '8px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  marginBottom: '20px',
  textAlign: 'left',
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

const valueStyle: React.CSSProperties = {
  color: '#cbd5e1',
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  color: '#818cf8',
  backgroundColor: 'rgba(99, 102, 241, 0.15)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '11px',
};

const actionsContainerStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const rejectBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: '8px',
  border: '1px solid #ef4444',
  backgroundColor: 'rgba(239, 68, 68, 0.15)',
  color: '#ef4444',
  fontWeight: 700,
  fontSize: '13px',
  cursor: 'pointer',
};

const dismissBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  backgroundColor: '#1e293b',
  border: 'none',
  borderRadius: '8px',
  color: '#94a3b8',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const footerNoticeStyle: React.CSSProperties = {
  marginTop: '20px',
  fontSize: '11px',
  color: '#64748b',
  lineHeight: 1.4,
};
