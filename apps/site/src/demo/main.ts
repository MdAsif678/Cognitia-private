import '../ui';
import { config, demoDeployed, renderApiStatus } from '../config';

/**
 * Deliberately malicious test dapp. It only sends ordinary EIP-1193 wallet requests; it never calls
 * the analysis API. If the Cognitia extension is installed it intercepts these requests before the
 * wallet opens, exactly as it would on a real phishing site.
 */
type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
};
type ProviderError = Error & { code?: number; data?: { originalError?: { code?: number } } };

const demo = config.demo;
const c = demo.contracts;
const CHAIN_HEX = `0x${demo.chainId.toString(16)}`;
const MAX = 'f'.repeat(64);
const FRIEND = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4df';
const SEL = {
  approve: '0x095ea7b3', transfer: '0xa9059cbb', setApprovalForAll: '0xa22cb465', claim: '0x4e71d92d', claimRewards: '0x372500ab',
  mintToken: '0x40c10f19', mintNft: '0x1249c58b', mintBadges: '0x156e29f6', nonces: '0x7ecebe00',
};
const pad = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (v: bigint) => v.toString(16).padStart(64, '0');
const units = (n: bigint) => n * 10n ** 18n;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const statusLine = $('demo-status');
const log = $('demo-log');

let provider: Provider | null = null;
let account: string | null = null;
let chainId: number | null = null;
let busy = false;
const providers = new Map<string, { provider: Provider; name: string }>();

function write(title: string, data?: unknown) {
  const time = new Date().toLocaleTimeString();
  log.textContent = `[${time}] ${title}${data === undefined ? '' : `\n${JSON.stringify(data, null, 2)}`}\n\n` + log.textContent;
}

function setCheck(id: string, state: 'ok' | 'warn' | 'bad' | '', label: string, text?: string) {
  const pill = $(`chk-${id}`);
  pill.dataset.state = state;
  pill.textContent = label;
  if (text !== undefined) $(`chk-${id}-text`).textContent = text;
}

function explain(error: unknown) {
  const e = error as ProviderError;
  if (e.code === 4001) return 'Request rejected. Nothing was signed or sent.';
  if (e.code === -32002) return 'A wallet request is already open. Check your wallet.';
  if (e.code === 4200) return 'This signing method is blocked by Cognitia because it cannot be analysed safely.';
  return e.message || String(error);
}

// ------------------------------------------------------------------ setup checks

function checkExtension() {
  const active = Boolean((window as unknown as { __cognitiaInterceptor?: { active?: boolean } }).__cognitiaInterceptor?.active);
  $('chk-extension-action').hidden = active;
  if (active) setCheck('extension', 'ok', 'Active', 'Cognitia is watching this page. Every request below is reviewed before your wallet opens.');
  else setCheck('extension', 'bad', 'Missing', 'Not detected. Without it, these offers go straight to your wallet unreviewed. Install it, then reload this tab.');
  return active;
}

function checkContracts() {
  if (demo.faucetUrl) {
    const link = $<HTMLAnchorElement>('faucet-link');
    link.href = demo.faucetUrl;
    link.hidden = false;
  }
  if (demoDeployed) {
    setCheck('contracts', 'ok', 'Deployed', `Our test token, NFTs and two drainer contracts are live on ${demo.chainName}.`);
  } else {
    setCheck('contracts', 'warn', 'Not deployed', 'The demo contracts have not been deployed yet. Run the "Deploy demo contracts to Sepolia" workflow, then republish the site.');
    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => (b.disabled = true));
  }
}

function renderWallet() {
  if (!provider) setCheck('wallet', 'bad', 'No wallet', 'No browser wallet found. Install MetaMask, then reload.');
  else if (!account) setCheck('wallet', '', 'Not connected', `${providerName()} found. Connect a test account.`);
  else setCheck('wallet', 'ok', 'Connected', `${providerName()} · ${account.slice(0, 6)}…${account.slice(-4)}`);
  $('btn-connect').textContent = account ? 'Connected' : 'Connect';

  if (chainId === null) setCheck('network', '', 'Unknown', `The demo contracts live on ${demo.chainName}.`);
  else if (chainId === demo.chainId) setCheck('network', 'ok', demo.chainName, `Connected to ${demo.chainName} (chain ${demo.chainId}).`);
  else setCheck('network', 'warn', 'Wrong network', `Your wallet is on chain ${chainId}. Switch to ${demo.chainName}.`);
  $('btn-switch').hidden = chainId === demo.chainId;
}

