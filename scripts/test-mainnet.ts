/** Read-only live-mainnet evidence. No private key and no upstream send RPC. */
import { mkdir, writeFile } from 'node:fs/promises';
import { encodeFunctionData, parseAbi, maxUint256 } from 'viem';
import { Simulator } from '@cognitia/simulator';
import { analyze } from '../services/api/src/pipeline/analyze';
import { createSwastikEngine } from '../incoming/integration/swastik-bridge';
import { parseAnalysisReport } from '../incoming/atif-extension/src/shared/api-contract';
const chains = [{ chainId: 1, name: 'Ethereum mainnet', rpcUrl: process.env.RPC_URL_1 ?? 'https://ethereum-rpc.publicnode.com', blockLag: 2 }];
const simulator = new Simulator({ chains, warmForksPerChain: 0 });
try {
  const account = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
  const report = await analyze({ requestId: 'live-mainnet-drainer-approval', origin: 'http://localhost', chainId: 1, account, method: 'eth_sendTransaction', params: [{ from: account, to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', value: '0x0', data: encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: ['0x0000db5c8b030ae5034102f866416f8b25530182', maxUint256] }) }] }, { simulator, engine: createSwastikEngine({ chains }), timeoutMs: 45000 });
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/live-mainnet-report.json', JSON.stringify(report, null, 2));
  if (!parseAnalysisReport(report).success || report.status === 'failed' || report.severity !== 'critical' || !report.fork) throw new Error(report.summary);
  console.log(`${report.summary}; verified fork block ${report.fork.blockNumber}, hash ${report.fork.blockHash}, ${report.durationMs} ms`);
  console.log('This is a hypothetical unsigned USDC approval against live state, not a historical attack transaction. Report: artifacts/live-mainnet-report.json');
} finally { await simulator.close(); }
