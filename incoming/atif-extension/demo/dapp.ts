/**
 * Local Demo DApp for Testing the Pre-Execution Transaction Interceptor Prototype.
 * Supports testing all hackathon acceptance criteria A through G.
 */

// Sample EIP-712 Typed Data for Sign Typed Data test
const DEMO_TYPED_DATA = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 1,
    verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  message: {
    owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    value: '1000000000',
    nonce: 0,
    deadline: 1893456000,
  },
};

// Internal debug state tracking
const debugMetrics = {
  providerName: 'Detecting...',
  interceptorStatus: 'Active (MAIN World)',
  pendingRequests: 0,
  analysisStatus: 'IDLE',
  forwardedCalls: 0,
  rejectedCalls: 0,
};

let currentAccount: string | null = null;
let currentChainId: string = '0x1';
let isMockProvider = false;

function getActiveAccount(): string {
  if (currentAccount) return currentAccount;
  currentAccount = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  updateStatusCard();
  return currentAccount;
}

// Mock in-page provider used when MetaMask is not present
class InPageMockEthereumProvider {
  public isMetaMask = true;
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  public async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    debugMetrics.forwardedCalls++;
    updateDebugPanel();

    // Emulate wallet processing
    switch (args.method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [currentAccount ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
      case 'eth_chainId':
        return currentChainId;
      case 'eth_call':
        return '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000'; // "USDC"
      case 'eth_sendTransaction':
        return '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b';
      case 'personal_sign':
        return '0x3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b1c';
      case 'eth_signTypedData_v4':
        return '0x7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b1b';
      case 'eth_sign':
        throw { code: 4200, message: 'Method eth_sign is not supported' };
      default:
        return '0xok';
    }
  }

  public on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }

  public removeListener(event: string, listener: (...args: unknown[]) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== listener);
    }
  }

  public emit(event: string, ...args: unknown[]): void {
    const list = this.listeners[event] || [];
    list.forEach((fn) => fn(...args));
  }
}

function getProvider(): any {
  const win = window as any;
  if (win.ethereum) {
    return win.ethereum;
  }
  // Initialize mock provider if no real provider was injected
  if (!win.__mockEthereum) {
    win.__mockEthereum = new InPageMockEthereumProvider();
    isMockProvider = true;
  }
  return win.__mockEthereum;
}

function updateDebugPanel() {
  const elProvider = document.getElementById('dbg-provider');
  const elInterceptor = document.getElementById('dbg-interceptor');
  const elPending = document.getElementById('dbg-pending');
  const elAnalysis = document.getElementById('dbg-analysis');
  const elForwarded = document.getElementById('dbg-forwarded');
  const elRejected = document.getElementById('dbg-rejected');

  if (elProvider) elProvider.textContent = debugMetrics.providerName;
  if (elInterceptor) elInterceptor.textContent = debugMetrics.interceptorStatus;
  if (elPending) elPending.textContent = debugMetrics.pendingRequests > 0 ? `Active (${debugMetrics.pendingRequests})` : 'None (0)';
  if (elAnalysis) elAnalysis.textContent = debugMetrics.analysisStatus;
  if (elForwarded) elForwarded.textContent = `${debugMetrics.forwardedCalls} calls`;
  if (elRejected) elRejected.textContent = `${debugMetrics.rejectedCalls} rejections`;
}

function updateStatusCard() {
  const provider = getProvider();
  const elProvider = document.getElementById('stat-provider');
  const elAccount = document.getElementById('stat-account');
  const elChain = document.getElementById('stat-chain');
  const elBadge = document.getElementById('connection-status-badge');
  const elConnectBtn = document.getElementById('connect-wallet-btn');

  const providerName = isMockProvider
    ? 'Mock MetaMask Simulator'
    : provider.isMetaMask
    ? 'MetaMask (Injected)'
    : 'window.ethereum';

  debugMetrics.providerName = providerName;

  if (elProvider) elProvider.textContent = providerName;
  if (elAccount) elAccount.textContent = currentAccount ? `${currentAccount.slice(0, 6)}...${currentAccount.slice(-4)}` : 'Not Connected';
  if (elChain) elChain.textContent = `${currentChainId} (${currentChainId === '0x1' ? 'Ethereum Mainnet' : 'Polygon / Other'})`;
  if (elBadge) {
    if (currentAccount) {
      elBadge.textContent = 'Connected';
      elBadge.className = 'badge badge-success';
    } else {
      elBadge.textContent = 'Not Connected';
      elBadge.className = 'badge badge-warning';
    }
  }

  if (elConnectBtn) {
    if (currentAccount) {
      elConnectBtn.textContent = `Connected (${currentAccount.slice(0, 6)}...)`;
      elConnectBtn.className = 'btn btn-secondary';
    } else {
      elConnectBtn.textContent = 'Connect Wallet';
      elConnectBtn.className = 'btn btn-primary';
    }
  }

  updateDebugPanel();
}

