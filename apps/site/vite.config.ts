import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The site is fully static. Everything a deployment needs to know is baked in at build time from:
 *   1. apps/site/site.config.json (committed, empty placeholders),
 *   2. the demo contract deployment (incoming/ps2-project/deployments/sepolia.json, written by the
 *      "Deploy demo contracts to Sepolia" workflow), or SITE_DEMO_DEPLOYMENT for a local chain,
 *   3. SITE_* environment variables, which GitHub Actions fills from repository variables, or a
 *      gitignored apps/site/.env.local for local development.
 */
const root = __dirname;
const repoRoot = resolve(root, '../..');
const base = JSON.parse(readFileSync(resolve(root, 'site.config.json'), 'utf8'));
// apps/site/.env.local is for the dev server only; production builds take SITE_* from the
// environment (GitHub Actions) so a developer's local settings can never leak into a release.
const isDevServer = !process.argv.includes('build');
const env: Record<string, string | undefined> = { ...(isDevServer ? loadEnv('development', root, 'SITE_') : {}), ...process.env };

function readJson(path: string) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

const deploymentPath = env.SITE_DEMO_DEPLOYMENT
  ? resolve(repoRoot, env.SITE_DEMO_DEPLOYMENT)
  : resolve(repoRoot, 'incoming/ps2-project/deployments/sepolia.json');
const deployment = readJson(deploymentPath);

const demo = { ...base.demo, contracts: { ...base.demo.contracts } };
if (deployment) {
  demo.chainId = deployment.chainId ?? demo.chainId;
  if (deployment.chainId === 31337) {
    demo.chainName = 'Local Anvil';
    demo.explorerUrl = '';
    demo.faucetUrl = '';
  }
  demo.rpcUrl = deployment.rpcUrl ?? demo.rpcUrl;
  demo.attacker = deployment.attacker ?? demo.attacker;
  for (const key of Object.keys(demo.contracts)) demo.contracts[key] = deployment.contracts?.[key] ?? demo.contracts[key];
}

const siteConfig = {
  ...base,
  apiBaseUrl: (env.SITE_API_BASE_URL || base.apiBaseUrl || '').replace(/\/+$/, ''),
  repoUrl: env.SITE_REPO_URL || base.repoUrl,
  extensionZipUrl: env.SITE_EXTENSION_ZIP_URL || base.extensionZipUrl,
  chromeWebStoreUrl: env.SITE_CHROME_STORE_URL || base.chromeWebStoreUrl,
  demoVideoUrl: env.SITE_DEMO_VIDEO_URL || base.demoVideoUrl,
  demo,
};

/** Shared header and footer, stamped into every page at build time (no layout shift, no JS). */
const NAV = [
  ['index.html#how', 'How it works', 'how'],
  ['playground.html', 'Playground', 'playground'],
  ['demo.html', 'Live demo', 'demo'],
  ['install.html', 'Install', 'install'],
] as const;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function header(current: string) {
  const links = NAV.map(([href, label, id]) => `<a href="./${href}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<header class="site-header"><div class="wrap">
  <a class="site-brand" href="./index.html"><span class="site-mark" aria-hidden="true"></span><span class="site-brand-name">Cognitia</span><span class="site-brand-sub">Transaction interceptor</span></a>
  <nav class="nav" id="site-nav" aria-label="Main">${links}<a class="button" href="./install.html">Download</a></nav>
  <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span><span></span></button>
</div></header>`;
}
function footer() {
  const repo = siteConfig.repoUrl ? ` · <a href="${escapeHtml(siteConfig.repoUrl)}">Source</a>` : '';
  return `<footer class="site-footer"><div class="wrap">
  <span>Cognitia by Code-Blooded · COGNITIA 2026, Blockchain PS2${repo}</span>
  <span data-api-status>Checking analysis API…</span>
</div></footer>`;
}
const partials = {
  name: 'site-partials',
  transformIndexHtml(html: string) {
    return html
      .replace(/<site-header current="([a-z]*)"><\/site-header>/, (_m, current) => header(current))
      .replace('<site-footer></site-footer>', footer());
  },
};

export default defineConfig({
  root,
  base: './',
  plugins: [react(), partials],
  define: {
    __SITE_CONFIG__: JSON.stringify(siteConfig),
    // The playground reuses the extension's report component, which reads these at build time.
    'process.env.API_BASE_URL': JSON.stringify(siteConfig.apiBaseUrl),
    'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV ?? 'production'),
  },
  // 127.0.0.1 explicitly: Vite's default binds only ::1 on Windows, so 127.0.0.1 links would not open.
  server: { host: '127.0.0.1', port: Number(env.SITE_PORT ?? 5180), strictPort: true, fs: { allow: [repoRoot] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        install: resolve(root, 'install.html'),
        playground: resolve(root, 'playground.html'),
        demo: resolve(root, 'demo.html'),
      },
    },
  },
});
