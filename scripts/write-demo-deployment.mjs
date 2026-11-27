// Turns Forge's broadcast receipt for DeployAll into the deployment file the public site reads.
//
//   node scripts/write-demo-deployment.mjs <chainId> [outFile]
//
// Reads incoming/ps2-project/broadcast/DeployAll.s.sol/<chainId>/run-latest.json and writes
// incoming/ps2-project/deployments/sepolia.json (or outFile). ATTACKER_ADDRESS must match the value
// the deployment used; it defaults to the same address as script/DeployAll.s.sol.
import { readFileSync, writeFileSync } from 'node:fs';

const chainId = Number(process.argv[2]);
if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('Usage: node scripts/write-demo-deployment.mjs <chainId> [outFile]');
const outFile = process.argv[3] ?? 'incoming/ps2-project/deployments/sepolia.json';
const receipt = JSON.parse(readFileSync(`incoming/ps2-project/broadcast/DeployAll.s.sol/${chainId}/run-latest.json`, 'utf8'));

const NAMES = { TestToken: 'testToken', TestNFT: 'testNFT', TestERC1155: 'testERC1155', FakeRewardsDrainer: 'fakeRewardsDrainer', FakeNFTRewards: 'fakeNftRewards', MaliciousTokenApprover: 'maliciousTokenApprover' };
const contracts = {};
for (const tx of receipt.transactions ?? []) {
  if (tx.transactionType === 'CREATE' && NAMES[tx.contractName] && tx.contractAddress) contracts[NAMES[tx.contractName]] = tx.contractAddress;
}
const missing = ['testToken', 'testNFT', 'testERC1155', 'fakeRewardsDrainer', 'fakeNftRewards'].filter((k) => !contracts[k]);
if (missing.length) throw new Error(`Deployment receipt is missing: ${missing.join(', ')}`);

const attacker = process.env.ATTACKER_ADDRESS || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const firstBlock = receipt.receipts?.[0]?.blockNumber;
const deployment = {
  chainId,
  attacker,
  contracts,
  // Forge has written this timestamp in seconds and, in newer versions, milliseconds.
  deployedAt: new Date(receipt.timestamp > 1e12 ? receipt.timestamp : (receipt.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
  ...(firstBlock ? { blockNumber: Number(firstBlock).toString() } : {}),
  ...(process.env.GITHUB_SHA ? { commit: process.env.GITHUB_SHA } : {}),
};
writeFileSync(outFile, JSON.stringify(deployment, null, 2) + '\n');
console.log(`Wrote ${outFile}`, deployment);
