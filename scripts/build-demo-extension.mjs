import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const deployment = JSON.parse(await readFile('incoming/ps2-project/demo/deployment.json', 'utf8'));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCmd, ['run', 'build', '-w', '@cognitia/extension'], {
  env: { ...process.env, API_BASE_URL: deployment.apiBaseUrl }, stdio: 'inherit', shell: process.platform === 'win32',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

