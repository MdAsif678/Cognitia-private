import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';
const rpcPort = process.env.DEMO_RPC_PORT ?? '8545';
const apiPort = process.env.DEMO_API_PORT ?? '8080';
const webPort = process.env.DEMO_WEB_PORT ?? '3000';
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const apiUrl = `http://localhost:${apiPort}`;
const env = { ...process.env, PATH: `${homedir()}/.foundry/bin${delimiter}${process.env.PATH}`, SIM_CHAINS: '31337', RPC_URL_31337: rpcUrl, DEMO_RPC_URL: rpcUrl, DEMO_API_URL: apiUrl, HOST: '127.0.0.1', PORT: apiPort, WARM_FORKS_PER_CHAIN: '0' };
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(code), 500); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
function start(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: 'inherit', ...options }); children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  return child;
}
async function untilReady(url, init) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Service did not become ready: ${url}`);
}
try {
  await access('incoming/ps2-project/lib/forge-std/src/Script.sol');
  await access('incoming/ps2-project/lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol');
  // Never silently reuse or reset somebody else's running chain.
  try { await fetch(rpcUrl, { method: 'POST', signal: AbortSignal.timeout(500) }); throw new Error(`Port ${rpcPort} is already in use. Stop the previous demo or set DEMO_RPC_PORT, DEMO_API_PORT and DEMO_WEB_PORT.`); }
  catch (error) { if (error.message.startsWith('Port')) throw error; }
  const chain = start('anvil', ['--host', '127.0.0.1', '--port', rpcPort, '--chain-id', '31337', '--silent']);
  chain.on('exit', code => { if (!stopping) stop(code || 1); });
  await untilReady(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
  const deploy = start('npm', ['run', 'deploy:local']);
  await new Promise((resolve, reject) => deploy.on('exit', code => code === 0 ? resolve() : reject(new Error('Demo deployment failed.'))));
  const api = start('npm', ['run', 'dev:api']);
  api.on('exit', code => { if (!stopping) stop(code || 1); });
  await untilReady(`${apiUrl}/ready`);
  const site = start('python3', ['-m', 'http.server', webPort, '--bind', '127.0.0.1', '--directory', 'incoming/ps2-project/demo']);
  site.on('exit', code => { if (!stopping) stop(code || 1); });
  console.log(`\nCognitia ready: http://localhost:${webPort} · API ${apiUrl} · local chain 31337\n`);
} catch (error) { console.error(error.message, '\nInstall Foundry and run the pinned forge install commands in README.md.'); stop(1); }