function logRequest(method: string, params: unknown) {
  const el = document.getElementById('log-last-request');
  if (el) {
    el.textContent = JSON.stringify(
      {
        method,
        timestamp: new Date().toLocaleTimeString(),
        params,
      },
      null,
      2
    );
  }

  const elResult = document.getElementById('log-last-result');
  if (elResult) {
    elResult.textContent = '⏳ Request sent! Awaiting pre-execution interception & user decision in Side Panel...';
  }

  debugMetrics.pendingRequests++;
  debugMetrics.analysisStatus = 'ANALYZING (In-Flight)';
  updateDebugPanel();
}

function logResult(result: unknown) {
  const el = document.getElementById('log-last-result');
  if (el) {
    el.textContent = `✓ SUCCESS:\n${JSON.stringify(result, null, 2)}`;
  }
  debugMetrics.pendingRequests = Math.max(0, debugMetrics.pendingRequests - 1);
  debugMetrics.analysisStatus = 'COMPLETED (Forwarded)';
  updateDebugPanel();
}

function logError(err: any) {
  const el = document.getElementById('log-last-result');
  if (el) {
    const errorDetails = {
      code: err?.code ?? 'UNKNOWN',
      message: err?.message ?? String(err),
      data: err?.data,
    };
    el.textContent = `✕ REJECTED / ERROR:\n${JSON.stringify(errorDetails, null, 2)}`;
  }

  if (err?.code === 4001) {
    debugMetrics.rejectedCalls++;
  }
  debugMetrics.pendingRequests = Math.max(0, debugMetrics.pendingRequests - 1);
  debugMetrics.analysisStatus = err?.code === 4001 ? 'REJECTED (4001)' : 'ERROR';
  updateDebugPanel();
}

// -------------------------------------------------------------
// Interactive Action Handlers
// -------------------------------------------------------------

// 1. Claim Rewards (eth_sendTransaction)
async function handleClaimRewards() {
  const provider = getProvider();
  const account = getActiveAccount();
  const params = [
    {
      from: account,
      to: '0x000000000000000000000000000000000000dEaD',
      value: '0x0',
      data: '0x379607f5', // claimRewards()
    },
  ];

  logRequest('eth_sendTransaction', params);

  try {
    const res = await provider.request({
      method: 'eth_sendTransaction',
      params,
    });
    logResult(res);
  } catch (err) {
    logError(err);
  }
}

// 2. Sign Message (personal_sign)
async function handleSignMessage() {
  const provider = getProvider();
  const account = getActiveAccount();
  const message = `Welcome to Pre-Execution Interceptor Hackathon Demo!\nTimestamp: ${Date.now()}`;
  const params = [message, account];

  logRequest('personal_sign', params);

  try {
    const res = await provider.request({
      method: 'personal_sign',
      params,
    });
    logResult(res);
  } catch (err) {
    logError(err);
  }
}

// 3. Sign Typed Data (eth_signTypedData_v4)
async function handleSignTypedData() {
  const provider = getProvider();
  const account = getActiveAccount();
  const params = [account, JSON.stringify(DEMO_TYPED_DATA)];

  logRequest('eth_signTypedData_v4', params);

  try {
    const res = await provider.request({
      method: 'eth_signTypedData_v4',
      params,
    });
    logResult(res);
  } catch (err) {
    logError(err);
  }
}

// 4. Send Transaction (eth_sendTransaction)
async function handleSendTransaction() {
  const provider = getProvider();
  const account = getActiveAccount();
  const params = [
    {
      from: account,
      to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      value: '0x5af3107a4000', // 0.0001 ETH
    },
  ];

  logRequest('eth_sendTransaction', params);

  try {
    const res = await provider.request({
      method: 'eth_sendTransaction',
      params,
    });
    logResult(res);
  } catch (err) {
    logError(err);
  }
}

