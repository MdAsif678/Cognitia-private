import { WalletSession } from './wallet.mjs';

let CONFIG;
let userAccount = null;
let busy = false;
const wallet = new WalletSession({ chainId: 31337, chainName: 'Aurum Local PS2', rpcUrl: 'http://127.0.0.1:8545', onChange: state => {
  userAccount = state.account;
  const addr = document.getElementById('wallet-address');
  if (addr) addr.textContent = state.account ?? 'Not connected';
  const button = document.getElementById('btn-connect');
  if (button) button.textContent = state.account ? `${state.account.slice(0, 6)}…${state.account.slice(-4)}` : 'Connect Wallet';
  const network = document.getElementById('network-id');
  if (network) network.textContent = state.chain ? `${state.chain}${state.chain === 31337 ? ' (Aurum Local)' : ' — switch required'}` : 'Not connected';
}});
function showError(error) {
  const message = error.code === 4001 ? 'Request rejected. Nothing was signed.' : error.code === -32002 ? 'A wallet request is already open. Check MetaMask.' : error.message || String(error);
  document.getElementById('demo-status').textContent = message;
  logToConsole('Request stopped', { message });
}
async function connectWallet() {
  try { if (!wallet.provider && window.ethereum) wallet.use(window.ethereum); await wallet.connect(); }
  catch (error) { showError(error); }
}
async function switchToAnvil() {
  try { await wallet.ensureLocal(); } catch (error) { showError(error); }
}
async function rpc(method, params = []) {
  const response = await fetch(CONFIG.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
async function context() {
  if (!CONFIG) throw new Error('Demo deployment is missing. Run npm run dev:demo from the repository root.');
  const chain = Number(await rpc('eth_chainId'));
  if (chain !== 31337) throw new Error('Demo RPC must be local chain 31337.');
  if (!wallet.provider && window.ethereum) wallet.use(window.ethereum);
  const account = await wallet.ensureLocal();
  return { account, chainId: 31337 };
}
async function runRequest(build) {
  if (busy) return;
  busy = true;
  const status = document.getElementById('demo-status');
  try {
    const ctx = await context();
    const provider = wallet.provider;
    const request = await build(ctx);
    const target = request.method === 'eth_sendTransaction' ? request.params[0].to : CONFIG.contracts.testToken;
    if (target && await rpc('eth_getCode', [target, 'latest']) === '0x') throw new Error('Demo contracts are not deployed on this chain. Restart npm run dev:demo.');
    // Ordinary dapp request. Only the extension analyzes and owns the signing decision.
    await wallet.refresh();
    if (provider !== wallet.provider || wallet.account?.toLowerCase() !== ctx.account.toLowerCase() || wallet.chain !== ctx.chainId) throw new Error('Wallet context changed. Try the request again.');
    logToConsole('Wallet request', request);
    status.textContent = 'Wallet request pending. Open the Cognitia extension to review its simulation and risk report.';
    const result = await provider.request(request);
    logToConsole('Wallet returned', { result });
    status.textContent = request.method === 'eth_sendTransaction' ? `Wallet returned transaction hash: ${result}` : 'Wallet produced a signature. It has not been submitted on-chain by this page.';
  } catch (error) { showError(error); }
  finally { busy = false; }
}

// Selectors
const SELECTORS = {
  approve: "0x095ea7b3",
  transfer: "0xa9059cbb",
  setApprovalForAll: "0xa22cb465",
  claim: "0x4e71d92d",
  mint: "0x1249c58b",
  mintTo: "0x449a52f8"
};

function pad32Address(addr) {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

function pad32Uint(hexOrDec) {
  if (typeof hexOrDec === "bigint" || typeof hexOrDec === "number") {
    return hexOrDec.toString(16).padStart(64, "0");
  }
  return hexOrDec.replace("0x", "").padStart(64, "0");
}

function pad32Bool(val) {
  return (val ? "1" : "0").padStart(64, "0");
}

function logToConsole(title, data) {
  const pre = document.getElementById("inspector-output");
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${title}\n` + JSON.stringify(data, null, 2) + "\n\n";
  pre.textContent = entry + pre.textContent;
}

function sendTx(to, data, value = '0x0') {
  return runRequest(async ({ account }) => ({ method: 'eth_sendTransaction', params: [{ from: account, to, data, value, chainId: '0x7a69' }] }));
}

// ----------------------------------------------------
// ATTACK SCENARIOS
// ----------------------------------------------------

// Attack 1: Unlimited ERC-20 Approval to Attacker
function triggerAttack1_TokenApproval() {
  const maxUint256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const calldata = SELECTORS.approve + pad32Address(CONFIG.attacker) + maxUint256;

  logToConsole("Payload: Unlimited ERC-20 Approval", {
    target: CONFIG.contracts.testToken,
    spender: CONFIG.attacker,
    amount: "MaxUint256",
    calldata: calldata,
    expectedSeverity: "HIGH / CRITICAL",
    riskReason: "Grants unlimited allowance over your pUSD balance to an unverified address"
  });

  sendTx(CONFIG.contracts.testToken, calldata);
}

// Attack 2: Collection-Wide NFT Operator Approval to Attacker
function triggerAttack2_NFTApproval() {
  const calldata = SELECTORS.setApprovalForAll + pad32Address(CONFIG.attacker) + pad32Bool(true);

  logToConsole("Payload: Malicious setApprovalForAll", {
    target: CONFIG.contracts.testNFT,
    operator: CONFIG.attacker,
    approved: true,
    calldata: calldata,
    expectedSeverity: "HIGH / CRITICAL",
    riskReason: "Grants operator rights to transfer ALL current and future NFTs in this collection"
  });

  sendTx(CONFIG.contracts.testNFT, calldata);
}

// Attack 3: Direct Drain via claim()
function triggerAttack3_DirectDrain() {
  const calldata = SELECTORS.claim;

  logToConsole("Payload: Direct Drain claim()", {
    target: CONFIG.contracts.fakeRewardsDrainer,
    function: "claim()",
    calldata: calldata,
    expectedSeverity: "CRITICAL",
    riskReason: "Misleading function name. Internally calls transferFrom() to steal pre-approved tokens"
  });

  sendTx(CONFIG.contracts.fakeRewardsDrainer, calldata);
}

// Attack 4: Gasless Voucher (ERC-2612 Permit Signature)
function triggerAttack4_PermitSignature() {
  return runRequest(async ({ account }) => {
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    const deadline = Number(BigInt(block.timestamp)) + 3600;
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    },
    primaryType: "Permit",
    domain: {
      name: "PS2 Test USD",
      version: "1",
      chainId: 31337,
      verifyingContract: CONFIG.contracts.testToken
    },
    message: {
      owner: account,
      spender: CONFIG.attacker,
      value: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      nonce: BigInt(await rpc('eth_call', [{ to: CONFIG.contracts.testToken, data: '0x7ecebe00' + pad32Address(account) }, 'latest'])).toString(),
      deadline: deadline
    }
  };

    return { method: 'eth_signTypedData_v4', params: [account, JSON.stringify(typedData)] };
  });
}

// Attack 5: ERC-1155 Operator Approval
function triggerAttack5_ERC1155Approval() {
  const calldata = SELECTORS.setApprovalForAll + pad32Address(CONFIG.attacker) + pad32Bool(true);

  logToConsole("Payload: ERC-1155 setApprovalForAll", {
    target: CONFIG.contracts.testERC1155,
    operator: CONFIG.attacker,
    approved: true,
    calldata: calldata,
    expectedSeverity: "HIGH",
    riskReason: "Grants batch operator approval over all multi-token assets"
  });

  sendTx(CONFIG.contracts.testERC1155, calldata);
}

// ----------------------------------------------------
// BENIGN SCENARIOS
// ----------------------------------------------------

// Benign 1: Safe Transfer of 10 pUSD
function triggerBenign_Transfer() {
  const friend = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4df";
  const amount = (10n * 10n ** 18n).toString(16);
  const calldata = SELECTORS.transfer + pad32Address(friend) + pad32Uint(amount);

  logToConsole("Payload: Safe Token Transfer", {
    target: CONFIG.contracts.testToken,
    recipient: friend,
    amount: "10 pUSD",
    calldata: calldata,
    expectedSeverity: "LOW",
    riskReason: "Normal token transfer with verified recipient and limited balance change"
  });

  sendTx(CONFIG.contracts.testToken, calldata);
}

// Benign 2: Revoke Approval (set to 0)
function triggerBenign_Revoke() {
  const calldata = SELECTORS.approve + pad32Address(CONFIG.attacker) + pad32Uint(0);

  logToConsole("Payload: Revoke Approval", {
    target: CONFIG.contracts.testToken,
    spender: CONFIG.attacker,
    amount: "0",
    calldata: calldata,
    expectedSeverity: "LOW",
    riskReason: "Reduces spender allowance to 0. Safe security action."
  });

  sendTx(CONFIG.contracts.testToken, calldata);
}

// Faucet: Mint 1,000 pUSD & 1 NFT to connected wallet
function triggerFaucet() {
  return runRequest(async ({ account }) => ({ method: 'eth_sendTransaction', params: [{ from: account, to: CONFIG.contracts.testToken, data: '0x40c10f19' + pad32Address(account) + pad32Uint(1000n * 10n ** 18n), value: '0x0', chainId: '0x7a69' }] }));
}

// Bind functions to window so inline HTML onclick handlers work 100% reliably
window.connectWallet = connectWallet;
window.switchToAnvil = switchToAnvil;
window.triggerAttack1_TokenApproval = triggerAttack1_TokenApproval;
window.triggerAttack2_NFTApproval = triggerAttack2_NFTApproval;
window.triggerAttack3_DirectDrain = triggerAttack3_DirectDrain;
window.triggerAttack4_PermitSignature = triggerAttack4_PermitSignature;
window.triggerAttack5_ERC1155Approval = triggerAttack5_ERC1155Approval;
window.triggerBenign_Transfer = triggerBenign_Transfer;
window.triggerBenign_Revoke = triggerBenign_Revoke;
window.triggerFaucet = triggerFaucet;

// Event Listeners Initialization
async function initEventListeners() {
  document.getElementById('clear-log').onclick = () => { document.getElementById('inspector-output').textContent = ''; };
  await initializeDemo();
  if (!CONFIG) { for (const button of document.querySelectorAll('[id^="btn-attack"], [id^="btn-benign"], #btn-faucet')) button.disabled = true; }
  document.getElementById("btn-connect")?.addEventListener("click", connectWallet);
  document.getElementById("btn-switch-network")?.addEventListener("click", switchToAnvil);
  
  document.getElementById("btn-attack-1")?.addEventListener("click", triggerAttack1_TokenApproval);
  document.getElementById("btn-attack-2")?.addEventListener("click", triggerAttack2_NFTApproval);
  document.getElementById("btn-attack-3")?.addEventListener("click", triggerAttack3_DirectDrain);
  document.getElementById("btn-attack-4")?.addEventListener("click", triggerAttack4_PermitSignature);
  document.getElementById("btn-attack-5")?.addEventListener("click", triggerAttack5_ERC1155Approval);

  document.getElementById("btn-benign-1")?.addEventListener("click", triggerBenign_Transfer);
  document.getElementById("btn-benign-2")?.addEventListener("click", triggerBenign_Revoke);
  document.getElementById("btn-faucet")?.addEventListener("click", triggerFaucet);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initEventListeners);
} else {
  initEventListeners();
}

// The extension injects a MAIN-world marker as soon as its content script runs. Without it every
// offer below goes straight to the wallet with no review, which otherwise looks like normal
// behaviour, so say so plainly instead of letting the testbed appear to work.
function reportInterceptor() {
  const status = document.getElementById('demo-status');
  const active = Boolean(window.__cognitiaInterceptor?.active);
  status.dataset.interceptor = active ? 'active' : 'missing';
  status.textContent = active
    ? 'Testbed ready and Cognitia is watching this page. Connect your local test wallet, then choose an offer. Simulation and risk review happen in the extension.'
    : 'Cognitia is NOT watching this page, so offers will go straight to your wallet unreviewed. Load the extension at chrome://extensions, then reload this page. A tab opened before the extension was loaded never receives it.';
}

async function initializeDemo() {
  const providers = new Map();
  const select = document.getElementById('wallet-select');
  const add = (provider, id, name) => {
    if (providers.has(id)) return;
    providers.set(id, provider);
    const option = document.createElement('option');
    option.value = id; option.textContent = name; select.append(option);
    if (!wallet.provider) wallet.use(provider);
  };
  window.addEventListener('eip6963:announceProvider', event => {
    if (event.detail?.provider && event.detail?.info) add(event.detail.provider, event.detail.info.uuid, event.detail.info.name);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  if (!providers.size && window.ethereum) add(window.ethereum, 'legacy', 'Browser wallet');
  select.onchange = () => { wallet.use(providers.get(select.value)); wallet.refresh().catch(showError); };
  wallet.refresh().catch(showError);
  try {
    const response = await fetch('deployment.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Run npm run dev:demo to deploy and seed the testbed.');
    CONFIG = await response.json();
    wallet.rpcUrl = CONFIG.rpcUrl;
    document.getElementById('rpc-endpoint').textContent = CONFIG.rpcUrl;
    const oldAddresses = { '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6': CONFIG.contracts.testToken, '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318': CONFIG.contracts.testNFT, '0x610178dA211FEF7D417bC0e6FeD39F05609AD788': CONFIG.contracts.testERC1155, '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e': CONFIG.contracts.fakeRewardsDrainer };
    for (const node of document.querySelectorAll('.hood-rows dd')) for (const [old, address] of Object.entries(oldAddresses)) if (node.textContent.includes(old)) node.textContent = node.textContent.replace(old, address);
    if (CONFIG.chainId !== 31337) throw new Error('Only local demo deployments are supported by this testbed.');
    reportInterceptor();
  } catch (error) { showError(error); }
}
