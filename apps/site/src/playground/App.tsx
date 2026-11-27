import { useEffect, useMemo, useState } from 'react';
import { RiskReport } from '../../../../incoming/atif-extension/src/sidepanel/components/RiskReport';
import { apiStatus, config, demoDeployed } from '../config';
import { analyze, replay, type RunState } from './api';
import { DEFAULT_ACCOUNT, scenarios, type Scenario } from './scenarios';

type Tab = 'examples' | 'custom' | 'replay';
type Api = 'checking' | 'unconfigured' | 'online' | 'offline';

const CHAINS: { id: number; name: string }[] = [
  { id: 1, name: 'Ethereum mainnet' },
  { id: 11155111, name: 'Sepolia testnet' },
  ...(config.demo.chainId !== 1 && config.demo.chainId !== 11155111 ? [{ id: config.demo.chainId, name: config.demo.chainName }] : []),
];

const TEMPLATES: Record<string, (account: string) => string> = {
  eth_sendTransaction: (account) => JSON.stringify([{ from: account, to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', value: '0x0', data: '0x095ea7b3000000000000000000000000000000000000000000000000000000000000dead' + 'f'.repeat(64) }], null, 2),
  eth_signTypedData_v4: (account) => JSON.stringify([account, '{"types":{…},"primaryType":"Permit","domain":{…},"message":{…}}'], null, 2),
  personal_sign: (account) => JSON.stringify(['0x48656c6c6f2c20776f726c64', account], null, 2),
};

const isAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const isTxHash = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v.trim());

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(t); }, []);
  return <>{((performance.now() - since) / 1000).toFixed(1)} s</>;
}

