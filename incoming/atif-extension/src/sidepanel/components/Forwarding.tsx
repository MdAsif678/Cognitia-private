import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';

interface ForwardingProps {
  snapshot: PendingRequestSnapshot | null;
}

export const Forwarding: React.FC<ForwardingProps> = ({ snapshot }) => {
  return (
    <div style={containerStyle}>
      <div style={spinnerWrapperStyle}>
        <div style={spinnerStyle} />
      </div>

      <h2 style={titleStyle}>Opening MetaMask...</h2>

      <p style={subtitleStyle}>
        Forwarding the exact original transaction parameters. Please review and sign inside MetaMask.
      </p>

      {snapshot && (
        <div style={detailsBoxStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>Method:</span>
            <code style={methodStyle}>{snapshot.method}</code>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Provider:</span>
            <span style={valueStyle}>{snapshot.providerInfo.name}</span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Parameters:</span>
            <span style={unmutatedBadgeStyle}>Unmutated Exact Match</span>
          </div>
        </div>
      )}

      {/* Disabled Actions Indicator */}
      <div style={disabledActionsBoxStyle}>
        <button type="button" disabled style={disabledBtnStyle}>
          Reject (Disabled)
        </button>
        <button type="button" disabled style={disabledBtnStyle}>
          Continue (Forwarded)
        </button>
      </div>

      <div style={walletPromptReminderStyle}>
        🦊 MetaMask prompt has been triggered. If you don't see the popup, click the MetaMask extension icon in your browser toolbar.
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

const spinnerWrapperStyle: React.CSSProperties = {
  width: '56px',
  height: '56px',
  marginBottom: '20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const spinnerStyle: React.CSSProperties = {
  width: '44px',
  height: '44px',
  borderRadius: '50%',
  border: '3px solid rgba(79, 70, 229, 0.2)',
  borderTopColor: '#4f46e5',
  animation: 'spin 0.9s linear infinite',
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
  marginBottom: '24px',
};

const detailsBoxStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#131b2e',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '14px',
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

const methodStyle: React.CSSProperties = {
  backgroundColor: 'rgba(99, 102, 241, 0.15)',
  color: '#818cf8',
  padding: '2px 6px',
  borderRadius: '4px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
};

const unmutatedBadgeStyle: React.CSSProperties = {
  backgroundColor: 'rgba(34, 197, 94, 0.15)',
  color: '#4ade80',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 600,
};

const disabledActionsBoxStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  width: '100%',
  marginBottom: '16px',
};

const disabledBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px',
  borderRadius: '8px',
  border: '1px solid #334155',
  backgroundColor: '#1e293b',
  color: '#64748b',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'not-allowed',
};

const walletPromptReminderStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '8px',
  padding: '12px',
  lineHeight: 1.4,
  textAlign: 'left',
};
