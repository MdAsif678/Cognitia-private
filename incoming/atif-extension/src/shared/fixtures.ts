/**
 * Real AnalysisReport and PendingRequestSnapshot test fixtures.
 * Covers all 6 required verification profiles:
 * 1. benign transfer
 * 2. NFT setApprovalForAll
 * 3. unlimited ERC20 approval
 * 4. reverted transaction
 * 5. conditional permit
 * 6. failed analysis
 */

import { AnalysisReport, HexAddress } from './api-contract';
import { PendingRequestSnapshot, AnalysisResult } from './types';
import { mapReportToAnalysisResult } from '../background/analyzer';

export interface FixtureScenario {
  readonly id: string;
  readonly name: string;
  readonly snapshot: PendingRequestSnapshot;
  readonly report: AnalysisReport;
  readonly analysis: AnalysisResult;
}

const TEST_ACCOUNT: HexAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_SPENDER: HexAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const DRAINER_OPERATOR: HexAddress = '0x1337BEEF00000000000000000000000000000001';
const UNVERIFIED_CONTRACT: HexAddress = '0x5555555555555555555555555555555555555555';
const NUSD_CONTRACT: HexAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const VAPE_CONTRACT: HexAddress = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';

// =============================================================
// 1. Benign Transfer
// =============================================================
export const benignTransferReport: AnalysisReport = {
  requestId: 'req_fixture_benign_transfer',
  requestHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  status: 'complete',
  severity: 'low',
  summary: 'Safe direct transfer of 0.05 ETH to a verified recipient. No drainer or malicious pattern detected.',
  fork: {
    chainId: 1,
    blockNumber: '0x12d4a8f',
    blockHash: '0xabc1230000000000000000000000000000000000000000000000000000000001',
  },
  simulation: {
    mode: 'transaction',
    outcome: 'success',
    assumptions: [],
  },
  findings: [
    {
      id: 'verified-recipient',
      severity: 'low',
      title: 'Verified Destination Address',
      description: 'Recipient is a known regular address with clean historical on-chain activity.',
      explanation: 'Destination address is an active EOA with prior transaction history and no flagged malicious associations.',
      evidence: `Recipient: ${TEST_SPENDER} (Nonce: 42, 0 drain reports)`,
      confidence: 'High (98%)',
    },
  ],
  immediateChanges: [
    {
      type: 'native_transfer',
      asset: 'ETH',
      from: TEST_ACCOUNT,
      to: TEST_SPENDER,
      amount: '0.05 ETH',
    },
  ],
  potentialExposure: [],
  coverage: {
    checked: [
      'balance_solvency',
      'known_drainer_addresses',
      'token_allowances',
      'contract_verification',
      'signature_replay',
    ],
    missing: [],
  },
  evidence: {
    gasUsed: '21000',
    effectiveGasPrice: '15 Gwei',
    baseFee: '12 Gwei',
    stateTrace: 'SSTORE 0x7099... balance +0.05 ETH',
  },
};

export const benignTransferSnapshot: PendingRequestSnapshot = {
  requestId: 'req_fixture_benign_transfer',
  timestamp: 1726084800000,
  origin: 'https://app.lumaswap.io',
  method: 'eth_sendTransaction',
  rawParams: [
    {
      from: TEST_ACCOUNT,
      to: TEST_SPENDER,
      value: '0xb1a2bc2ec50000', // 0.05 ETH
    },
  ],
  chainId: '0x1',
  account: TEST_ACCOUNT,
  providerInfo: { name: 'MetaMask' },
  status: 'ANALYSIS_READY',
  analysis: mapReportToAnalysisResult(benignTransferReport, 'req_fixture_benign_transfer'),
};

