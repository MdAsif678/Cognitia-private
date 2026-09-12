import { build, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env files so API_BASE_URL can be baked into the extension build
const buildEnv = loadEnv('production', __dirname, '');
const apiUrl = new URL(buildEnv.API_BASE_URL || 'http://localhost:8080');
if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password) {
  throw new Error('API_BASE_URL must be an HTTP(S) URL without embedded credentials.');
}

const buildTimeDefine = {
  // Statically injected into every bundle; see src/shared/config.ts.
  // NODE_ENV defaults to "production" (release build: all developer logging disabled).
  // Run `NODE_ENV=development npm run build` for a debug build with dev logging.
  'process.env.API_BASE_URL': JSON.stringify(buildEnv.API_BASE_URL ?? ''),
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
};

async function runBuild() {
  console.log('[Build] Cleaning dist directory...');
  fs.rmSync(resolve(__dirname, 'dist'), { recursive: true, force: true });
  fs.mkdirSync(resolve(__dirname, 'dist'), { recursive: true });

  // 1. Build Side Panel and Demo HTML
  console.log('[Build] Building Side Panel & Demo HTML...');
  await build({
    configFile: false,
    plugins: [react()],
    define: buildTimeDefine,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          sidepanel: resolve(__dirname, 'sidepanel/index.html'),
          demo: resolve(__dirname, 'demo/index.html'),
        },
      },
    },
  });

  // 2. Build Service Worker (ES module)
  console.log('[Build] Building Service Worker...');
  await build({
    configFile: false,
    define: buildTimeDefine,
    build: {
      outDir: 'dist/background',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background/service-worker.ts'),
        name: 'ServiceWorker',
        formats: ['es'],
        fileName: () => 'service-worker.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 3. Build Content Script Bridge (IIFE, self-contained, no imports)
  console.log('[Build] Building Content Script Bridge (IIFE)...');
  await build({
    configFile: false,
    define: buildTimeDefine,
    build: {
      outDir: 'dist/content',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/content/bridge.ts'),
        name: 'ContentScriptBridge',
        formats: ['iife'],
        fileName: () => 'bridge.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 4. Build Page Context Provider Interceptor (IIFE, self-contained, no imports)
  console.log('[Build] Building Provider Interceptor (IIFE)...');
  await build({
    configFile: false,
    define: buildTimeDefine,
    build: {
      outDir: 'dist/page',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/page/provider-interceptor.ts'),
        name: 'ProviderInterceptor',
        formats: ['iife'],
        fileName: () => 'provider-interceptor.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 5. Copy manifest.json to dist/manifest.json
  console.log('[Build] Copying manifest.json to dist/manifest.json...');
  const manifest = JSON.parse(fs.readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'));
  // Chrome match patterns omit ports. Grant access only to the configured API host.
  manifest.host_permissions = [`${apiUrl.protocol}//${apiUrl.hostname}/*`];
  fs.writeFileSync(resolve(__dirname, 'dist/manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('[Build] Extension successfully built to dist/ ready for Chrome "Load unpacked"!');
}

runBuild().catch((err) => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});
