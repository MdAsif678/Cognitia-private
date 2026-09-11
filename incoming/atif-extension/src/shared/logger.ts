/**
 * Development-only logging helper.
 *
 * In production builds (process.env.NODE_ENV === "production", injected by Vite)
 * every method is a no-op: no analysis metadata and never any signing payload is
 * written to the console. In development the logger emits structured, payload-free
 * lines: requestId, API URL, HTTP status, analysis status.
 */
import { isDevelopmentMode } from './config';

export interface DevLogger {
  debug(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export function createDevLogger(scope: string): DevLogger {
  const prefix = `[${scope}]`;
  return {
    debug(message, ...details) {
      if (isDevelopmentMode()) console.log(prefix, message, ...details);
    },
    warn(message, ...details) {
      if (isDevelopmentMode()) console.warn(prefix, message, ...details);
    },
    error(message, ...details) {
      if (isDevelopmentMode()) console.error(prefix, message, ...details);
    },
  };
}