// =============================================================
// 2. NFT setApprovalForAll
// =============================================================
export const nftApprovalReport: AnalysisReport = {
  requestId: 'req_fixture_nft_approval',
  requestHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
  status: 'complete',
  severity: 'critical',
  summary: 'CRITICAL: Malicious operator approval detected. Calling setApprovalForAll grants full unrestricted transfer power over all NFTs in this collection.',
  fork: {
    chainId: 1,
    blockNumber: '0x12d4a90',
    blockHash: '0xabc1230000000000000000000000000000000000000000000000000000000002',
  },
  simulation: {
    mode: 'transaction',
    outcome: 'success',
    assumptions: [],
  },
  findings: [
    {
      id: 'drainer-operator',
      severity: 'critical',
      title: 'Drainer Operator Approval (setApprovalForAll)',
      description: 'Grants operator full authority to transfer all tokens in the VaultApes collection without further user confirmation.',
      explanation: 'setApprovalForAll grants the operator address the authority to transfer all tokens owned by you in the contract. The operator address has been flagged in drainer intelligence databases.',
      evidence: `Method: setApprovalForAll(operator=${DRAINER_OPERATOR}, approved=true) on VAPE (${VAPE_CONTRACT})`,
      confidence: 'Definitive (99%)',
    },
  ],
  immediateChanges: [
    {
      type: 'set_approval_for_all',
      asset: 'Vault Apes (VAPE)',
      from: TEST_ACCOUNT,
      spender: DRAINER_OPERATOR,
      amount: 'All NFTs in Collection',
    },
  ],
  potentialExposure: [
    {
      kind: 'operator_privilege',
      asset: 'Vault Apes (VAPE)',
      amount: 'All tokens owned by account',
      description: 'Operator can call transferFrom on any of your current or future NFTs in this contract at any time without further approval.',
    },
  ],
  coverage: {
    checked: [
      'balance_solvency',
      'known_drainer_addresses',
      'token_allowances',
      'operator_privileges',
      'contract_verification',
    ],
    missing: [],
  },
  evidence: {
    targetContract: VAPE_CONTRACT,
    calldataSelector: '0xa2205460 (setApprovalForAll)',
    operatorFlagged: 'Phishing Drainer Database: Blacklist ID #9821',
    simulatedEvent: 'ApprovalForAll(owner=0xf39F..., operator=0x1337..., approved=true)',
  },
};

export const nftApprovalSnapshot: PendingRequestSnapshot = {
  requestId: 'req_fixture_nft_approval',
  timestamp: 1726084810000,
  origin: 'https://mint-vaultapes-airdrop.xyz',
  method: 'eth_sendTransaction',
  rawParams: [
    {
      from: TEST_ACCOUNT,
      to: VAPE_CONTRACT,
      data: `0xa2205460000000000000000000000000${DRAINER_OPERATOR.slice(2)}0000000000000000000000000000000000000000000000000000000000000001`,
    },
  ],
  chainId: '0x1',
  account: TEST_ACCOUNT,
  providerInfo: { name: 'MetaMask' },
  status: 'ANALYSIS_READY',
  analysis: mapReportToAnalysisResult(nftApprovalReport, 'req_fixture_nft_approval'),
};

