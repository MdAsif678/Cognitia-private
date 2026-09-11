/**
 * Renders the REAL side-panel RiskReport component with LIVE reports from the analysis backend,
 * one tab per button on Syed's demo site (same calldata the site sends to the wallet).
 * Open via `vite` → /demo/live.html?api=http://localhost:8081
 */
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AnalyzeRequest, AnalysisReport, parseAnalysisReport } from '../src/shared/api-contract';
import { PendingRequestSnapshot } from '../src/shared/types';
import { mapReportToAnalysisResult } from '../src/background/analyzer';
import { RiskReport } from '../src/sidepanel/components/RiskReport';

const API = new URLSearchParams(location.search).get('api') ?? 'http://localhost:8081';
const CHAIN_ID = 31337;
const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ATTACKER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6';
const NFT = '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318';
const ERC1155 = '0x610178dA211FEF7D417bC0e6FeD39F05609AD788';
const DRAINER = '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e';
const ORIGIN = 'http://localhost:3000';

const tx = (to: string, data: string) => ({ method: 'eth_sendTransaction', params: [{ from: WALLET, to, data, value: '0x0' }] });
const permit = {
  types: {
    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
    Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  },
  primaryType: 'Permit',
  domain: { name: 'PS2 Test USD', version: '1', chainId: CHAIN_ID, verifyingContract: TOKEN },
  message: { owner: WALLET, spender: ATTACKER, value: '115792089237316195423570985008687907853269984665640564039457584007913129639935', nonce: 0, deadline: Math.floor(Date.now() / 1000) + 3600 },
};

const BUTTONS: { id: string; name: string; expected: string; method: string; params: unknown[] }[] = [
  { id: 'b1', name: '1 · Claim 500 pUSD Airdrop', expected: 'HIGH', ...tx(TOKEN, `0x095ea7b3000000000000000000000000${ATTACKER.slice(2).toLowerCase()}ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`) },
  { id: 'b2', name: '2 · Mint Cyber NFT', expected: 'HIGH', ...tx(NFT, `0xa22cb465000000000000000000000000${ATTACKER.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000001`) },
  { id: 'b3', name: '3 · Claim Staking Yield', expected: 'HIGH', ...tx(DRAINER, '0x4e71d92d') },
  { id: 'b4', name: '4 · Sign Gasless Voucher', expected: 'HIGH', method: 'eth_signTypedData_v4', params: [WALLET, JSON.stringify(permit)] },
  { id: 'b5', name: '5 · Claim Event Badges', expected: 'HIGH', ...tx(ERC1155, `0xa22cb465000000000000000000000000${ATTACKER.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000001`) },
  { id: 'b6', name: '6 · Send 10 pUSD (Safe)', expected: 'LOW', ...tx(TOKEN, '0xa9059cbb0000000000000000000000009965507d1a55bcc2695c58ba16fb37d819b0a4df0000000000000000000000000000000000000000000000008ac7230489e80000') },
  { id: 'b7', name: '7 · Revoke Allowance', expected: 'LOW', ...tx(TOKEN, `0x095ea7b3000000000000000000000000${ATTACKER.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000000`) },
];

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; report: AnalysisReport; snapshot: PendingRequestSnapshot; ms: number };

