/**
 * Environment / configuration support for the analysis backend integration.
 *
 * Resolution order for the API base URL:
 *   1. Build-time injected value — Vite `define` statically replaces the literal
 *      `process.env.API_BASE_URL` expression below with the value present in the
 *      build environment (including any `.env` file loaded at build time).
 *      The literal is read inside a try/catch WITHOUT a `typeof process` guard,
 *      because such a guard always short-circuits first in the service worker
 *      (where `process` does not exist) and the injected value would never load.
 *   2. Runtime environment (Node / test processes) via globalThis.process.env.
 *      `API_BASE_URL` is authoritative; the legacy `ANALYZER_BASE_URL` is still honored.
 *   3. Development default (local mock backend).
 */

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

interface ProcessLike {
  env?: Record<string, string | undefined>;
}

/**
 * Reads the build-time injected API base URL.
 * The exact expression `process.env.API_BASE_URL` is replaced at build time by the
 * Vite `define` in vite.config.ts / build.mjs. If a bundle is built without the
 * define, the bare reference throws in the service worker and is caught here.
 */
function buildTimeApiBaseUrl(): string | undefined {
  try {
    return process.env.API_BASE_URL;
  } catch {
    return undefined;
  }
}

/**
 * Reads the build-time injected NODE_ENV. Replaced by Vite `define`; defaults to
 * "production" in release builds so development logging stays off.
 */
function buildTimeNodeEnv(): string | undefined {
  try {
    return process.env.NODE_ENV;
  } catch {
    return undefined;
  }
}

function runtimeProcessEnv(): Record<string, string | undefined> | undefined {
  return (globalThis as unknown as { process?: ProcessLike }).process?.env;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function resolveApiBaseUrl(): string {
  const injected = buildTimeApiBaseUrl();
  if (injected && injected.trim().length > 0) {
    return normalizeBaseUrl(injected);
  }

  const env = runtimeProcessEnv();
  if (env?.API_BASE_URL && env.API_BASE_URL.trim().length > 0) {
    return normalizeBaseUrl(env.API_BASE_URL);
  }
  // Legacy variable name kept for backward compatibility with earlier prototype builds.
  if (env?.ANALYZER_BASE_URL && env.ANALYZER_BASE_URL.trim().length > 0) {
    return normalizeBaseUrl(env.ANALYZER_BASE_URL);
  }

  return DEFAULT_API_BASE_URL;
}

/**
 * Development-mode detection. Release builds inject NODE_ENV="production" via
 * Vite `define`, disabling all developer logging so that no analysis metadata
 * is ever written to the console in production (signing payloads are never logged
 * in any mode). Unknown NODE_ENV fails safe: treated as production.
 */
export function isDevelopmentMode(): boolean {
  const nodeEnv = buildTimeNodeEnv();
  if (nodeEnv !== undefined) {
    return nodeEnv !== 'production';
  }
  const env = runtimeProcessEnv();
  if (env?.NODE_ENV !== undefined) {
    return env.NODE_ENV !== 'production';
  }
  return false;
}

export const API_CONFIG = {
  BASE_URL: resolveApiBaseUrl(),
  ANALYZE_ENDPOINT_PATH: '/v1/analyze',
  // Real fork simulation takes 2–10 s on public RPCs; the backend's own ceiling is 45 s.
  TIMEOUT_MS: 20000,
} as const;