// =============================================================
// 3. Unlimited ERC20 Approval
// =============================================================
export const unlimitedErc20ApprovalReport: AnalysisReport = {
  requestId: 'req_fixture_unlimited_erc20',
  requestHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
  status: 'complete',
  severity: 'high',
  summary: 'High risk: Unlimited ERC20 allowance request. Grants spender permanent approval to drain up to 2^256 - 1 NUSD.',
  fork: {
    chainId: 1,
    blockNumber: '0x12d4a91',
    blockHash: '0xabc1230000000000000000000000000000000000000000000000000000000003',
  },
  simulation: {
    mode: 'transaction',
    outcome: 'success',
    assumptions: [],
  },
  findings: [
    {
      id: 'unlimited-approval',
      severity: 'high',
      title: 'Unlimited Token Approval (MaxUint256)',
      description: 'The transaction approves the maximum possible allowance (2^256-1) to an external spender address.',
      explanation: 'The contract request approves the maximum possible allowance. If the spender contract is exploited or malicious, your entire token balance can be confiscated.',
      evidence: `Spender: ${TEST_SPENDER}, Approved: 115792089237316195423570985008687907853269984665640564039457584007913129639935 (MaxUint256)`,
      confidence: 'High (95%)',
    },
  ],
  immediateChanges: [
    {
      type: 'erc20_approve',
      asset: 'Nova USD (NUSD)',
      from: TEST_ACCOUNT,
      spender: TEST_SPENDER,
      amount: 'Unlimited (MaxUint256)',
    },
  ],
  potentialExposure: [
    {
      kind: 'token_allowance',
      asset: 'Nova USD (NUSD)',
      amount: 'Unlimited ($50,000.00 current balance + all future inflows)',
      description: 'Spender address can transfer any amount of NUSD from your account at any time via transferFrom.',
    },
  ],
  coverage: {
    checked: [
      'balance_solvency',
      'token_allowances',
      'contract_verification',
      'known_drainer_addresses',
    ],
    missing: [],
  },
  evidence: {
    tokenAddress: NUSD_CONTRACT,
    spenderAddress: TEST_SPENDER,
    rawAmountHex: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    simulatedAllowanceSlot: 'keccak256(owner, spender) -> MaxUint256 written',
  },
};

export const unlimitedErc20ApprovalSnapshot: PendingRequestSnapshot = {
  requestId: 'req_fixture_unlimited_erc20',
  timestamp: 1726084820000,
  origin: 'https://sketchy-yield-aggregator.io',
  method: 'eth_sendTransaction',
  rawParams: [
    {
      from: TEST_ACCOUNT,
      to: NUSD_CONTRACT,
      data: `0x095ea7b3000000000000000000000000${TEST_SPENDER.slice(2)}ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`,
    },
  ],
  chainId: '0x1',
  account: TEST_ACCOUNT,
  providerInfo: { name: 'MetaMask' },
  status: 'ANALYSIS_READY',
  analysis: mapReportToAnalysisResult(unlimitedErc20ApprovalReport, 'req_fixture_unlimited_erc20'),
};

// =============================================================
// 4. Reverted Transaction
// =============================================================
export const revertedTransactionReport: AnalysisReport = {
  requestId: 'req_fixture_reverted_tx',
  requestHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
  status: 'complete',
  severity: 'medium',
  summary: 'Simulation reverted during local fork execution. If submitted, this transaction will fail on-chain and waste gas fees.',
  fork: {
    chainId: 1,
    blockNumber: '0x12d4a92',
    blockHash: '0xabc1230000000000000000000000000000000000000000000000000000000004',
  },
  simulation: {
    mode: 'transaction',
    outcome: 'revert',
    assumptions: [],
  },
  findings: [
    {
      id: 'tx-revert',
      severity: 'medium',
      title: 'Transaction Simulation Reverted',
      description: 'EVM execution failed on fork. Contract call reverted with error selector.',
      explanation: 'The EVM execution threw an error during transaction simulation. Calling this method with current parameters and state will fail on-chain and forfeit gas.',
      evidence: 'EVM revert reason: 0x08c379a0 ("TRANSFER_FAILED: Insufficient token reserve in pool")',
      confidence: 'Definitive (100%)',
    },
  ],
  immediateChanges: [],
  potentialExposure: [],
  coverage: {
    checked: ['balance_solvency', 'gas_simulation', 'evm_execution', 'contract_verification'],
    missing: [],
  },
  evidence: {
    revertError: 'TRANSFER_FAILED',
    revertSelector: '0x08c379a0',
    estimatedGasWasted: '142,500 gas (~$12.50)',
    failingInstruction: 'REVERT at PC=1432',
  },
};