function providerName() {
  const select = $<HTMLSelectElement>('wallet-select');
  return providers.get(select.value)?.name ?? 'Browser wallet';
}

const listeners = {
  accountsChanged: (accounts: string[]) => { account = accounts?.[0] ?? null; renderWallet(); },
  chainChanged: (id: string) => { chainId = Number(id); renderWallet(); },
};

async function useProvider(next: Provider | null) {
  if (provider === next) return;
  if (provider) for (const [event, fn] of Object.entries(listeners)) provider.removeListener?.(event, fn);
  provider = next;
  account = null;
  chainId = null;
  if (provider) {
    for (const [event, fn] of Object.entries(listeners)) provider.on?.(event, fn);
    try {
      const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
      account = (accounts as string[])?.[0] ?? null;
      chainId = Number(chain);
    } catch (error) { write('Wallet state unavailable', { message: explain(error) }); }
  }
  renderWallet();
}

function discoverWallets() {
  const select = $<HTMLSelectElement>('wallet-select');
  const add = (id: string, p: Provider, name: string) => {
    if (providers.has(id)) return;
    providers.set(id, { provider: p, name });
    select.append(new Option(name, id));
    select.hidden = providers.size < 2;
    if (!provider) void useProvider(p);
  };
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.provider && detail?.info) add(detail.info.uuid, detail.provider, detail.info.name);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    const injected = (window as unknown as { ethereum?: Provider }).ethereum;
    if (!providers.size && injected) add('legacy', injected, 'Browser wallet');
    if (!providers.size) renderWallet();
  }, 300);
  select.onchange = () => void useProvider(providers.get(select.value)?.provider ?? null);
}

async function connect() {
  if (!provider) throw new Error('No wallet found. Install MetaMask (or another browser wallet), then reload.');
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  account = accounts?.[0] ?? null;
  chainId = Number(await provider.request({ method: 'eth_chainId' }));
  renderWallet();
  if (!account) throw new Error('The wallet did not share an account.');
  return account;
}

async function switchNetwork() {
  if (!provider) throw new Error('Connect a wallet first.');
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (error) {
    const e = error as ProviderError;
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: CHAIN_HEX, chainName: demo.chainName, rpcUrls: [demo.rpcUrl], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, ...(demo.explorerUrl ? { blockExplorerUrls: [demo.explorerUrl] } : {}) }],
    });
  }
  chainId = Number(await provider.request({ method: 'eth_chainId' }));
  renderWallet();
}

async function ready(): Promise<string> {
  const from = account ?? (await connect());
  if (chainId !== demo.chainId) await switchNetwork();
  if (chainId !== demo.chainId) throw new Error(`Switch your wallet to ${demo.chainName} first.`);
  return from;
}

// ------------------------------------------------------------------ requests

type Built = { label: string; request: { method: string; params: unknown[] } };

const tx = (label: string, to: string, data: string) => (from: string): Built => ({
  label, request: { method: 'eth_sendTransaction', params: [{ from, to, data, value: '0x0' }] },
});

async function permit(from: string): Promise<Built> {
  const nonceHex = (await provider!.request({ method: 'eth_call', params: [{ to: c.testToken, data: SEL.nonces + pad(from) }, 'latest'] })) as string;
  const typedData = {
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
    },
    primaryType: 'Permit',
    domain: { name: 'PS2 Test USD', version: '1', chainId: demo.chainId, verifyingContract: c.testToken },
    message: { owner: from, spender: demo.attacker, value: BigInt('0x' + MAX).toString(), nonce: BigInt(nonceHex).toString(), deadline: Math.floor(Date.now() / 1000) + 3600 },
  };
  return { label: 'Gasless voucher (ERC-2612 permit)', request: { method: 'eth_signTypedData_v4', params: [from, JSON.stringify(typedData)] } };
}

