import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ALL_FIXTURES, FixtureScenario } from '../src/shared/fixtures';
import { RiskReport } from '../src/sidepanel/components/RiskReport';

export const VisualFixturesGallery: React.FC = () => {
  const fixtureKeys = Object.keys(ALL_FIXTURES);
  const [selectedKey, setSelectedKey] = useState<string>(fixtureKeys[0]);
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');

  const currentFixture: FixtureScenario = ALL_FIXTURES[selectedKey];

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>AnalysisReport Visual Fixtures Verification Gallery</h1>
          <p style={subtitleStyle}>
            Verifying 10-tier information hierarchy, severity mapping, simulation states, and coverage warnings across all 6 required profiles.
          </p>
        </div>

        <div style={modeToggleGroupStyle}>
          <button
            type="button"
            id="toggle-single-view"
            onClick={() => setViewMode('single')}
            style={viewMode === 'single' ? activeToggleBtnStyle : toggleBtnStyle}
          >
            Side Panel View (Single)
          </button>
          <button
            type="button"
            id="toggle-grid-view"
            onClick={() => setViewMode('grid')}
            style={viewMode === 'grid' ? activeToggleBtnStyle : toggleBtnStyle}
          >
            Compare All 6 (Side-by-Side)
          </button>
        </div>
      </header>

      {/* Fixture Selector Tabs */}
      {viewMode === 'single' && (
        <nav style={tabsContainerStyle}>
          {fixtureKeys.map((key) => {
            const fix = ALL_FIXTURES[key];
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                id={`tab-${key}`}
                type="button"
                onClick={() => setSelectedKey(key)}
                style={isSelected ? activeTabStyle : tabStyle}
              >
                {fix.name}
              </button>
            );
          })}
        </nav>
      )}

      {/* Content Rendering */}
      {viewMode === 'single' ? (
        <main style={singleViewWrapperStyle}>
          <div className="demo-frame" style={sidePanelMockFrameStyle}>
            <div style={frameHeaderStyle}>
              <span>CHROME EXTENSION SIDE PANEL</span>
              <span style={frameDotStyle}>●</span>
            </div>
            <RiskReport
              snapshot={currentFixture.snapshot}
              analysis={currentFixture.analysis}
              report={currentFixture.report}
              onContinue={(id) => alert(`[Continue clicked for ${id}] Original request forwarded to MetaMask!`)}
              onReject={(id) => alert(`[Reject clicked for ${id}] Intercepted request rejected with EIP-1193 code 4001.`)}
            />
          </div>
        </main>
      ) : (
        <main style={gridWrapperStyle}>
          {fixtureKeys.map((key) => {
            const fix = ALL_FIXTURES[key];
            return (
              <div key={key} className="demo-frame" id={`fixture-card-${key}`}>
                <div style={gridCardHeaderStyle}>
                  <strong style={gridTitleStyle}>{fix.name}</strong>
                  <span style={gridBadgeStyle}>Severity: {fix.report.severity.toUpperCase()}</span>
                </div>
                <RiskReport
                  snapshot={fix.snapshot}
                  analysis={fix.analysis}
                  report={fix.report}
                  onContinue={(id) => console.log('Continue', id)}
                  onReject={(id) => console.log('Reject', id)}
                />
              </div>
            );
          })}
        </main>
      )}
    </div>
  );
};

// Styles
const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#f6f5f1',
  color: '#111111',
  fontFamily: 'Inter, -apple-system, "Segoe UI", sans-serif',
  padding: '24px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingBottom: '16px',
  borderBottom: '1px solid #e6e4de',
  marginBottom: '20px',
  flexWrap: 'wrap',
  gap: '12px',
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'Inter Tight, Inter, sans-serif',
  fontSize: '20px',
  fontWeight: 800,
  color: '#111111',
  letterSpacing: '-0.02em',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#66655f',
  marginTop: '4px',
};

const modeToggleGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  background: '#f6f5f1',
  padding: '4px',
  borderRadius: '999px',
  border: '1px solid #e6e4de',
};

const toggleBtnStyle: React.CSSProperties = {
  background: '#ffffff',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#e6e4de',
  color: '#454541',
  padding: '6px 14px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const activeToggleBtnStyle: React.CSSProperties = {
  ...toggleBtnStyle,
  background: '#111111',
  borderColor: '#111111',
  color: '#ffffff',
};

const tabsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginBottom: '24px',
};

const tabStyle: React.CSSProperties = {
  background: '#ffffff',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#e6e4de',
  color: '#454541',
  padding: '8px 14px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: '#111111',
  borderColor: '#111111',
  color: '#ffffff',
};

const singleViewWrapperStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
};

// Card chrome (surface, hairline, radius, shadow) comes from .demo-frame in the panel stylesheet.
const sidePanelMockFrameStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '440px',
};

const frameHeaderStyle: React.CSSProperties = {
  background: '#f6f5f1',
  padding: '10px 16px',
  borderBottom: '1px solid #e6e4de',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '10px',
  fontWeight: 500,
  color: '#66655f',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  letterSpacing: '0.14em',
};

const frameDotStyle: React.CSSProperties = {
  color: '#0d7d56',
};

const gridWrapperStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
  gap: '20px',
};

const gridCardHeaderStyle: React.CSSProperties = {
  background: '#f6f5f1',
  padding: '10px 14px',
  borderBottom: '1px solid #e6e4de',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const gridTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#111111',
};

const gridBadgeStyle: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  color: '#66655f',
  background: '#ffffff',
  border: '1px solid #e6e4de',
  padding: '2px 8px',
  borderRadius: '999px',
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<VisualFixturesGallery />);
}