export const revertedTransactionSnapshot: PendingRequestSnapshot = {
  requestId: 'req_fixture_reverted_tx',
  timestamp: 1726084830000,
  origin: 'https://app.lumaswap.io',
  method: 'eth_sendTransaction',
  rawParams: [
    {
      from: TEST_ACCOUNT,
      to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // LumaSwap SwapRouter02
      value: '0x0',
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000067000000',
    },
  ],
  chainId: '0x1',
  account: TEST_ACCOUNT,
  providerInfo: { name: 'MetaMask' },
  status: 'ANALYSIS_READY',
  analysis: mapReportToAnalysisResult(revertedTransactionReport, 'req_fixture_reverted_tx'),
};

// =============================================================
// 5. Conditional Permit
// =============================================================
export const conditionalPermitReport: AnalysisReport = {
  requestId: 'req_fixture_conditional_permit',
  requestHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
  status: 'complete',
  severity: 'high',
  summary: 'EIP-712 Permit signature requested. Permits third-party contracts to withdraw tokens off-chain without an immediate on-chain transaction.',
  fork: {
    chainId: 1,
    blockNumber: '0x12d4a93',
    blockHash: '0xabc1230000000000000000000000000000000000000000000000000000000005',
  },
  simulation: {
    mode: 'conditional-signature',
    outcome: 'success',
    assumptions: [
      'Permit deadline timestamp (1893456000) has not expired when submitted',
      'Owner wallet maintains sufficient NUSD balance at execution time',
      'Contract nonces match the signature parameters on-chain',
      'Spender address broadcasts permit transaction prior to revocation',
    ],
  },
  findings: [
    {
      id: 'gasless-permit-risk',
      severity: 'high',
      title: 'Off-Chain Gasless Permit Authorization',
      description: 'EIP-712 Permit signature detected. Permits spender to withdraw 1,000 NUSD without direct on-chain signing.',
      explanation: 'Signing this typed data allows a designated spender to submit the permit on-chain and execute token transfers without paying gas yourself.',
      evidence: `Permit domain: Nova USD (${NUSD_CONTRACT}), Spender: ${TEST_SPENDER}, Value: 1,000,000,000 (1,000 NUSD)`,
      confidence: 'High (90%)',
    },
  ],
  immediateChanges: [],
  potentialExposure: [
    {
      kind: 'token_allowance',
      asset: 'Nova USD (NUSD)',
      amount: '1,000 NUSD ($1,000.00)',
      description: 'A third party possessing this signed message can execute the permit and pull up to 1,000 NUSD from your wallet.',
    },
  ],
  coverage: {
    checked: [
      'typed_data_schema',
      'permit_replay',
      'token_solvency',
      'contract_verification',
    ],
    missing: [],
  },
  evidence: {
    primaryType: 'Permit',
    domainName: 'Nova USD',
    verifyingContract: NUSD_CONTRACT,
    spender: TEST_SPENDER,
    deadline: '1893456000 (Wed Dec 31 2029)',
    nonce: '0',
  },
};

export const conditionalPermitSnapshot: PendingRequestSnapshot = {
  requestId: 'req_fixture_conditional_permit',
  timestamp: 1726084840000,
  origin: 'https://helixfi.io',
  method: 'eth_signTypedData_v4',
  rawParams: [
    TEST_ACCOUNT,
    JSON.stringify({
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
        name: 'Nova USD',
        version: '2',
        chainId: 1,
        verifyingContract: NUSD_CONTRACT,
      },
      message: {
        owner: TEST_ACCOUNT,
        spender: TEST_SPENDER,
        value: '1000000000',
        nonce: 0,
        deadline: 1893456000,
      },
    }),
  ],
  chainId: '0x1',
  account: TEST_ACCOUNT,
  providerInfo: { name: 'MetaMask' },
  status: 'ANALYSIS_READY',
  analysis: mapReportToAnalysisResult(conditionalPermitReport, 'req_fixture_conditional_permit'),
};

