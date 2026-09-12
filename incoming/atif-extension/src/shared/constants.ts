import { SupportedMethod, UnsupportedSigningMethod } from './types';

/**
 * Unique application namespace identifier required on all bridge messages.
 * Messages lacking this source namespace are dropped immediately at the content script boundary.
 */
export const APPLICATION_NAMESPACE = 'wallet-interceptor';

/**
 * Message channel identifier used to isolate and authenticate window.postMessage
 * traffic between the page context (MAIN world) and the content script (ISOLATED world).
 */
export const EVENT_BRIDGE_CHANNEL = '__PRE_EXECUTION_INTERCEPTOR_V1_BRIDGE__';


/**
 * Page-readable marker set on `window` once the MAIN-world interceptor is running, so a dapp can
 * distinguish "reviewed by Cognitia" from "the content script never injected".
 */
export const INTERCEPTOR_MARKER = '__cognitiaInterceptor';

/**
 * Explicitly supported signing and transaction methods.
 */
export const SUPPORTED_METHODS: readonly SupportedMethod[] = [
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'personal_sign',
] as const;

/**
 * Explicitly recognized unsupported signing variants.
 * These must be flagged as UNSUPPORTED rather than silently passed through.
 */
export const UNSUPPORTED_SIGNING_METHODS: readonly UnsupportedSigningMethod[] = [
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_sendRawTransaction',
] as const;

/**
 * Backend analysis configuration (API_BASE_URL, endpoint path, timeout)
 * lives in './config' — the single configurable source for the /v1/analyze integration.
 */

/**
 * Session storage keys for ephemeral persistence.
 */
export const STORAGE_KEYS = {
  CURRENT_PENDING_REQUEST: 'pre_exec_current_pending_request',
  REQUEST_STATE_PREFIX: 'pre_exec_req_',
} as const;

/**
 * EIP-6963 standard event strings.
 */
export const EIP6963_EVENTS = {
  ANNOUNCE: 'eip6963:announceProvider',
  REQUEST: 'eip6963:requestProvider',
} as const;

/**
 * Architectural limitation notice for hackathon evaluation.
 */
export const ARCHITECTURAL_LIMITATION_DISCLAIMER = `
[Hackathon Prototype Limitation Notice]
This extension demonstrates pre-execution interception in the browser page context.
Provider wrapping can be bypassed by:
1. Direct WebSocket / HTTP JSON-RPC connections made by dApps.
2. Scripts injected prior to extension document_start execution.
3. Multiple iframes with cross-origin or isolated window globals.
4. Hidden or renamed provider references not adhering to window.ethereum or EIP-6963.
`.trim();
