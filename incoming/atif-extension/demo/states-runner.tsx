/**
 * Dev-only gallery of every non-report side panel state, rendered side by side
 * at side panel width. Open with `npm run dev` at /demo/states.html.
 * Not part of the extension build.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { benignTransferSnapshot } from '../src/shared/fixtures';
import { Loading } from '../src/sidepanel/components/Loading';
import { Forwarding } from '../src/sidepanel/components/Forwarding';
import { Rejected } from '../src/sidepanel/components/Rejected';
import { Failed } from '../src/sidepanel/components/Failed';
import { StaleReport } from '../src/sidepanel/components/StaleReport';
import { AnalysisUnavailable } from '../src/sidepanel/components/AnalysisUnavailable';
import '../src/sidepanel/styles.css';

const noop = () => undefined;

const STATES: { name: string; node: React.ReactNode }[] = [
  { name: 'ANALYZING', node: <Loading snapshot={benignTransferSnapshot} /> },
  {
    name: 'ANALYSIS_UNAVAILABLE',
    node: (
      <AnalysisUnavailable
        snapshot={benignTransferSnapshot}
        errorMessage="analysis timed out after 20s"
        onContinue={noop}
        onReject={noop}
      />
    ),
  },
  { name: 'STALE', node: <StaleReport snapshot={benignTransferSnapshot} onReject={noop} onReset={noop} /> },
  { name: 'FORWARDING', node: <Forwarding snapshot={benignTransferSnapshot} /> },
  {
    name: 'REJECTED',
    node: <Rejected snapshot={benignTransferSnapshot} reason="User rejected request" onReset={noop} />,
  },
  {
    name: 'FAILED',
    node: (
      <Failed
        snapshot={benignTransferSnapshot}
        error="MetaMask Tx Signature: User denied transaction signature."
        onReset={noop}
      />
    ),
  },
];

const Gallery: React.FC = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 24, alignItems: 'flex-start' }}>
    {STATES.map((state) => (
      <div key={state.name} style={{ width: 380 }}>
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: '#6e7380',
            marginBottom: 8,
          }}
        >
          {state.name}
        </div>
        <div className="app" style={{ height: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
          <main className="view">{state.node}</main>
        </div>
      </div>
    ))}
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(<Gallery />);
