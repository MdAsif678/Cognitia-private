import {
  PageToExtensionMessage,
  ExtensionToPageMessage,
  InterceptedRequestMessage,
  AccountChangedMessage,
  ChainChangedMessage,
  ProviderDiscoveredMessage,
  AnalysisStartedMessage,
  AnalysisResultMessage,
  AnalysisUnavailableMessage,
  UserRejectMessage,
  UserContinueMessage,
  InvalidateRequestMessage,
  RiskSeverity,
} from './types';
import { APPLICATION_NAMESPACE } from './constants';

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

/**
 * Validates whether a value is a non-empty safe string.
 */
function isNonEmptyString(val: unknown, maxLen = 256): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

/**
 * Validates and sanitizes an incoming message from the untrusted PAGE context.
 * Enforces namespace, discriminated union types, and field constraints.
 * Strips prototype pollution attempts (__proto__, constructor).
 */
export function validatePageMessage(raw: unknown): ValidationResult<PageToExtensionMessage> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { success: false, error: 'Message payload must be a non-null object' };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Enforce application namespace
  if (obj.source !== APPLICATION_NAMESPACE) {
    return {
      success: false,
      error: `Invalid message source: expected "${APPLICATION_NAMESPACE}", received "${String(obj.source)}"`,
    };
  }

  // 2. Enforce direction
  if (obj.direction !== 'PAGE_TO_EXTENSION') {
    return {
      success: false,
      error: `Invalid message direction: expected "PAGE_TO_EXTENSION", received "${String(obj.direction)}"`,
    };
  }

  // 3. Discriminate by type
  switch (obj.type) {
    case 'INTERCEPTED_REQUEST': {
      if (!isNonEmptyString(obj.requestId)) {
        return { success: false, error: 'INTERCEPTED_REQUEST requires a non-empty string "requestId"' };
      }
      if (!isNonEmptyString(obj.method)) {
        return { success: false, error: 'INTERCEPTED_REQUEST requires a non-empty string "method"' };
      }
      if (!Array.isArray(obj.params)) {
        return { success: false, error: 'INTERCEPTED_REQUEST requires an array "params"' };
      }

      // Deep clone params to sever any mutable references or prototype chains
      let sanitizedParams: unknown[];
      try {
        sanitizedParams = JSON.parse(JSON.stringify(obj.params));
      } catch {
        return { success: false, error: 'INTERCEPTED_REQUEST params could not be safely serialized' };
      }

      // Best-effort chain/account context, strictly format-checked (never fabricated)
      const CHAIN_ID_PATTERN = /^(0x[0-9a-fA-F]+|\d+)$/;
      const ACCOUNT_PATTERN = /^0x[0-9a-fA-F]{40}$/;

      const sanitized: InterceptedRequestMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'INTERCEPTED_REQUEST',
        requestId: obj.requestId,
        method: obj.method,
        params: Object.freeze(sanitizedParams),
        providerId: typeof obj.providerId === 'string' ? obj.providerId : undefined,
        origin: typeof obj.origin === 'string' ? obj.origin : undefined,
        chainId:
          typeof obj.chainId === 'string' && CHAIN_ID_PATTERN.test(obj.chainId) ? obj.chainId : undefined,
        account:
          typeof obj.account === 'string' && ACCOUNT_PATTERN.test(obj.account) ? obj.account : undefined,
      };

      return { success: true, data: Object.freeze(sanitized) };
    }

    case 'ACCOUNT_CHANGED': {
      if (!Array.isArray(obj.accounts)) {
        return { success: false, error: 'ACCOUNT_CHANGED requires an array "accounts"' };
      }
      for (const item of obj.accounts) {
        if (typeof item !== 'string') {
          return { success: false, error: 'ACCOUNT_CHANGED accounts array must only contain strings' };
        }
      }

      const sanitized: AccountChangedMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'ACCOUNT_CHANGED',
        accounts: Object.freeze([...(obj.accounts as string[])]),
        providerId: typeof obj.providerId === 'string' ? obj.providerId : undefined,
        origin: typeof obj.origin === 'string' ? obj.origin : undefined,
      };

      return { success: true, data: Object.freeze(sanitized) };
    }

    case 'CHAIN_CHANGED': {
      if (!isNonEmptyString(obj.chainId)) {
        return { success: false, error: 'CHAIN_CHANGED requires a non-empty string "chainId"' };
      }

      const sanitized: ChainChangedMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'CHAIN_CHANGED',
        chainId: obj.chainId,
        providerId: typeof obj.providerId === 'string' ? obj.providerId : undefined,
        origin: typeof obj.origin === 'string' ? obj.origin : undefined,
      };

      return { success: true, data: Object.freeze(sanitized) };
    }

    case 'PROVIDER_DISCOVERED': {
      if (!isNonEmptyString(obj.providerId)) {
        return { success: false, error: 'PROVIDER_DISCOVERED requires a non-empty string "providerId"' };
      }
      if (!isNonEmptyString(obj.name)) {
        return { success: false, error: 'PROVIDER_DISCOVERED requires a non-empty string "name"' };
      }

      const sanitized: ProviderDiscoveredMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'PROVIDER_DISCOVERED',
        providerId: obj.providerId,
        name: obj.name,
        rdns: typeof obj.rdns === 'string' ? obj.rdns : undefined,
        isMetaMask: typeof obj.isMetaMask === 'boolean' ? obj.isMetaMask : undefined,
      };

      return { success: true, data: Object.freeze(sanitized) };
    }

    default:
      return {
        success: false,
        error: `Unexpected message type received from page: "${String(obj.type)}"`,
      };
  }
}

