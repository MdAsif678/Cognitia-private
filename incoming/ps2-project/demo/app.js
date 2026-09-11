// PS2 Demo DApp - Attack Scenarios & Transaction Inspector
// Designed for testing pre-execution wallet interceptor and simulation engine

const CONFIG = {
  chainId: 31337,
  chainHex: "0x7a69",
  chainName: "Anvil Local PS2",
  rpcUrl: "http://127.0.0.1:8545",
  attacker: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  // Addresses from deploying DeployAll.s.sol at deployer nonce 8 (see incoming/integration/syed-local.json).
  contracts: {
    testToken: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    testNFT: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    testERC1155: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    fakeRewardsDrainer: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e"
  }
};

let userAccount = null;

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

// Connect Wallet
async function connectWallet() {
  userAccount = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const addrElem = document.getElementById("wallet-address");
  const connBtn = document.getElementById("btn-connect");

  if (window.ethereum) {
    try {
      const accounts = await Promise.race([
        window.ethereum.request({ method: "eth_accounts" }),
        new Promise((res) => setTimeout(() => res([]), 1000))
      ]);
      if (Array.isArray(accounts) && accounts.length > 0) {
        userAccount = accounts[0];
      } else {
        const reqAccounts = await Promise.race([
          window.ethereum.request({ method: "eth_requestAccounts" }),
          new Promise((res) => setTimeout(() => res([]), 2000))
        ]);
        if (Array.isArray(reqAccounts) && reqAccounts.length > 0) {
          userAccount = reqAccounts[0];
        }
      }
    } catch (err) {
      console.warn("Wallet request failed, using default account:", err);
    }
  }

  if (addrElem) addrElem.textContent = userAccount;
  if (connBtn) connBtn.textContent = "Connected: " + userAccount.slice(0, 6) + "..." + userAccount.slice(-4);
  logToConsole("Wallet Active", { account: userAccount });
}

// Switch to Anvil network
async function switchToAnvil() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CONFIG.chainHex }]
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CONFIG.chainHex,
            chainName: CONFIG.chainName,
            rpcUrls: [CONFIG.rpcUrl, "http://127.0.0.1:8545"],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
          }]
        });
      } catch (addError) {
        console.error("Failed to add network:", addError);
      }
    }
  }
}

// Helper to send transaction through provider
async function sendTx(to, data, value = "0x0") {
  if (!userAccount) {
    userAccount = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  }

  const txParams = {
    from: userAccount,
    to: to,
    data: data,
    value: value
  };

  logToConsole("⚡ Sending Transaction to Provider (Ready for Interception)", txParams);

  if (window.ethereum) {
    try {
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [txParams]
      });
      logToConsole("Transaction Forwarded / Mined", { txHash });
    } catch (err) {
      logToConsole("Transaction Result / Interception", {
        code: err.code,
        message: err.message
      });
      if (err.code === 4001) {
        alert("🛑 Transaction Rejected by User or Interceptor (Code 4001).");
      } else {
        alert("Error: " + (err.message || JSON.stringify(err)));
      }
    }
  } else {
    alert("⚡ Payload logged to console! (No Web3 provider found in current tab. Load Cognitia Extension to intercept live requests).");
  }
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
async function triggerAttack4_PermitSignature() {
  if (!userAccount) {
    await connectWallet();
    if (!userAccount) return;
  }

  const currentChainId = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

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
      chainId: currentChainId,
      verifyingContract: CONFIG.contracts.testToken
    },
    message: {
      owner: userAccount,
      spender: CONFIG.attacker,
      value: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      nonce: 0,
      deadline: deadline
    }
  };

  logToConsole("Payload: eth_signTypedData_v4 (ERC-2612 Permit)", {
    method: "eth_signTypedData_v4",
    typedData: typedData,
    expectedSeverity: "HIGH / CRITICAL",
    riskReason: "Signs an off-chain permit granting unlimited spending authority without an on-chain approval tx"
  });

  try {
    const sig = await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [userAccount, JSON.stringify(typedData)]
    });
    logToConsole("Permit Signature Produced", { signature: sig });
    alert("Permit signed: " + sig.slice(0, 18) + "...");
  } catch (err) {
    logToConsole("Signature Error or Interception", { error: err.message, code: err.code });
    if (err.code === 4001) {
      alert("🛑 Signature request rejected (Code 4001).");
    }
  }
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
  if (!userAccount) {
    userAccount = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  }
  const amount = (1000n * 10n ** 18n).toString(16);
  const mintTokenCalldata = "0x40c10f19" + pad32Address(userAccount) + pad32Uint(amount);

  logToConsole("Faucet: Minting 1,000 pUSD", { calldata: mintTokenCalldata });
  sendTx(CONFIG.contracts.testToken, mintTokenCalldata);
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
function initEventListeners() {
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
