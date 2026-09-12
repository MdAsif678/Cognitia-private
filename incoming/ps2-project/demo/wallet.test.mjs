import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletSession } from './wallet.mjs';
const account = '0x1111111111111111111111111111111111111111';
function setup(options = {}) {
  const calls = [], events = {};
  let chain = options.chain ?? '0x7a69';
  const provider = { on: (name, fn) => events[name] = fn, removeListener: () => {}, request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === 'eth_requestAccounts' && options.reject) throw { code: 4001, message: 'Rejected' };
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') { if (options.switchReject) throw { code: 4001 }; chain = params[0].chainId; }
  } };
  const wallet = new WalletSession({ chainId: 31337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545' });
  wallet.use(provider);
  return { wallet, calls, events };
}
test('rejected connection never fabricates an account', async () => { const { wallet } = setup({ reject: true }); await assert.rejects(wallet.connect()); assert.equal(wallet.account, null); });
test('connect double click requests accounts once', async () => { const { wallet, calls } = setup(); await Promise.all([wallet.connect(), wallet.connect()]); assert.equal(calls.filter(c => c.method === 'eth_requestAccounts').length, 1); assert.equal(wallet.account, account); });
test('locked wallet clears the account', async () => { const { wallet, events } = setup(); await wallet.connect(); events.accountsChanged([]); assert.equal(wallet.account, null); });
test('network switch completes and is verified before signing', async () => { const { wallet, calls } = setup({ chain: '0x1' }); await wallet.ensureLocal(); assert.equal(wallet.chain, 31337); assert.ok(calls.some(c => c.method === 'wallet_switchEthereumChain')); assert.ok(!calls.some(c => c.method === 'eth_sendTransaction')); });
test('rejected network switch stops the request', async () => { const { wallet } = setup({ chain: '0x1', switchReject: true }); await assert.rejects(wallet.ensureLocal()); assert.equal(wallet.chain, 1); });
test('no provider never looks connected', async () => { const wallet = new WalletSession({ chainId: 31337 }); await assert.rejects(wallet.connect(), /No wallet/); assert.equal(wallet.account, null); });
test('a late chain response cannot replace the newly selected wallet state', async () => {
  let resolveChain;
  let requestedChain;
  const chainRequested = new Promise(resolve => { requestedChain = resolve; });
  const old = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts') return [account];
    requestedChain();
    return new Promise(resolve => { resolveChain = resolve; });
  } };
  const wallet = new WalletSession({ chainId: 31337 });
  wallet.use(old);
  const pending = wallet.connect();
  const rejected = assert.rejects(pending, /Wallet changed/);
  await chainRequested;
  const newAccount = '0x2222222222222222222222222222222222222222';
  wallet.use({ request: async ({ method }) => method === 'eth_chainId' ? '0x7a69' : [newAccount] });
  await wallet.connect();
  resolveChain('0x1');
  await rejected;
  assert.equal(wallet.account, newAccount);
  assert.equal(wallet.chain, 31337);
});
test('disconnect during a network switch never yields an authorized account', async () => {
  const wallet = new WalletSession({ chainId: 31337 });
  let chain = '0x1';
  let connected = true;
  wallet.use({ request: async ({ method }) => {
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') { chain = '0x7a69'; connected = false; return; }
    return connected ? [account] : [];
  } });
  await assert.rejects(wallet.ensureLocal(), /disconnected/);
  assert.equal(wallet.account, null);
});
