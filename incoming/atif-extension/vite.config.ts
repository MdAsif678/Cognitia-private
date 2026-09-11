import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Vite configuration for Chrome Extension Manifest V3
// Builds multi-entry outputs: Side Panel UI, Background Service Worker, Content Bridge, and Page Interceptor
export default defineConfig(({ mode }) => {
  // Load .env files (API_BASE_URL) so the backend URL can be baked into the build
  const env = loadEnv(mode, __dirname, '');

  return {
    plugins: [react()],
    define: {
      // Statically injected into every bundle; see src/shared/config.ts
      'process.env.API_BASE_URL': JSON.stringify(env.API_BASE_URL ?? ''),
      'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV ?? mode),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          sidepanel: resolve(__dirname, 'sidepanel/index.html'),
          demo: resolve(__dirname, 'demo/index.html'),
          fixtures: resolve(__dirname, 'demo/fixtures.html'),
          'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
          'content-bridge': resolve(__dirname, 'src/content/bridge.ts'),
          'provider-interceptor': resolve(__dirname, 'src/page/provider-interceptor.ts'),
        },
        output: {
          entryFileNames: (chunkInfo) => {
            if (chunkInfo.name === 'service-worker') {
              return 'background/service-worker.js';
            }
            if (chunkInfo.name === 'content-bridge') {
              return 'content/bridge.js';
            }
            if (chunkInfo.name === 'provider-interceptor') {
              return 'page/provider-interceptor.js';
            }
            return 'assets/[name]-[hash].js';
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  };
});
