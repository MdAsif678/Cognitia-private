import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const deployment = JSON.parse(await readFile('incoming/ps2-project/demo/deployment.json', 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'cognitia-package-'));
let server;
let exited;
let output = '';
try {
  // Only this artifact is shipped in the runtime image. No source tree or node_modules.
  await copyFile('services/api/dist/server.mjs', join(directory, 'server.mjs'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      SIM_CHAINS: '31337', RPC_URL_31337: deployment.rpcUrl, WARM_FORKS_PER_CHAIN: '0',
      ENABLE_DEBUG_ROUTES: 'false', THREAT_INCLUDE_DEMO: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-16000); });
  exited = once(server, 'exit');
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Packaged API exited during startup: ${output}`);
    try {
      const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).ready) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, `Packaged API did not become ready: ${output}`);
  const health = await (await fetch(`${url}/health`)).json();
  assert.match(health.version.riskEngine, /swastik-risk-engine/);
  const debug = await fetch(`${url}/v1/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(debug.status, 404, 'Production configuration must disable debug routes');
  const smoke = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/test-demo.ts'], {
    cwd: root, env: { ...process.env, TEST_API_URL: url, TEST_REPORT_DIR: 'artifacts/packaged-reports' }, stdio: 'inherit',
  });
  const [code] = await once(smoke, 'exit');
  assert.equal(code, 0, 'Packaged API smoke test failed');
  console.log('Standalone production bundle passed all scenarios without repository dependencies.');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
    if (!stopped) { server.kill('SIGKILL'); await exited; }
  }
  await rm(directory, { recursive: true, force: true });
}
