import { config, demoDeployed } from '../config';

/** One ready-made wallet request the playground can send to /v1/analyze. */
export type Scenario = {
  id: string;
  group: 'mainnet' | 'demo';
  title: string;
  detail: string;
  expected: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  chainId: number;
  origin: string;
  method: 'eth_sendTransaction' | 'eth_signTypedData_v4' | 'personal_sign';
  /** Built lazily so the "simulate as" account the visitor typed is used. */
  params: (account: string) => unknown[];
};

const MAX_UINT256 = 'f'.repeat(64);
const pad = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (v: bigint) => v.toString(16).padStart(64, '0');
const SEL = { approve: '0x095ea7b3', transfer: '0xa9059cbb', setApprovalForAll: '0xa22cb465', claim: '0x4e71d92d', claimRewards: '0x372500ab' };
const tx = (to: string, data: string) => (account: string) => [{ from: account, to, data, value: '0x0' }];
const utf8Hex = (s: string) => '0x' + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

/** A public, well-known address with real mainnet balances. Visitors can change it. */
export const DEFAULT_ACCOUNT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const FRIEND = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4df';

// Real mainnet contracts and documented drainer infrastructure (sources in the threat database).
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const BAYC = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const INFERNO_DRAINER = '0x0000db5c8b030ae5034102f866416f8b25530182';
const PINK_DRAINER = '0x000000000000543666fe5bc9635f793b82141505';
const UNKNOWN_SPENDER = '0x5c3a1a6d7b6c1b2f8e9d0a4b3c2d1e0f9a8b7c6d';
const PHISHING_ORIGIN = 'https://uniswap-airdrop-claim.com';
const SAFE_ORIGIN = 'https://wallet.example';

const permitTypes = {
  EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
  Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
};
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

const mainnet: Scenario[] = [
  {
    id: 'mainnet-drainer-approval', group: 'mainnet', expected: 'critical', chainId: 1, origin: SAFE_ORIGIN,
    title: 'Unlimited USDC approval to Inferno Drainer',
    detail: 'approve(spender, max) where the spender is a documented Inferno Drainer address.',
    method: 'eth_sendTransaction', params: tx(USDC, SEL.approve + pad(INFERNO_DRAINER) + MAX_UINT256),
  },
  {
    id: 'mainnet-unknown-approval', group: 'mainnet', expected: 'high', chainId: 1, origin: SAFE_ORIGIN,
    title: 'Unlimited USDC approval to an unknown address',
    detail: 'The classic fake-airdrop request: unlimited spending rights for an address nobody has seen.',
    method: 'eth_sendTransaction', params: tx(USDC, SEL.approve + pad(UNKNOWN_SPENDER) + MAX_UINT256),
  },
  {
    id: 'mainnet-nft-operator', group: 'mainnet', expected: 'critical', chainId: 1, origin: SAFE_ORIGIN,
    title: 'Approve-all on Bored Ape Yacht Club',
    detail: 'setApprovalForAll(operator, true) for a documented PinkDrainer operator.',
    method: 'eth_sendTransaction', params: tx(BAYC, SEL.setApprovalForAll + pad(PINK_DRAINER) + uint(1n)),
  },
  {
    id: 'mainnet-usdc-permit', group: 'mainnet', expected: 'high', chainId: 1, origin: SAFE_ORIGIN,
    title: '"Gasless" USDC permit signature',
    detail: 'An ERC-2612 permit giving an unknown spender unlimited USDC, signed off-chain with no transaction.',
    method: 'eth_signTypedData_v4',
    params: (account) => [account, JSON.stringify({
      types: permitTypes, primaryType: 'Permit',
      domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: USDC },
      message: { owner: account, spender: UNKNOWN_SPENDER, value: BigInt('0x' + MAX_UINT256).toString(), nonce: 0, deadline: inAnHour() },
    })],
  },
  {
    id: 'mainnet-permit2', group: 'mainnet', expected: 'high', chainId: 1, origin: SAFE_ORIGIN,
    title: 'Permit2 signature for a drainer',
    detail: 'A Uniswap Permit2 PermitSingle that would let the Inferno Drainer address pull USDC.',
    method: 'eth_signTypedData_v4',
    params: (account) => [account, JSON.stringify({
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
        PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
      },
      primaryType: 'PermitSingle',
      domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 },
      message: { details: { token: USDC, amount: (2n ** 160n - 1n).toString(), expiration: inAnHour() + 86400 * 30, nonce: 0 }, spender: INFERNO_DRAINER, sigDeadline: inAnHour() },
    })],
  },
  {
    id: 'mainnet-phishing-transfer', group: 'mainnet', expected: 'critical', chainId: 1, origin: PHISHING_ORIGIN,
    title: 'Ordinary transfer from a phishing site',
    detail: `A plain 5 USDC transfer, requested by ${new URL(PHISHING_ORIGIN).host}, a domain on MetaMask's phishing list.`,
    method: 'eth_sendTransaction', params: tx(USDC, SEL.transfer + pad(FRIEND) + uint(5_000_000n)),
  },
  {
    id: 'mainnet-siwe-mismatch', group: 'mainnet', expected: 'high', chainId: 1, origin: 'https://uniswap-rewards.example',
    title: 'Sign-in message for a different site',
    detail: 'A Sign-In with Ethereum message claiming to be app.uniswap.org, requested by uniswap-rewards.example.',
    method: 'personal_sign',
    params: (account) => [utf8Hex(`app.uniswap.org wants you to sign in with your Ethereum account:\n${account}\n\nSign in to Uniswap.\n\nURI: https://app.uniswap.org\nVersion: 1\nChain ID: 1\nNonce: 7d2f9a41c0\nIssued At: ${new Date().toISOString()}`), account],
  },
  {
    id: 'mainnet-unknown-call', group: 'mainnet', expected: 'medium', chainId: 1, origin: SAFE_ORIGIN,
    title: 'Unknown function call',
    detail: 'Calldata with a selector no ABI or signature database recognises.',
    method: 'eth_sendTransaction', params: tx(USDC, '0xdeadbeef'),
  },
  {
    id: 'mainnet-benign-transfer', group: 'mainnet', expected: 'low', chainId: 1, origin: SAFE_ORIGIN,
    title: 'Normal 10 USDC transfer',
    detail: 'A benign control: you send 10 USDC to a friend and nothing else changes.',
    method: 'eth_sendTransaction', params: tx(USDC, SEL.transfer + pad(FRIEND) + uint(10_000_000n)),
  },
];