/**
 * Validates and sanitizes a message originating from the EXTENSION to be delivered to the PAGE.
 */
export function validateExtensionMessage(raw: unknown): ValidationResult<ExtensionToPageMessage> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { success: false, error: 'Extension message must be a non-null object' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.source !== APPLICATION_NAMESPACE) {
    return {
      success: false,
      error: `Invalid extension message source: expected "${APPLICATION_NAMESPACE}", received "${String(obj.source)}"`,
    };
  }

  if (obj.direction !== 'EXTENSION_TO_PAGE') {
    return {
      success: false,
      error: `Invalid extension message direction: expected "EXTENSION_TO_PAGE", received "${String(obj.direction)}"`,
    };
  }

  if (!isNonEmptyString(obj.requestId)) {
    return { success: false, error: 'Extension message requires a non-empty string "requestId"' };
  }

  switch (obj.type) {
    case 'ANALYSIS_STARTED': {
      const msg: AnalysisStartedMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'ANALYSIS_STARTED',
        requestId: obj.requestId as string,
      };
      return { success: true, data: Object.freeze(msg) };
    }

    case 'ANALYSIS_RESULT': {
      const validSeverities: RiskSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SAFE', 'UNKNOWN'];
      const severity = validSeverities.includes(obj.severity as RiskSeverity)
        ? (obj.severity as RiskSeverity)
        : 'UNKNOWN';

      const msg: AnalysisResultMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'ANALYSIS_RESULT',
        requestId: obj.requestId as string,
        severity,
        riskScore: typeof obj.riskScore === 'number' ? obj.riskScore : 50,
        summary: typeof obj.summary === 'string' ? obj.summary : 'Analysis completed.',
      };
      return { success: true, data: Object.freeze(msg) };
    }

    case 'ANALYSIS_UNAVAILABLE': {
      const msg: AnalysisUnavailableMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'ANALYSIS_UNAVAILABLE',
        requestId: obj.requestId as string,
        reason: typeof obj.reason === 'string' ? obj.reason : 'Backend unavailable',
      };
      return { success: true, data: Object.freeze(msg) };
    }

    case 'USER_REJECT': {
      const msg: UserRejectMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'USER_REJECT',
        requestId: obj.requestId as string,
        reason: typeof obj.reason === 'string' ? obj.reason : undefined,
      };
      return { success: true, data: Object.freeze(msg) };
    }

    case 'USER_CONTINUE': {
      const msg: UserContinueMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'USER_CONTINUE',
        requestId: obj.requestId as string,
      };
      return { success: true, data: Object.freeze(msg) };
    }

    case 'INVALIDATE_REQUEST': {
      const msg: InvalidateRequestMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'INVALIDATE_REQUEST',
        requestId: obj.requestId as string,
        reason: typeof obj.reason === 'string' ? obj.reason : 'Request invalidated',
      };
      return { success: true, data: Object.freeze(msg) };
    }

    default:
      return {
        success: false,
        error: `Unexpected extension message type: "${String(obj.type)}"`,
      };
  }
}
