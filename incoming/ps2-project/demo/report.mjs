// Render backend evidence as text; calldata, origins and metadata are untrusted.
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function formatValue(value, change, report) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return String(value ?? '—');
  if (value === (2n ** 256n - 1n).toString()) return 'Unlimited';
  const token = report.tokens?.find(t => t.address.toLowerCase() === change.token?.toLowerCase());
  const decimals = change.kind === 'native-balance' ? 18 : change.kind?.startsWith('erc20-') ? token?.decimals : undefined;
  if (decimals === undefined) return value;
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : '';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? '.' + fraction : ''} ${token?.symbol ?? (change.kind === 'native-balance' ? 'ETH' : '')}`.trim();
}
export function renderReport(root, report) {
  root.replaceChildren();
  const heading = element('h1', report.summary || 'Analysis unavailable');
  heading.id = 'report-title';
  heading.tabIndex = -1;
  root.append(heading, element('p', `${String(report.severity).toUpperCase()} · ${report.status} · ${report.simulation?.outcome ?? 'not executed'}`, 'report-verdict'));
  root.append(element('p', report.fork ? `Chain ${report.fork.chainId} · Fork block ${report.fork.blockNumber} · ${report.fork.blockHash}` : 'No fork execution was available. No safety conclusion can be drawn.', 'report-meta'));
  if (report.analyzedAt) root.append(element('p', `Analyzed ${report.analyzedAt} · ${report.durationMs} ms`, 'report-meta'));
  if (report.intent?.summary) root.append(element('p', `Decoded intent: ${report.intent.summary}`));
  const order = { critical: 0, high: 1, medium: 2, unknown: 3, low: 4 };
  for (const finding of [...(report.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity])) {
    const card = element('section', undefined, 'report-finding');
    card.dataset.severity = finding.severity;
    card.append(element('h3', `${finding.severity.toUpperCase()} · ${finding.title}`), element('p', finding.explanation || finding.description));
    if (finding.confidence) card.append(element('p', `Confidence: ${finding.confidence}`, 'report-meta'));
    root.append(card);
  }
  const sections = [['Immediate state changes', report.immediateChanges], ['Conditional effects — only if the authorization is accepted', report.conditionalChanges], ['Assets exposed to a later drain', report.potentialExposure]];
  for (const [title, changes] of sections) {
    root.append(element('h2', title));
    if (!changes?.length) { root.append(element('p', 'None observed within analysis coverage.')); continue; }
    const table = element('table');
    const head = element('tr');
    for (const value of ['Asset / change', 'Account / permission', 'Before → After / exposure']) head.append(element('th', value));
    const thead = element('thead'); thead.append(head); table.append(thead);
    const body = element('tbody');
    for (const change of changes) {
      const row = element('tr');
      const detail = change.description || (change.before !== undefined ? `${formatValue(change.before, change, report)} → ${formatValue(change.after, change, report)}` : change.amount ?? 'See full evidence');
      for (const value of [change.asset || change.token || change.kind || change.type, change.account || [change.owner || change.from, change.spender || change.operator || change.to].filter(Boolean).join(' → '), detail]) row.append(element('td', String(value ?? '—')));
      body.append(row);
    }
    table.append(body); const wrapper = element('div', undefined, 'report-table'); wrapper.append(table); root.append(wrapper);
  }
  root.append(element('h2', 'Coverage and assumptions'));
  for (const [label, values] of [['Checked', report.coverage?.checked], ['Missing', report.coverage?.missing], ['Assumptions', report.simulation?.assumptions]]) {
    if (values?.length) { root.append(element('h3', label)); const list = element('ul'); for (const value of values) list.append(element('li', value)); root.append(list); }
  }
  if (report.simulation?.revertReason || report.simulation?.error) root.append(element('p', report.simulation.revertReason || report.simulation.error));
  const raw = element('details'); raw.append(element('summary', 'Full evidence, signature checks and raw report'), element('pre', JSON.stringify(report, null, 2))); root.append(raw);
}