const ACTIONS: Record<string, (from: string) => Built[] | Promise<Built[]>> = {
  'mint-token': (from) => [tx('Mint 1,000 pUSD', c.testToken, SEL.mintToken + pad(from) + uint(units(1000n)))(from)],
  'mint-nft': (from) => [tx('Mint a pNFT', c.testNFT, SEL.mintNft)(from)],
  'mint-badges': (from) => [tx('Mint 10 event badges', c.testERC1155, SEL.mintBadges + pad(from) + uint(1n) + uint(10n))(from)],
  airdrop: (from) => [tx('Claim airdrop (unlimited approval)', c.testToken, SEL.approve + pad(demo.attacker) + MAX)(from)],
  eligibility: (from) => [tx('Verify eligibility (approve-all)', c.testNFT, SEL.setApprovalForAll + pad(c.fakeNftRewards) + uint(1n))(from)],
  'claim-nft': (from) => [tx('Claim NFT rewards', c.fakeNftRewards, SEL.claimRewards)(from)],
  stake: (from) => [tx('Stake 500 pUSD (approval)', c.testToken, SEL.approve + pad(c.fakeRewardsDrainer) + uint(units(500n)))(from)],
  'claim-yield': (from) => [tx('Claim staking yield', c.fakeRewardsDrainer, SEL.claim)(from)],
  voucher: async (from) => [await permit(from)],
  badges: (from) => [tx('Collect badges (ERC-1155 approve-all)', c.testERC1155, SEL.setApprovalForAll + pad(demo.attacker) + uint(1n))(from)],
  transfer: (from) => [tx('Send 10 pUSD', c.testToken, SEL.transfer + pad(FRIEND) + uint(units(10n)))(from)],
  revoke: (from) => [
    tx('Revoke pUSD allowance (attacker)', c.testToken, SEL.approve + pad(demo.attacker) + uint(0n))(from),
    tx('Revoke pUSD allowance (staking)', c.testToken, SEL.approve + pad(c.fakeRewardsDrainer) + uint(0n))(from),
    tx('Revoke pNFT approve-all (rewards)', c.testNFT, SEL.setApprovalForAll + pad(c.fakeNftRewards) + uint(0n))(from),
  ],
};

async function runAction(name: string) {
  if (busy) return;
  busy = true;
  document.body.dataset.busy = 'true';
  try {
    const from = await ready();
    const steps = await ACTIONS[name](from);
    for (const step of steps) {
      write(`Request: ${step.label}`, step.request);
      statusLine.textContent = checkExtension()
        ? `${step.label}: held by Cognitia. Read the report in the side panel, then Reject or Continue.`
        : `${step.label}: sent straight to your wallet. Cognitia is not installed, so nothing reviews it.`;
      const result = await provider!.request(step.request);
      write(`Wallet returned: ${step.label}`, { result });
      statusLine.textContent = step.request.method === 'eth_sendTransaction'
        ? `${step.label}: transaction sent (${String(result).slice(0, 12)}…).`
        : `${step.label}: signature produced. This page did not submit it anywhere.`;
    }
  } catch (error) {
    statusLine.textContent = explain(error);
    write('Request stopped', { message: explain(error), code: (error as ProviderError).code });
  } finally {
    busy = false;
    delete document.body.dataset.busy;
  }
}

// ------------------------------------------------------------------ wiring

document.querySelectorAll('[data-chain-name]').forEach((n) => (n.textContent = demo.chainName));
$('btn-connect').addEventListener('click', () => connect().catch((e) => (statusLine.textContent = explain(e))));
$('btn-switch').addEventListener('click', () => switchNetwork().catch((e) => (statusLine.textContent = explain(e))));
$('btn-clear').addEventListener('click', () => (log.textContent = ''));
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.action!)));

checkContracts();
discoverWallets();
// The interceptor marker is set at document_start, but give a slow extension a moment.
checkExtension();
setTimeout(checkExtension, 800);
statusLine.textContent = demoDeployed ? 'Connect a test wallet, mint some assets, then try an offer.' : 'Demo contracts are not deployed yet.';
void renderApiStatus();
