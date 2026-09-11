import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';

interface RejectedProps {
  snapshot: PendingRequestSnapshot | null;
  reason?: string;
  onReset: () => void;
}

export const Rejected: React.FC<RejectedProps> = ({ snapshot, reason, onReset }) => {
  return (
    <div style={containerStyle}>
      <div style={iconBadgeStyle}>✕</div>

      <h2 style={titleStyle}>Request rejected</h2>

      <p style={subtitleStyle}>
        The transaction was safely terminated. MetaMask was never opened.
      </p>

      <div style={detailsBoxStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>Status:</span>
          <span style={codeBadgeStyle}>EIP-1193 4001 (User Rejected)</span>
        </div>
        {reason && (
          <div style={rowStyle}>
            <span style={labelStyle}>Reason:</span>
            <span style={valueStyle}>{reason}</span>
          </div>
        )}
        {snapshot && (
          <div style={rowStyle}>
            <span style={labelStyle}>Method:</span>
            <span style={valueStyle}>{snapshot.method}</span>
          </div>
        )}
      </div>

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
  color: '#ef4444',
  fontSize: '24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '16px',
  border: '1px solid #ef4444',
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
  marginBottom: '24px',
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

const codeBadgeStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  color: '#f87171',
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