async function analyzeButton(b: (typeof BUTTONS)[number]): Promise<State> {
  const requestId = `${b.id}-${Date.now()}`;
  const request: AnalyzeRequest = { requestId, origin: ORIGIN, chainId: CHAIN_ID, account: WALLET, method: b.method, params: b.params };
  const started = performance.now();
  const res = await fetch(`${API}/v1/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
  const parsed = parseAnalysisReport(await res.json());
  if (!parsed.success) return { status: 'error', message: parsed.error };
  const report = parsed.report;
  const snapshot: PendingRequestSnapshot = {
    requestId, timestamp: Date.now(), origin: ORIGIN, method: b.method, rawParams: b.params, chainId: '0x7a69', account: WALLET,
    providerInfo: { name: 'MetaMask' }, status: 'ANALYSIS_READY', analysis: mapReportToAnalysisResult(report, requestId),
  };
  return { status: 'ready', report, snapshot, ms: Math.round(performance.now() - started) };
}

/** Replay a mined mainnet/Sepolia transaction as if it were still unsigned (POST /v1/replay). */
async function replayTx(chainId: number, txHash: string): Promise<State> {
  const started = performance.now();
  const res = await fetch(`${API}/v1/replay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chainId, txHash }) });
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}: ${(await res.json().catch(() => ({}))).error ?? ''}` };
  const { report: raw } = (await res.json()) as { report: unknown };
  const parsed = parseAnalysisReport(raw);
  if (!parsed.success) return { status: 'error', message: parsed.error };
  const report = parsed.report;
  const snapshot: PendingRequestSnapshot = {
    requestId: report.requestId, timestamp: Date.now(), origin: 'replay', method: 'eth_sendTransaction', rawParams: [],
    chainId: `0x${chainId.toString(16)}`, account: WALLET, providerInfo: { name: 'Replay (mined tx)' }, status: 'ANALYSIS_READY',
    analysis: mapReportToAnalysisResult(report, report.requestId),
  };
  return { status: 'ready', report, snapshot, ms: Math.round(performance.now() - started) };
}

const App: React.FC = () => {
  const [selected, setSelected] = useState(BUTTONS[0].id);
  const [states, setStates] = useState<Record<string, State>>({});
  const [decision, setDecision] = useState<string>('');
  const [replayHash, setReplayHash] = useState('');
  const [replayChain, setReplayChain] = useState(1);

  const runReplay = () => {
    const hash = replayHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return setDecision('Enter a 32-byte transaction hash (0x…) from Etherscan.');
    setSelected('replay');
    setStates((s) => ({ ...s, replay: { status: 'loading' } }));
    replayTx(replayChain, hash).then((st) => setStates((s) => ({ ...s, replay: st }))).catch((err) => setStates((s) => ({ ...s, replay: { status: 'error', message: String(err) } })));
  };

  useEffect(() => {
    if (selected === 'replay' || states[selected]) return;
    setStates((s) => ({ ...s, [selected]: { status: 'loading' } }));
    analyzeButton(BUTTONS.find((b) => b.id === selected)!)
      .then((st) => setStates((s) => ({ ...s, [selected]: st })))
      .catch((err) => setStates((s) => ({ ...s, [selected]: { status: 'error', message: String(err) } })));
  }, [selected]);

  const current = BUTTONS.find((b) => b.id === selected) ?? { id: 'replay', name: `Replay ${replayHash.slice(0, 12)}… on chain ${replayChain}`, expected: '?' };
  const state = states[selected];

  return (
    <div style={{ padding: 24 }}>
      <header style={{ borderBottom: '1px solid #e6e4de', paddingBottom: 14, marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'Inter Tight, Inter, sans-serif', fontSize: 20, fontWeight: 800, color: '#111111', letterSpacing: '-0.02em' }}>Live risk reports. Demo buttons, analysis backend, side panel</h1>
        <p style={{ fontSize: 12, color: '#66655f', marginTop: 4 }}>
          Backend <code>{API}</code> · chain 31337 · wallet {WALLET.slice(0, 8)}… · each tab sends the exact calldata the demo site sends to the wallet.
        </p>
      </header>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {BUTTONS.map((b) => {
          const st = states[b.id];
          const sev = st?.status === 'ready' ? st.report.severity.toUpperCase() : st?.status === 'loading' ? '…' : st?.status === 'error' ? 'ERR' : '';
          return (
            <button key={b.id} id={`tab-${b.id}`} onClick={() => setSelected(b.id)} style={{ background: b.id === selected ? '#111111' : '#ffffff', border: `1px solid ${b.id === selected ? '#111111' : '#e6e4de'}`, color: b.id === selected ? '#ffffff' : '#454541', padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {b.name} {sev && <span style={{ marginLeft: 6, color: sev === b.expected ? '#0d7d56' : '#c22f1c' }}>{sev}</span>}
            </button>
          );
        })}
      </nav>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.14em', color: '#111111', fontWeight: 500 }}>OR REPLAY ANY REAL TRANSACTION:</span>
        <select value={replayChain} onChange={(e) => setReplayChain(Number(e.target.value))} style={{ background: '#ffffff', color: '#111111', border: '1px solid #c9c7c0', borderRadius: 8, padding: '6px 8px', fontSize: 12 }}>
          <option value={1}>Ethereum mainnet</option>
          <option value={11155111}>Sepolia</option>
        </select>
        <input id="replay-hash" value={replayHash} onChange={(e) => setReplayHash(e.target.value)} placeholder="0x… transaction hash from Etherscan" style={{ flex: 1, minWidth: 320, background: '#ffffff', color: '#111111', border: '1px solid #c9c7c0', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }} />
        <button id="replay-run" onClick={runReplay} style={{ background: '#111111', color: '#ffffff', border: '1px solid #111111', borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Analyse as if unsigned</button>
      </div>
      <main style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="demo-frame" style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ background: '#f6f5f1', padding: '10px 16px', borderBottom: '1px solid #e6e4de', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 500, color: '#66655f', letterSpacing: '0.14em' }}>CHROME EXTENSION SIDE PANEL</div>
          {!state || state.status === 'loading' ? (
            <div style={{ padding: 24, color: '#66655f' }}>Analyzing on a private fork…</div>
          ) : state.status === 'error' ? (
            <div style={{ padding: 24, color: '#c22f1c' }}>Analysis unavailable: {state.message}</div>
          ) : (
            <RiskReport
              snapshot={state.snapshot}
              analysis={state.snapshot.analysis!}
              report={state.report}
              onContinue={(id) => setDecision(`Continue clicked for ${id}: the extension would now forward the original request to MetaMask exactly once.`)}
              onReject={(id) => setDecision(`Reject clicked for ${id}: the site receives EIP-1193 error 4001; MetaMask never opens.`)}
            />
          )}
        </div>
        <aside style={{ flex: 1, minWidth: 320, fontSize: 12, color: '#454541' }}>
          <h2 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', color: '#111111', textTransform: 'uppercase', marginBottom: 8 }}>{current.name} · expected {current.expected}</h2>
          {state?.status === 'ready' && (
            <>
              <p>Verdict <strong style={{ color: state.report.severity === current.expected.toLowerCase() ? '#0d7d56' : '#c22f1c' }}>{state.report.severity.toUpperCase()}</strong> · {state.report.status} · {state.ms} ms · block #{state.report.fork?.blockNumber}</p>
              <p style={{ marginTop: 6 }}>{state.report.summary}</p>
              <h3 style={{ marginTop: 12, color: '#66655f' }}>Immediate changes</h3>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{state.report.immediateChanges.map((c) => `${c.type}  ${c.asset ?? ''}  ${c.amount ?? ''}${c.spender ? `  spender ${c.spender}` : ''}`).join('\n') || '(none)'}</pre>
              <h3 style={{ marginTop: 12, color: '#66655f' }}>Conditional (if the attacker acts next)</h3>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{((state.report as unknown as { conditionalChanges?: typeof state.report.immediateChanges }).conditionalChanges ?? []).map((c) => `${c.type}  ${c.asset ?? ''}  ${c.amount ?? ''}${c.from && c.to ? `  ${c.from.slice(0, 8)}… → ${c.to.slice(0, 8)}…` : ''}`).join('\n') || '(none)'}</pre>
            </>
          )}
          {decision && <p style={{ marginTop: 16, padding: 10, background: '#f6f5f1', border: '1px solid #e6e4de', borderRadius: 8 }}>{decision}</p>}
        </aside>
      </main>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
