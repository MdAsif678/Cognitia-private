/**
 * Funds any address on the local demo chain so it can run every AuraRewards scenario.
 *
 * The deploy step seeds only the Anvil test wallet. Anyone testing with their own MetaMask account
 * starts empty, so the offers either revert or show nothing moving, which looks like a broken
 * analysis rather than an empty account.
 *
 *   npm run fund:local -- 0xYourAddress
 *
 * Loopback chain 31337 only. The key below is Anvil's published test account and is worthless.
 */
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, parseAbi, isAddress, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

const target = process.argv[2];
if (!target || !isAddress(target)) {
  throw new Error('Pass the address to fund, for example: npm run fund:local -- 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
}
const recipient = target as Address;

const config = JSON.parse(await readFile('incoming/ps2-project/demo/deployment.json', 'utf8'));
const rpcUrl: string = process.env.DEMO_RPC_URL ?? config.rpcUrl;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpcUrl).hostname)) {
  throw new Error('Funding is only ever done against a loopback chain.');
}

const publicClient = createPublicClient({ transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== 31337) throw new Error('Refusing to fund outside local chain 31337.');

const deployer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(rpcUrl) });
const { testToken, testNFT, testERC1155, fakeRewardsDrainer } = config.contracts as Record<string, Address>;

const send = async (hash: `0x${string}`, label: string) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} failed`);
  console.log(`  ${label}`);
};

const GAS_BUDGET = 100n * 10n ** 18n;
const PUSD = 10_000n * 10n ** 18n;
const STALE_ALLOWANCE = 500n * 10n ** 18n;

console.log(`Funding ${recipient} on ${rpcUrl}`);

// Native balance for gas. Anvil lets us set it outright rather than draining the deployer.
await publicClient.request({ method: 'anvil_setBalance', params: [recipient, `0x${GAS_BUDGET.toString(16)}`] } as never);
console.log(`  ${formatEther(GAS_BUDGET)} AUR for gas`);

await send(
  await wallet.writeContract({ address: testToken, abi: parseAbi(['function mint(address,uint256)']), functionName: 'mint', args: [recipient, PUSD] }),
  `${formatEther(PUSD)} pUSD`,
);

for (let i = 0; i < 3; i++) {
  await send(
    await wallet.writeContract({ address: testNFT, abi: parseAbi(['function mintTo(address) returns (uint256)']), functionName: 'mintTo', args: [recipient] }),
    `pNFT #${i + 1}`,
  );
}

for (const [id, amount] of [[1n, 100n], [2n, 50n]] as const) {
  await send(
    await wallet.writeContract({ address: testERC1155, abi: parseAbi(['function mint(address,uint256,uint256)']), functionName: 'mint', args: [recipient, id, amount] }),
    `${amount} × ERC-1155 #${id}`,
  );
}

// The "Claim Staking Yield" offer drains a previously granted allowance, so the recipient needs one
// already standing or that scenario has nothing to take and reports far less than it should.
await publicClient.request({ method: 'anvil_impersonateAccount', params: [recipient] } as never);
try {
  const impersonated = createWalletClient({ account: recipient, chain: foundry, transport: http(rpcUrl) });
  await send(
    await impersonated.writeContract({ address: testToken, abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [fakeRewardsDrainer, STALE_ALLOWANCE] }),
    `stale allowance of ${formatEther(STALE_ALLOWANCE)} pUSD to the drainer`,
  );
} finally {
  await publicClient.request({ method: 'anvil_stopImpersonatingAccount', params: [recipient] } as never);
}

const balance = await publicClient.readContract({ address: testToken, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [recipient] });
const nfts = await publicClient.readContract({ address: testNFT, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [recipient] });
console.log(`Done. ${formatEther(balance)} pUSD, ${nfts} pNFT, ${formatEther(await publicClient.getBalance({ address: recipient }))} AUR.`);