function demoScenarios(): Scenario[] {
  if (!demoDeployed) return [];
  const c = config.demo.contracts;
  const attacker = config.demo.attacker;
  const chainId = config.demo.chainId;
  const origin = 'https://aura-rewards.demo';
  return [
    { id: 'demo-claim-drain', group: 'demo', expected: 'critical', chainId, origin, method: 'eth_sendTransaction', title: 'Claim staking yield', detail: 'Our FakeRewardsDrainer: claim() spends an existing approval and moves your pUSD to the attacker.', params: tx(c.fakeRewardsDrainer, SEL.claim) },
    { id: 'demo-claim-rewards', group: 'demo', expected: 'critical', chainId, origin, method: 'eth_sendTransaction', title: 'Claim NFT rewards', detail: 'Our FakeNFTRewards: claimRewards() sweeps every pNFT you approved it for.', params: tx(c.fakeNftRewards, SEL.claimRewards) },
    { id: 'demo-eligibility', group: 'demo', expected: 'high', chainId, origin, method: 'eth_sendTransaction', title: '"Verify eligibility" (approve-all)', detail: 'setApprovalForAll on pNFT for the rewards contract, the step that makes the sweep possible.', params: tx(c.testNFT, SEL.setApprovalForAll + pad(c.fakeNftRewards) + uint(1n)) },
    { id: 'demo-airdrop', group: 'demo', expected: 'high', chainId, origin, method: 'eth_sendTransaction', title: 'Claim 500 pUSD airdrop', detail: 'Unlimited pUSD approval to the attacker.', params: tx(c.testToken, SEL.approve + pad(attacker) + MAX_UINT256) },
    { id: 'demo-badges', group: 'demo', expected: 'high', chainId, origin, method: 'eth_sendTransaction', title: 'Claim event badges', detail: 'ERC-1155 approve-all to the attacker.', params: tx(c.testERC1155, SEL.setApprovalForAll + pad(attacker) + uint(1n)) },
    {
      id: 'demo-voucher', group: 'demo', expected: 'high', chainId, origin, method: 'eth_signTypedData_v4', title: 'Sign gasless voucher', detail: 'ERC-2612 permit for unlimited pUSD to the attacker.',
      params: (account) => [account, JSON.stringify({ types: permitTypes, primaryType: 'Permit', domain: { name: 'PS2 Test USD', version: '1', chainId, verifyingContract: c.testToken }, message: { owner: account, spender: attacker, value: BigInt('0x' + MAX_UINT256).toString(), nonce: 0, deadline: inAnHour() } })],
    },
    { id: 'demo-transfer', group: 'demo', expected: 'low', chainId, origin, method: 'eth_sendTransaction', title: 'Send 10 pUSD (safe)', detail: 'Benign control on the demo token.', params: tx(c.testToken, SEL.transfer + pad(FRIEND) + uint(10n * 10n ** 18n)) },
  ];
}

export const scenarios: Scenario[] = [...mainnet, ...demoScenarios()];
