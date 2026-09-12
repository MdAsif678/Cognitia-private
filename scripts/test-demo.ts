import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createPublicClient, http, encodeFunctionData, parseAbi, maxUint256 } from 'viem';
import { parseAnalysisReport } from '../incoming/atif-extension/src/shared/api-contract';
const d = JSON.parse(await readFile('incoming/ps2-project/demo/deployment.json', 'utf8'));
const apiBaseUrl = process.env.TEST_API_URL ?? d.apiBaseUrl;
const reportDirectory = process.env.TEST_REPORT_DIR ?? 'artifacts/demo-reports';
const client = createPublicClient({ transport: http(d.rpcUrl) });
const blockBefore = await client.getBlockNumber({ cacheTime: 0 });
const abi = parseAbi(['function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)', 'function setApprovalForAll(address,bool)', 'function claim()', 'function nonces(address) view returns (uint256)']);
const tx = (to: string, functionName: any, args: any[] = []) => ({ method: 'eth_sendTransaction', params: [{ from: d.testWallet, to, value: '0x0', data: encodeFunctionData({ abi, functionName, args }) }] });
const permit = { types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, primaryType: 'Permit', domain: { name: 'PS2 Test USD', version: '1', chainId: 31337, verifyingContract: d.contracts.testToken }, message: { owner: d.testWallet, spender: d.attacker, value: maxUint256.toString(), nonce: String(await client.readContract({ address: d.contracts.testToken, abi, functionName: 'nonces', args: [d.testWallet] })), deadline: String((await client.getBlock()).timestamp + 3600n) } };
const scenarios = [
  ['unlimited-erc20', tx(d.contracts.testToken, 'approve', [d.attacker, maxUint256]), 'high', 'erc20-allowance'],
  ['nft-operator', tx(d.contracts.testNFT, 'setApprovalForAll', [d.attacker, true]), 'high', 'operator-approval'],
  ['hidden-drain', tx(d.contracts.fakeRewardsDrainer, 'claim'), 'high', 'erc20-balance'],
  ['permit', { method: 'eth_signTypedData_v4', params: [d.testWallet, JSON.stringify(permit)] }, 'high', 'conditional'],
  ['erc1155-operator', tx(d.contracts.testERC1155, 'setApprovalForAll', [d.attacker, true]), 'high', 'operator-approval'],
  ['transfer', tx(d.contracts.testToken, 'transfer', ['0x9965507d1a55bcc2695c58ba16fb37d819b0a4df', 10n * 10n ** 18n]), 'low', 'erc20-balance'],
  ['revoke', tx(d.contracts.testToken, 'approve', [d.attacker, 0n]), 'low', null],
  ['unknown-selector', { method: 'eth_sendTransaction', params: [{ from: d.testWallet, to: d.contracts.testToken, data: '0xdeadbeef', value: '0x0' }] }, 'non-low', null],
  ['personal-sign', { method: 'personal_sign', params: ['0x48656c6c6f', d.testWallet] }, 'non-low', null],
] as const;
await mkdir(reportDirectory, { recursive: true });
for (const [name, request, expected, change] of scenarios) {
  const payload = { requestId: `smoke-${name}`, origin: 'http://localhost:3000', chainId: 31337, account: d.testWallet, ...request };
  const response = await fetch(`${apiBaseUrl}/v1/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200);
  const report = await response.json();
  await writeFile(`${reportDirectory}/${name}.json`, JSON.stringify(report, null, 2));
  const parsed = parseAnalysisReport(report);
  assert.ok(parsed.success, `${name}: report rejected by extension schema`);
  assert.notEqual(report.status, 'failed', `${name}: ${report.summary}`);
  if (expected === 'high') assert.ok(['high', 'critical'].includes(report.severity), `${name}: ${report.summary}`);
  else if (expected === 'low') assert.equal(report.severity, 'low', `${name}: ${report.summary}`);
  else assert.notEqual(report.severity, 'low');
  if (change === 'conditional') {
    assert.equal(report.simulation.mode, 'conditional-signature');
    assert.equal(report.immediateChanges.length, 0);
    assert.ok(report.conditionalChanges.length > 0);
  } else if (change) assert.ok(report.immediateChanges.some((c: any) => c.kind === change), `${name}: missing ${change}`);
  console.log(`${name}: ${report.severity} (${report.status}, ${report.durationMs} ms)`);
}
assert.equal(await client.getBlockNumber({ cacheTime: 0 }), blockBefore, 'Analysis must never mine on the upstream chain');
console.log(`All nine scenarios passed; upstream block unchanged. Evidence: ${reportDirectory}/`);