// =============================================================
// 6. Failed Analysis
// =============================================================
export const failedAnalysisReport: AnalysisReport = {
  requestId: 'req_fixture_failed_analysis',
  requestHash: '0x6666666666666666666666666666666666666666666666666666666666666666',
  status: 'failed',
  severity: 'unknown',
  summary: 'Analysis backend could not complete fork simulation. Target contract source is unverified.',
  fork: {
    chainId: 1,
    blockNumber: '0x12d4a94',
    blockHash: '0xabc1230000000000000000000000000000000000000000000000000000000006',
  },
  simulation: {
    mode: 'unsupported',
    outcome: 'not-executed',
    assumptions: [],
  },
  findings: [
    {
      id: 'unverified-source-code',
      severity: 'unknown',
      title: 'Unverified Contract Source Code',
      description: 'Destination contract source is not verified on block explorer.',
      explanation: 'The contract source code is not published or verified on Etherscan. Note: unverified status alone does not imply malicious behavior, but bytecode inspection and simulation depth are limited.',
      evidence: `Target: ${UNVERIFIED_CONTRACT} (No verified ABI found)`,
      confidence: 'Medium (65%)',
    },
  ],
  immediateChanges: [],
  potentialExposure: [],
  coverage: {
    checked: ['rpc_connectivity'],
    missing: [
      'fork_simulation',
      'drainer_intelligence',
      'contract_bytecode_verification',
    ],
  },
  evidence: {
    failureReason: 'Fork provider timeout (5000ms exceeded)',
    unverifiedTarget: UNVERIFIED_CONTRACT,
    decompilationState: 'Incomplete bytecode disassembler output',
  },
};

export const failedAnalysisSnapshot: PendingRequestSnapshot = {
  requestId: 'req_fixture_failed_analysis',
  timestamp: 1726084850000,
  origin: 'https://new-defi-portal.io',
  method: 'eth_sendTransaction',
  rawParams: [
    {
      from: TEST_ACCOUNT,
      to: UNVERIFIED_CONTRACT,
      value: '0x0',
      data: '0x12345678',
    },
  ],
  chainId: '0x1',
  account: TEST_ACCOUNT,
  providerInfo: { name: 'MetaMask' },
  status: 'ANALYSIS_READY',
  analysis: mapReportToAnalysisResult(failedAnalysisReport, 'req_fixture_failed_analysis'),
};

// Exported dictionary of all 6 fixtures
export const ALL_FIXTURES: Record<string, FixtureScenario> = {
  benign: {
    id: 'benign',
    name: 'Benign Transfer (ETH)',
    snapshot: benignTransferSnapshot,
    report: benignTransferReport,
    analysis: benignTransferSnapshot.analysis!,
  },
  nftApproval: {
    id: 'nftApproval',
    name: 'NFT setApprovalForAll (VAPE)',
    snapshot: nftApprovalSnapshot,
    report: nftApprovalReport,
    analysis: nftApprovalSnapshot.analysis!,
  },
  unlimitedErc20: {
    id: 'unlimitedErc20',
    name: 'Unlimited ERC20 Approval (NUSD)',
    snapshot: unlimitedErc20ApprovalSnapshot,
    report: unlimitedErc20ApprovalReport,
    analysis: unlimitedErc20ApprovalSnapshot.analysis!,
  },
  reverted: {
    id: 'reverted',
    name: 'Reverted Transaction',
    snapshot: revertedTransactionSnapshot,
    report: revertedTransactionReport,
    analysis: revertedTransactionSnapshot.analysis!,
  },
  conditionalPermit: {
    id: 'conditionalPermit',
    name: 'Conditional Permit (EIP-712)',
    snapshot: conditionalPermitSnapshot,
    report: conditionalPermitReport,
    analysis: conditionalPermitSnapshot.analysis!,
  },
  failedAnalysis: {
    id: 'failedAnalysis',
    name: 'Failed Analysis (Unverified)',
    snapshot: failedAnalysisSnapshot,
    report: failedAnalysisReport,
    analysis: failedAnalysisSnapshot.analysis!,
  },
};
