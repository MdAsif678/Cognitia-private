import { AnalysisReport, StateChange } from '../../shared/api-contract';

export function formatStateValue(value: string | boolean | undefined, change: StateChange, report: AnalysisReport): string {
  if (typeof value === 'boolean') return value ? 'Approved' : 'Not approved';
  if (value === undefined) return 'Not observed';
  if (!/^\d+$/.test(value)) return value;
  if (value === (2n ** 256n - 1n).toString()) return 'Unlimited';
  const token = report.tokens?.find(t => t.address.toLowerCase() === change.token?.toLowerCase());
  const kind = change.kind ?? change.type;
  const decimals = kind === 'native-balance' ? 18 : kind.startsWith('erc20-') ? token?.decimals : undefined;
  if (decimals === undefined) return value;
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : '';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? '.' + fraction : ''} ${token?.symbol ?? (kind === 'native-balance' ? 'ETH' : '')}`.trim();
}

export function StateDiff({ change, report }: { change: StateChange; report: AnalysisReport }) {
  const account = change.account ?? change.owner ?? change.from;
  return <div className="state-diff">
    {account && <p className="diff-account mono" title={account}>Account {account.slice(0, 6)}…{account.slice(-4)}</p>}
    {(change.before !== undefined || change.after !== undefined) && <dl className="diff-values">
      <div><dt>Before</dt><dd>{formatStateValue(change.before, change, report)}</dd></div>
      <div><dt>After</dt><dd>{formatStateValue(change.after, change, report)}</dd></div>
    </dl>}
  </div>;
}
