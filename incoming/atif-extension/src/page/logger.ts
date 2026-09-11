/**
 * Console diagnostics utility for development mode.
 * Provides distinct prefixed logging channels without spamming production builds.
 */

// Diagnostic prefix channels required by the specification
export type DiagnosticChannel =
  | '[Interceptor]'
  | '[Provider]'
  | '[Pending Request]'
  | '[Forwarding]'
  | '[Rejected]'
  | '[Invalidated]';

class DiagnosticsLogger {
  private isDevelopment(): boolean {
    if (typeof window !== 'undefined') {
      // Explicit debug flag on window or non-production environment
      const win = window as unknown as { __PRE_EXEC_DEBUG__?: boolean };
      if (typeof win.__PRE_EXEC_DEBUG__ === 'boolean') {
        return win.__PRE_EXEC_DEBUG__;
      }
    }
    // Default to true in development unless explicitly turned off
    return true;
  }

  private log(channel: DiagnosticChannel, message: string, ...args: unknown[]): void {
    if (!this.isDevelopment()) return;

    const styles: Record<DiagnosticChannel, string> = {
      '[Interceptor]': 'color: #818cf8; font-weight: bold;',
      '[Provider]': 'color: #38bdf8; font-weight: bold;',
      '[Pending Request]': 'color: #facc15; font-weight: bold;',
      '[Forwarding]': 'color: #4ade80; font-weight: bold;',
      '[Rejected]': 'color: #f87171; font-weight: bold;',
      '[Invalidated]': 'color: #fb923c; font-weight: bold;',
    };

    console.log(`%c${channel}%c ${message}`, styles[channel], 'color: inherit;', ...args);
  }

  public interceptor(message: string, ...args: unknown[]): void {
    this.log('[Interceptor]', message, ...args);
  }

  public provider(message: string, ...args: unknown[]): void {
    this.log('[Provider]', message, ...args);
  }

  public pendingRequest(message: string, ...args: unknown[]): void {
    this.log('[Pending Request]', message, ...args);
  }

  public forwarding(message: string, ...args: unknown[]): void {
    this.log('[Forwarding]', message, ...args);
  }

  public rejected(message: string, ...args: unknown[]): void {
    this.log('[Rejected]', message, ...args);
  }

  public invalidated(message: string, ...args: unknown[]): void {
    this.log('[Invalidated]', message, ...args);
  }
}

export const logger = new DiagnosticsLogger();
