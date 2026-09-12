import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

// Real unpacked MV3 extension + live analysis API. Only the wallet is a test
// double: it records forwarding and cannot sign or broadcast transactions.
const deployment = JSON.parse(await readFile('incoming/ps2-project/demo/deployment.json', 'utf8'));
const dappUrl = process.env.DEMO_WEB_URL ?? 'http://localhost:3000';
const extensionPath = resolve('incoming/atif-extension/dist');
const profile = await mkdtemp(join(tmpdir(), 'cognitia-chromium-'));
const artifacts = resolve('artifacts/extension-e2e');
await mkdir(artifacts, { recursive: true });
let context;
async function upstreamBlock() {
  const response = await fetch(deployment.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  return (await response.json()).result;
}
try {
  const blockBefore = await upstreamBlock();
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const site = await context.newPage();
  await site.addInitScript(({ account }) => {
    const calls = [];
    const provider = {
      on() {}, removeListener() {},
      async request(request) {
        if (['eth_accounts', 'eth_requestAccounts'].includes(request.method)) return [account];
        if (request.method === 'eth_chainId') return '0x7a69';
        calls.push(structuredClone(request));
        return '0x' + '55'.repeat(32);
      },
    };
    window.__walletCalls = calls;
    window.ethereum = provider;
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
      info: { uuid: 'cognitia-e2e-wallet', name: 'Test wallet (no signing)', icon: '', rdns: 'test.cognitia' }, provider,
    } })));
  }, { account: deployment.testWallet });
  const siteAnalysisCalls = [];
  site.on('request', request => { if (request.url().includes('/v1/analyze')) siteAnalysisCalls.push(request.url()); });
  await site.goto(dappUrl);
  await expect(site.locator('#demo-status')).toContainText('Testbed ready');
  await site.locator('#btn-connect').click();
  await expect(site.locator('#wallet-address')).toHaveText(deployment.testWallet);
  await expect(site.locator('dialog')).toHaveCount(0);
  await expect(site.locator('#preview-only')).toHaveCount(0);
  // This is the actual packaged extension document, with real chrome.runtime and
  // chrome.storage APIs; no mocked messages or fixture reports are injected.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 860 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
  await expect(panel.locator('.idle')).toBeVisible();
  await panel.screenshot({ path: join(artifacts, 'idle.png') });
  const cases = [
    ['unlimited-erc20', '#btn-attack-1', 'high'], ['nft-operator', '#btn-attack-2', 'high'],
    ['hidden-drain', '#btn-attack-3', 'critical'], ['permit', '#btn-attack-4', 'high'],
    ['erc1155-operator', '#btn-attack-5', 'high'], ['transfer', '#btn-benign-1', 'low'],
    ['revoke', '#btn-benign-2', 'low'],
  ];
  for (const [name, button, severity] of cases) {
    await site.locator(button).click();
    const report = panel.locator('#risk-report-container');
    await expect(report).toHaveAttribute('data-severity', severity, { timeout: 60000 });
    assert.equal(await worker.evaluate(async () => (await chrome.windows.getAll()).filter(w => w.type === 'popup').length), 0, 'Review must not create a separate window');
    assert.equal(await site.evaluate(() => window.__walletCalls.length), 0, `${name}: request reached wallet before approval`);
    await expect(panel.locator('#section-summary')).toBeVisible();
    if (name === 'hidden-drain') {
      await expect(panel.locator('#section-summary')).toContainText('500 pUSD');
      await expect(panel.locator('#section-immediate-effects')).toContainText('999,500 pUSD');
    }
    if (name === 'permit') {
      await expect(panel.locator('#section-conditional-effects')).toContainText('Unlimited');
      await expect(panel.locator('#section-conditional-effects')).toContainText('1,000,000 pUSD');
    }
    await panel.screenshot({ path: join(artifacts, `${name}.png`) });
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Extension must fit its viewport');
    if (name === 'hidden-drain') {
      await panel.setViewportSize({ width: 320, height: 740 });
      await panel.screenshot({ path: join(artifacts, 'critical-narrow.png') });
      assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await panel.setViewportSize({ width: 420, height: 860 });
    }
    // Reject each scenario through the extension UI; the dapp gets EIP-1193 4001.
    await panel.locator('#btn-reject').click();
    await expect(site.locator('#demo-status')).toHaveText('Request rejected. Nothing was signed.');
    assert.equal(await site.evaluate(() => window.__walletCalls.length), 0);
    console.log(`${name}: ${severity}; extension report shown; rejected before wallet`);
  }
  // A benign request is released exactly once through the extension's Continue.
  await site.locator('#btn-benign-1').click();
  await expect(panel.locator('#risk-report-container')).toHaveAttribute('data-severity', 'low', { timeout: 60000 });
  const snapshot = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_REQUEST' })).snapshot);
  assert.equal(await site.evaluate(() => window.__walletCalls.length), 0);
  await panel.locator('#btn-continue-metamask').click();
  await expect(site.locator('#demo-status')).toContainText('Wallet returned transaction hash');
  const forwarded = await site.evaluate(() => window.__walletCalls);
  assert.deepEqual(forwarded, [{ method: snapshot.method, params: snapshot.rawParams }]);
  assert.equal(siteAnalysisCalls.length, 0, 'The dapp must never call the analysis API');
  assert.equal(await upstreamBlock(), blockBefore, 'Simulation must not mine upstream');
  console.log('All seven extension scenarios passed; Continue forwarded once; dapp made zero analysis calls; source chain unchanged.');
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