export function App() {
  const [api, setApi] = useState<Api>('checking');
  const [tab, setTab] = useState<Tab>('examples');
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const [activeId, setActiveId] = useState<string>('');
  const [decision, setDecision] = useState('');

  const [custom, setCustom] = useState({ chainId: 1, origin: 'https://example.com', method: 'eth_sendTransaction', params: TEMPLATES.eth_sendTransaction(DEFAULT_ACCOUNT) });
  const [replayForm, setReplayForm] = useState({ chainId: 1, hash: '' });
  const [formError, setFormError] = useState('');

  useEffect(() => { apiStatus().then(setApi); }, []);

  const busy = state.status === 'loading';
  const disabled = busy || api === 'unconfigured';
  const groups = useMemo(() => ({
    mainnet: scenarios.filter((s) => s.group === 'mainnet'),
    demo: scenarios.filter((s) => s.group === 'demo'),
  }), []);

  async function run(id: string, label: string, job: () => Promise<RunState>) {
    setActiveId(id);
    setDecision('');
    setFormError('');
    setState({ status: 'loading', label, started: performance.now() });
    setState(await job());
  }

  function runScenario(s: Scenario) {
    if (!isAddress(account)) return setFormError('"Simulate as" must be a 0x… address (40 hex characters).');
    void run(s.id, s.title, () => analyze(s.title, { chainId: s.chainId, origin: s.origin, account: account.trim(), method: s.method, params: s.params(account.trim()) }, s.expected));
  }

  function runCustom() {
    if (!isAddress(account)) return setFormError('"Simulate as" must be a 0x… address (40 hex characters).');
    let params: unknown;
    try { params = JSON.parse(custom.params); } catch { return setFormError('Params must be valid JSON, for example [ { "from": …, "to": …, "data": … } ].'); }
    if (!Array.isArray(params)) return setFormError('Params must be a JSON array, exactly as the dapp passes it to window.ethereum.request.');
    void run('custom', 'Your request', () => analyze('Your request', { chainId: custom.chainId, origin: custom.origin.trim() || 'https://example.com', account: account.trim(), method: custom.method, params }));
  }

  function runReplay(chainId: number, hash: string, label?: string) {
    if (!isTxHash(hash)) return setFormError('Enter a transaction hash: 0x followed by 64 hex characters.');
    void run(`replay-${hash}`, label ?? `Replay ${hash.slice(0, 10)}…`, () => replay(label ?? `Replay ${hash.slice(0, 10)}…`, chainId, hash.trim()));
  }

  return (
    <div className="pg">
      <aside className="pg-controls">
        {api === 'unconfigured' && (
          <p className="notice" data-tone="danger">
            <strong>No analysis API configured yet.</strong> Set <code>apiBaseUrl</code> in <code>apps/site/site.config.json</code> or the <code>ANALYSIS_API_URL</code> repository variable, then republish the site.
          </p>
        )}
        {api === 'offline' && (
          <p className="notice" data-tone="danger"><strong>The analysis API is not responding.</strong> Reports will fail until it is back online.</p>
        )}

        <div className="field">
          <label htmlFor="account">Simulate as</label>
          <input id="account" value={account} spellCheck={false} onChange={(e) => setAccount(e.target.value)} />
          <span className="muted small-text">Any address. No key is needed: the request is only simulated, never signed.</span>
        </div>

        <div className="pg-tabs" role="tablist">
          {(['examples', 'custom', 'replay'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {{ examples: 'Examples', custom: 'Your request', replay: 'Replay a tx' }[t]}
            </button>
          ))}
        </div>

        {tab === 'examples' && (
          <div className="pg-list" data-list>
            <p className="label">Live Ethereum mainnet state</p>
            {groups.mainnet.map((s) => <ScenarioButton key={s.id} s={s} active={activeId === s.id} disabled={disabled} onClick={() => runScenario(s)} />)}
            <p className="label" style={{ marginTop: 18 }}>Our demo contracts on {config.demo.chainName}</p>
            {demoDeployed
              ? groups.demo.map((s) => <ScenarioButton key={s.id} s={s} active={activeId === s.id} disabled={disabled} onClick={() => runScenario(s)} />)
              : <p className="muted small-text">Not deployed yet. Run the <em>Deploy demo contracts to Sepolia</em> workflow and these appear here.</p>}
          </div>
        )}

        {tab === 'custom' && (
          <div className="pg-form">
            <div className="pg-row">
              <div className="field">
                <label htmlFor="c-chain">Chain</label>
                <select id="c-chain" value={custom.chainId} onChange={(e) => setCustom({ ...custom, chainId: Number(e.target.value) })}>
                  {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-method">Method</label>
                <select id="c-method" value={custom.method} onChange={(e) => setCustom({ ...custom, method: e.target.value, params: TEMPLATES[e.target.value](account) })}>
                  {Object.keys(TEMPLATES).map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-origin">Requesting site</label>
              <input id="c-origin" value={custom.origin} spellCheck={false} onChange={(e) => setCustom({ ...custom, origin: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="c-params">Params (JSON array)</label>
              <textarea id="c-params" value={custom.params} spellCheck={false} onChange={(e) => setCustom({ ...custom, params: e.target.value })} />
            </div>
            <button className="button" disabled={disabled} onClick={runCustom}>Analyse request</button>
          </div>
        )}

        {tab === 'replay' && (
          <div className="pg-form">
            <p className="muted small-text">Re-runs a mined transaction as if it were still waiting for your signature, on the state just before its block.</p>
            <div className="field">
              <label htmlFor="r-chain">Chain</label>
              <select id="r-chain" value={replayForm.chainId} onChange={(e) => setReplayForm({ ...replayForm, chainId: Number(e.target.value) })}>
                {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-hash">Transaction hash</label>
              <input id="r-hash" placeholder="0x…" value={replayForm.hash} spellCheck={false} onChange={(e) => setReplayForm({ ...replayForm, hash: e.target.value })} />
            </div>
            <button className="button" disabled={disabled} onClick={() => runReplay(replayForm.chainId, replayForm.hash)}>Replay as unsigned</button>
            {config.realAttackReplays.length > 0 && (
              <>
                <p className="label" style={{ marginTop: 18 }}>Documented real attacks</p>
                {config.realAttackReplays.map((r) => (
                  <button key={r.txHash} className="pg-item" disabled={disabled} onClick={() => runReplay(r.chainId, r.txHash, r.label)}>
                    <span className="pg-item-title">{r.label}</span>
                    <span className="pg-item-detail mono">{r.txHash.slice(0, 18)}…{r.source ? ` · ${r.source}` : ''}</span>
                  </button>
                ))}
              </>
            )}
            <p className="muted small-text">Older transactions need an archive RPC on the API server.</p>
          </div>
        )}

        {formError && <p className="notice" data-tone="danger">{formError}</p>}
      </aside>

      <section className="pg-output" aria-live="polite">
        <div className="pg-frame">
          <div className="pg-frame-bar">
            <span>Cognitia side panel</span>
            <span>{state.status === 'ready' && state.report.fork ? `Block #${state.report.fork.blockNumber}` : ''}</span>
          </div>
          {state.status === 'idle' && (
            <div className="pg-empty pg-idle">
              <div className="pg-idle-mark" aria-hidden="true"><span /><span /><span /></div>
              <p className="pg-empty-title">Pick a request<span className="dot">.</span></p>
              <p className="muted">The report the extension would show before your wallet opens appears here. Each run forks live chain state; nothing is broadcast.</p>
            </div>
          )}
          {state.status === 'loading' && (
            <div className="pg-empty pg-loading" key={`loading-${activeId}`}>
              <div className="pg-scan" aria-hidden="true" />
              <p className="pg-empty-title">Simulating on a private fork<span className="pg-ellipsis" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>
              <p className="muted">{state.label} · <span className="mono"><Elapsed since={state.started} /></span></p>
              <ul className="pg-stages" aria-label="What the analysis does">
                <li>Fork live state at a verified block</li>
                <li>Execute the exact request, impersonating the account</li>
                <li>Diff balances, allowances and NFT ownership</li>
                <li>Decode intent and match the drainer database</li>
              </ul>
              <p className="muted small-text">Mainnet forks over public RPCs usually take 3 to 15 seconds.</p>
            </div>
          )}
          {state.status === 'error' && (
            <div className="pg-empty pg-error" key={`error-${activeId}`}>
              <p className="pg-empty-title">Analysis unavailable<span className="dot">.</span></p>
              <p className="muted">{state.message}</p>
            </div>
          )}
          {state.status === 'ready' && (
            <div className="pg-enter" key={state.report.requestId}>
            <RiskReport
              snapshot={state.snapshot}
              analysis={state.snapshot.analysis}
              report={state.report}
              onContinue={() => setDecision('In the extension, Continue to wallet would now open your wallet with exactly this reviewed request, once.')}
              onReject={() => setDecision('In the extension, Reject would cancel the request: the site receives error 4001 and your wallet never opens.')}
            />
            </div>
          )}
        </div>

        {state.status === 'ready' && (
          <div className="pg-meta">
            <p>
              <strong>{state.report.severity.toUpperCase()}</strong> · {state.report.status} · {state.ms.toLocaleString()} ms
              {state.expected && <> · expected <strong>{state.expected.toUpperCase()}</strong></>}
            </p>
            <div className="pg-meta-actions">
              <button className="button secondary small" onClick={() => downloadJson(`cognitia-${state.report.requestId}.json`, state.report)}>Download report JSON</button>
              <button className="button secondary small" onClick={() => downloadJson(`cognitia-request-${state.report.requestId}.json`, state.request)}>Download request</button>
            </div>
          </div>
        )}
        {decision && <p className="notice pg-decision" data-tone="success" key={decision}>{decision}</p>}
      </section>
    </div>
  );
}

function ScenarioButton({ s, active, disabled, onClick }: { s: Scenario; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className="pg-item" aria-pressed={active} disabled={disabled} onClick={onClick}>
      <span className="pg-item-head">
        <span className="pg-item-title">{s.title}</span>
        <span className="sev-tag" data-severity={s.expected}>{s.expected}</span>
      </span>
      <span className="pg-item-detail">{s.detail}</span>
    </button>
  );
}