// 5. Normal eth_call (Bypasses Interception)
async function handleEthCall() {
  const provider = getProvider();
  const params = [
    {
      to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      data: '0x95d89b41', // symbol()
    },
    'latest',
  ];

  const el = document.getElementById('log-last-request');
  if (el) {
    el.textContent = JSON.stringify(
      {
        method: 'eth_call',
        note: 'BYPASSES INTERCEPTION: Reads contract directly without signing prompt.',
        params,
      },
      null,
      2
    );
  }

  try {
    const res = await provider.request({
      method: 'eth_call',
      params,
    });
    logResult({
      result: res,
      note: 'eth_call passed through directly without interception.',
    });
  } catch (err) {
    logError(err);
  }
}

// 6. Unsupported Signing Method (eth_sign - Blocked with 4200)
async function handleUnsupportedMethod() {
  const provider = getProvider();
  const params = [currentAccount, '0xdeadbeef1234567890'];

  logRequest('eth_sign', params);

  try {
    const res = await provider.request({
      method: 'eth_sign',
      params,
    });
    logResult(res);
  } catch (err) {
    logError(err);
  }
}

// -------------------------------------------------------------
// Simulation Tools for Acceptance Tests D & E
// -------------------------------------------------------------

function simulateAccountChange() {
  const newAccount =
    currentAccount === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
      ? '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
      : '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  currentAccount = newAccount;
  const provider = getProvider();

  if (typeof provider.emit === 'function') {
    provider.emit('accountsChanged', [newAccount]);
  } else if (typeof (window as any).dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('ethereum#accountsChanged', { detail: [newAccount] }));
  }

  updateStatusCard();
  alert(`Simulated accountsChanged event dispatched with: ${newAccount}\nPending risk reports should now be STALE.`);
}

function simulateChainChange() {
  const newChain = currentChainId === '0x1' ? '0x89' : '0x1'; // Toggle between Mainnet and Polygon
  currentChainId = newChain;
  const provider = getProvider();

  if (typeof provider.emit === 'function') {
    provider.emit('chainChanged', newChain);
  } else if (typeof (window as any).dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('ethereum#chainChanged', { detail: newChain }));
  }

  updateStatusCard();
  alert(`Simulated chainChanged event dispatched with: ${newChain}\nPending risk reports should now be STALE.`);
}

function toggleMockProvider() {
  const win = window as any;
  if (!isMockProvider) {
    win.__savedRealEthereum = win.ethereum;
    win.ethereum = new InPageMockEthereumProvider();
    isMockProvider = true;
  } else {
    win.ethereum = win.__savedRealEthereum || undefined;
    isMockProvider = false;
  }
  updateStatusCard();
  alert(`Provider toggled. Active provider is now: ${debugMetrics.providerName}`);
}

// -------------------------------------------------------------
// Initialize App
// -------------------------------------------------------------

async function handleConnectWallet() {
  const provider = getProvider();
  const elConnectBtn = document.getElementById('connect-wallet-btn');
  if (elConnectBtn) {
    elConnectBtn.textContent = 'Connecting...';
  }
  try {
    const accs = await provider.request({ method: 'eth_requestAccounts' });
    if (Array.isArray(accs) && accs.length > 0) {
      currentAccount = accs[0];
    }
  } catch (err) {
    console.warn('Connect error:', err);
  } finally {
    updateStatusCard();
  }
}

(window as any).connectWallet = handleConnectWallet;

function initDapp() {
  // Bind Action Buttons
  document.getElementById('btn-claim-rewards')?.addEventListener('click', handleClaimRewards);
  document.getElementById('btn-sign-message')?.addEventListener('click', handleSignMessage);
  document.getElementById('btn-sign-typed-data')?.addEventListener('click', handleSignTypedData);
  document.getElementById('btn-send-tx')?.addEventListener('click', handleSendTransaction);
  document.getElementById('btn-eth-call')?.addEventListener('click', handleEthCall);
  document.getElementById('btn-unsupported')?.addEventListener('click', handleUnsupportedMethod);

  // Bind Connect & Clear
  document.getElementById('connect-wallet-btn')?.addEventListener('click', handleConnectWallet);

  document.getElementById('btn-clear-log')?.addEventListener('click', () => {
    const elReq = document.getElementById('log-last-request');
    const elRes = document.getElementById('log-last-result');
    if (elReq) elReq.textContent = 'Cleared.';
    if (elRes) elRes.textContent = 'Cleared.';
  });

  // Bind Simulation Buttons
  document.getElementById('sim-account-change')?.addEventListener('click', simulateAccountChange);
  document.getElementById('sim-chain-change')?.addEventListener('click', simulateChainChange);
  document.getElementById('sim-toggle-mock')?.addEventListener('click', toggleMockProvider);

  // Initial Status Card Setup
  updateStatusCard();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initDapp);
} else {
  initDapp();
}

