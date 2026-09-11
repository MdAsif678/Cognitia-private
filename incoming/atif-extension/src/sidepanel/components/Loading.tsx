import React from 'react';
import { PendingRequestSnapshot } from '../../shared/types';

interface LoadingProps {
  snapshot: PendingRequestSnapshot | null;
}

export const Loading: React.FC<LoadingProps> = ({ snapshot }) => {
  return (
    <div style={containerStyle}>
      <div style={spinnerWrapperStyle}>
        <div style={spinnerStyle} />
      </div>

      <h2 style={titleStyle}>Checking transaction</h2>
      <p style={subtitleStyle}>Analyzing this request before MetaMask opens.</p>

      {snapshot && (
        <div style={cardStyle}>
          <div style={rowStyle}>
            <span style={labelStyle}>Method:</span>
            <code style={methodBadgeStyle}>{snapshot.method}</code>
          </div>
          {snapshot.chainId && (
            <div style={rowStyle}>
              <span style={labelStyle}>Network / Chain:</span>
              <span style={valueStyle}>{snapshot.chainId}</span>
            </div>
          )}
          {snapshot.account && (
            <div style={rowStyle}>
              <span style={labelStyle}>Account:</span>
              <span style={valueStyle}>
                {snapshot.account.slice(0, 6)}...{snapshot.account.slice(-4)}
              </span>
            </div>
          )}
          <div style={rowStyle}>
            <span style={labelStyle}>Origin:</span>
            <span style={valueStyle}>{snapshot.origin}</span>
          </div>
        </div>
      )}

      <div style={footerNoticeStyle}>
        🔒 Transaction held in memory. MetaMask will not be called without your explicit approval.
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
  border: '3px solid rgba(99, 102, 241, 0.2)',
  borderTopColor: '#6366f1',
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
  lineHeight: 1.4,
  maxWidth: '300px',
  marginBottom: '28px',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  background: '#131b2e',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
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
  fontWeight: 500,
};

const valueStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
};

const methodBadgeStyle: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)',
  color: '#818cf8',
  padding: '3px 8px',
  borderRadius: '6px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  fontWeight: 600,
};

const footerNoticeStyle: React.CSSProperties = {
  marginTop: '32px',
  fontSize: '11px',
  color: '#64748b',
  lineHeight: 1.4,
  maxWidth: '280px',
};
