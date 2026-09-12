// Publishes the analysis API over HTTPS with a cloudflared quick tunnel, then rebuilds the
// extension against the URL the tunnel was actually given. A quick tunnel gets a NEW hostname on
// every start, and the extension bakes that URL in at build time (see incoming/atif-extension/
// build.mjs), so starting the tunnel and building the extension must happen together — otherwise
// the installed extension points at a hostname that no longer exists.
//
//   npm run demo:public
//
// Leave this running for the whole demo. Ctrl-C stops both the API and the tunnel.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter } from 'node:path';

const apiPort = process.env.DEMO_API_PORT ?? '8080';
const env = { ...process.env, PATH: `${homedir()}/.foundry/bin${delimiter}${process.env.PATH}` };
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npmOptions = isWindows ? { shell: true } : {};
// winget installs cloudflared outside PATH for the current shell on Windows.
const cloudflared = process.env.CLOUDFLARED_PATH
  ?? (isWindows ? 'C:/Program Files (x86)/cloudflared/cloudflared.exe' : 'cloudflared');

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function start(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: 'inherit', ...options });
  children.push(child);
  child.on('error', error => { console.error(`${command}: ${error.message}`); stop(1); });
  return child;
}

async function untilReady(url) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

/** Resolves with the public hostname cloudflared prints on stderr during startup. */
function startTunnel() {
  const child = spawn(cloudflared, ['tunnel', '--url', `http://localhost:${apiPort}`, '--no-autoupdate'], { env });
  children.push(child);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('cloudflared did not report a URL within 60s.')); } }, 60_000);
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`cloudflared: ${error.message}`)); } });
    child.stderr.on('data', chunk => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
      if (match && !settled) { settled = true; clearTimeout(timer); resolve(match[0]); }
    });
  });
}

try {
  const api = start('node', [`--env-file=services/api/.env`, 'services/api/dist/server.mjs']);
  api.on('exit', code => { if (!stopping) stop(code || 1); });
  await untilReady(`http://127.0.0.1:${apiPort}/health`);

  const publicUrl = await startTunnel();
  // The build reads API_BASE_URL from this file and derives host_permissions from it.
  await writeFile('incoming/atif-extension/.env', `API_BASE_URL=${publicUrl}\n`);
  const build = start(npmCommand, ['run', 'build', '-w', '@cognitia/extension'], npmOptions);
  await new Promise((resolve, reject) => build.on('exit', code => code === 0 ? resolve() : reject(new Error('Extension build failed.'))));

  // Prove the public path works end to end before the demo depends on it.
  const ready = await fetch(`${publicUrl}/ready`, { signal: AbortSignal.timeout(60_000) });
  if (!ready.ok) throw new Error(`Public /ready returned ${ready.status}.`);

  console.log(`\n  Analysis API is public at ${publicUrl}`);
  console.log('  Extension rebuilt against it: reload incoming/atif-extension/dist at chrome://extensions,');
  console.log('  then reload the dapp tab. Leave this process running.\n');
} catch (error) {
  console.error(error.message);
  stop(1);
}
