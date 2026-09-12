/** Deploy only to a loopback Anvil chain. The known test key never leaves this script. */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
const rpcUrl = process.env.DEMO_RPC_URL ?? 'http://127.0.0.1:8545';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpcUrl).hostname)) throw new Error('Local demo deployment requires a loopback RPC.');
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const publicClient = createPublicClient({ transport: http(rpcUrl) });
if (await publicClient.getChainId() !== 31337) throw new Error('Refusing to deploy demo contracts outside local chain 31337.');
await publicClient.request({ method: 'web3_clientVersion' }).then(v => { if (!v.toLowerCase().includes('anvil')) throw new Error('Local deployment requires Anvil.'); });
execFileSync(process.env.FORGE_PATH ?? 'forge', ['build'], { cwd: 'incoming/ps2-project', stdio: 'inherit' });
const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
async function deploy(name: string, args: unknown[] = []) {
  const artifact = JSON.parse(await readFile(`incoming/ps2-project/out/${name}.sol/${name}.json`, 'utf8'));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
  return receipt.contractAddress;
}
const attacker = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const testToken = await deploy('TestToken');
const testNFT = await deploy('TestNFT');
const testERC1155 = await deploy('TestERC1155');
const fakeRewardsDrainer = await deploy('FakeRewardsDrainer', [attacker, testToken, testNFT]);
for (let i = 0; i < 3; i++) {
  const hash = await wallet.writeContract({ address: testNFT, abi: parseAbi(['function mint() returns (uint256)']), functionName: 'mint' });
  await publicClient.waitForTransactionReceipt({ hash });
}
const approval = await wallet.writeContract({ address: testToken, abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [fakeRewardsDrainer, 500n * 10n ** 18n] });
await publicClient.waitForTransactionReceipt({ hash: approval });
const config = { chainId: 31337, rpcUrl, apiBaseUrl: process.env.DEMO_API_URL ?? 'http://localhost:8080', testWallet: account.address, attacker, contracts: { testToken, testNFT, testERC1155, fakeRewardsDrainer } };
await writeFile('incoming/ps2-project/demo/deployment.json', JSON.stringify(config, null, 2) + '\n');
console.log('Deployed and seeded local demo:', config);
