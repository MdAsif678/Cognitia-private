/**
 * EIP-1193 compliant Ethereum RPC error structures and error factory utilities.
 */

export interface EthereumProviderErrorData {
  code: number;
  message: string;
  data?: unknown;
}

export class EthereumRpcError extends Error implements EthereumProviderErrorData {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'EthereumRpcError';
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, EthereumRpcError.prototype);
  }
}

/**
 * Standard EIP-1193 / EIP-1474 error codes
 */
export const ERROR_CODES = {
  USER_REJECTED_REQUEST: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Creates an EIP-1193 error representing user cancellation/rejection.
 * Used whenever the user clicks 'Reject' or closes the approval flow.
 */
export function createUserRejectedError(customMessage?: string): EthereumRpcError {
  return new EthereumRpcError(
    ERROR_CODES.USER_REJECTED_REQUEST,
    customMessage ?? 'User rejected the transaction/signature request (Pre-Execution Interceptor).'
  );
}

/**
 * Creates an EIP-1193 error for an unsupported signing method.
 */
export function createUnsupportedMethodError(method: string): EthereumRpcError {
  return new EthereumRpcError(
    ERROR_CODES.UNSUPPORTED_METHOD,
    `The signing method "${method}" is not supported by the Pre-Execution Interceptor.`
  );
}

/**
 * Creates an error for invalidated/stale requests.
 */
export function createStaleRequestError(): EthereumRpcError {
  return new EthereumRpcError(
    ERROR_CODES.INTERNAL_ERROR,
    'The transaction request was invalidated due to an account or network change.'
  );
}
