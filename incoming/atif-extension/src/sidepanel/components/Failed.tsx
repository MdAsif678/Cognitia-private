import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';

interface FailedProps {
  snapshot: PendingRequestSnapshot | null;
  error?: string;
  onReset: () => void;
}

export const Failed: React.FC<FailedProps> = ({ snapshot, error, onReset }) => {
  return (
    <div style={containerStyle}>
      <div style={iconBadgeStyle}>⚠️</div>

      <h2 style={titleStyle}>Provider Request Failed</h2>

      <p style={subtitleStyle}>
        MetaMask or the underlying network returned an execution error.
      </p>

      <div style={errorBoxStyle}>
        <h4 style={errorTitleStyle}>Provider Error Details:</h4>
        <pre style={errorTextStyle}>{error ?? 'Unknown provider failure or execution revert.'}</pre>
      </div>

      {snapshot && (
        <div style={detailsBoxStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>Attempted Method:</span>
            <code style={codeStyle}>{snapshot.method}</code>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Provider:</span>
            <span style={valueStyle}>{snapshot.providerInfo.name}</span>
          </div>
        </div>
      )}

      <button type="button" onClick={onReset} style={dismissBtnStyle}>
        Return to Standby
      </button>
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
  backgroundColor: 'rgba(239, 68, 68, 0.15)',
  border: '1px solid #ef4444',
  color: '#ef4444',
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
  color: '#94a3b8',
  maxWidth: '280px',
  lineHeight: 1.4,
  marginBottom: '20px',
};

const errorBoxStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#1a1012',
  border: '1px solid #7f1d1d',
  borderRadius: '10px',
  padding: '14px',
  marginBottom: '14px',
  textAlign: 'left',
};

const errorTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#f87171',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px',
};

const errorTextStyle: React.CSSProperties = {
  color: '#fca5a5',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

const detailsBoxStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '12px 14px',
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

const dismissBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  backgroundColor: '#1e293b',
  border: 'none',
  borderRadius: '8px',
  color: '#f1f5f9',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};
