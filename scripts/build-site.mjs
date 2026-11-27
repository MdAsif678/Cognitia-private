// Builds the public site with the extension download inside it:
//   1. builds the extension against the public analysis API,
//   2. zips incoming/atif-extension/dist to apps/site/public/downloads/cognitia-extension.zip,
//   3. builds apps/site to apps/site/dist (static, ready for GitHub Pages).
//
//   SITE_API_BASE_URL=https://api.example.com npm run build:site
//
// SITE_API_BASE_URL falls back to apiBaseUrl in apps/site/site.config.json. When both are empty the
// extension falls back to http://localhost:8080 and the site says the API is not configured.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const siteConfig = JSON.parse(readFileSync('apps/site/site.config.json', 'utf8'));
const apiBaseUrl = (process.env.SITE_API_BASE_URL || siteConfig.apiBaseUrl || '').replace(/\/+$/, '');
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

console.log(`[site] analysis API: ${apiBaseUrl || '(not configured, extension defaults to http://localhost:8080)'}`);
run('npm run build -w @cognitia/extension', apiBaseUrl ? { API_BASE_URL: apiBaseUrl } : {});

/** Minimal ZIP (deflate) writer, so the build needs no zip binary on Windows, macOS or Linux. */
function zipDirectory(dir, outFile) {
  const files = [];
  const walk = (d) => { for (const name of readdirSync(d).sort()) { const p = join(d, name); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(dir);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));
  return files.length;
}

mkdirSync('apps/site/public/downloads', { recursive: true });
const count = zipDirectory('incoming/atif-extension/dist', 'apps/site/public/downloads/cognitia-extension.zip');
console.log(`[site] packaged extension: ${count} files -> apps/site/public/downloads/cognitia-extension.zip`);

run('npm run build -w @cognitia/site', apiBaseUrl ? { SITE_API_BASE_URL: apiBaseUrl } : {});
console.log('[site] built apps/site/dist');
