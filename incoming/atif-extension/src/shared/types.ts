/**
 * Core TypeScript definitions and contracts for the Pre-Execution Transaction Interceptor
 * & Malicious Signature Simulator.
 */

import { AnalysisReport } from './api-contract';

// ==========================================
// 1. Supported & Unsupported Ethereum Methods
// ==========================================

export type SupportedMethod =
  | 'eth_sendTransaction'
  | 'eth_signTypedData_v4'
  | 'personal_sign';

export type UnsupportedSigningMethod =
  | 'eth_sign'
  | 'eth_signTypedData'
  | 'eth_signTypedData_v1'
  | 'eth_signTypedData_v3'
  | 'eth_sendRawTransaction';

export type EthereumMethod = SupportedMethod | UnsupportedSigningMethod | (string & {});

// ==========================================
// 2. Request State Machine Statuses
// ==========================================

export type RequestStatus =
  | 'IDLE'                 // No active intercepted request
  | 'INTERCEPTED'          // Request intercepted before wallet, awaiting backend analysis
  | 'ANALYZING'            // In-flight POST /v1/analyze
  | 'ANALYSIS_READY'       // Analysis completed successfully, risk report displayed to user
  | 'ANALYSIS_UNAVAILABLE' // Analysis backend timed out or errored; non-bypassable warning state
  | 'STALE'                // accountsChanged or chainChanged occurred while pending; invalidates report
  | 'FORWARDING'           // User clicked Continue; forwarding original request to wallet provider
  | 'COMPLETED'            // Wallet provider successfully resolved the forwarded request
  | 'REJECTED'             // User clicked Reject or request was dropped; rejected with EIP-1193 code 4001
  | 'FAILED';              // Wallet provider rejected or failed after forwarding

// ==========================================
// 3. EIP-1193 & EIP-6963 Provider Interfaces
// ==========================================

export interface EIP1193RequestArguments {
  readonly method: string;
  readonly params?: unknown[] | Record<string, unknown>;
}

export interface EIP1193Provider {
  request(args: EIP1193RequestArguments): Promise<unknown>;
  on?(eventName: string, listener: (...args: unknown[]) => void): void;
  removeListener?(eventName: string, listener: (...args: unknown[]) => void): void;
}

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export interface EIP6963AnnounceProviderEvent extends CustomEvent {
  type: 'eip6963:announceProvider';
  detail: EIP6963ProviderDetail;
}

// ==========================================
// 4. Pending Request Snapshot (Immutable)
// ==========================================

export interface ProviderContextInfo {
  name: string;
  rdns?: string;
  uuid?: string;
}

export interface PendingRequestSnapshot {
  readonly requestId: string;
  readonly timestamp: number;
  readonly origin: string;
  readonly method: EthereumMethod;
  readonly rawParams: unknown[];
  readonly chainId?: string;
  readonly account?: string;
  readonly providerInfo: ProviderContextInfo;
  /** Tab that holds the unresolved provider promise; Continue/Reject must be routed here. */
  readonly tabId?: number;
  status: RequestStatus;
  analysis?: AnalysisResult;
  error?: string;
  forwardedAt?: number;
  resolvedAt?: number;
}

// ==========================================
// 5. Backend Analysis Contracts
// ==========================================

// The wire contract with the analysis backend (AnalyzeRequest / AnalysisReport,
// validated at runtime with Zod) lives in './api-contract' and is the single
// shared source of truth for the extension <-> backend integration.

export type AnalysisStatus = 'safe' | 'warning' | 'danger' | 'unsupported' | 'unavailable';

export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type RiskSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE' | 'UNKNOWN';

export interface Finding {
  readonly id?: string;
  readonly severity: RiskSeverity | FindingSeverity;
  readonly title: string;
  readonly description: string;
  readonly explanation?: string;
  readonly evidence?: string | Record<string, unknown> | readonly unknown[];
  readonly confidence?: string;
}

export interface AssetTransferSimulation {
  readonly asset: string;
  readonly assetType: 'ERC20' | 'ERC721' | 'ERC1155' | 'NATIVE';
  readonly from: string;
  readonly to: string;
  readonly amount: string;
}

export interface AnalysisResult {
  readonly requestId: string;
  readonly status?: AnalysisStatus;
  readonly severity: RiskSeverity;
  /** Optional: the real backend contract carries no numeric score; never fabricate one. */
  readonly riskScore?: number;
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly simulationDiff?: {
    readonly outgoingTransfers: readonly AssetTransferSimulation[];
    readonly incomingTransfers: readonly AssetTransferSimulation[];
  };
  readonly warnings: readonly string[];
  readonly analyzedAt: number;
  /** The full validated backend report, preserved for future UI iterations. */
  readonly report?: AnalysisReport;
}


// ==========================================
// 6. Cross-Boundary Communication Protocol
// ==========================================

export type MessageSource = 'wallet-interceptor';

// -------------------------------------------------------------
// 6A. PAGE -> EXTENSION Messages (Discriminated by `type`)
// -------------------------------------------------------------

export interface InterceptedRequestMessage {
  readonly source: MessageSource;
  readonly direction: 'PAGE_TO_EXTENSION';
  readonly type: 'INTERCEPTED_REQUEST';
  readonly requestId: string;
  readonly method: string;
  readonly params: readonly unknown[];
  readonly providerId?: string;
  readonly origin?: string;
  /**
   * Best-effort current chain context tracked passively from provider events and
   * prior read-only provider calls (hex quantity, e.g. "0x1"). Never fabricated.
   */
  readonly chainId?: string;
  /** Best-effort currently active account (0x-prefixed address). Never fabricated. */
  readonly account?: string;
}

export interface AccountChangedMessage {
  readonly source: MessageSource;
  readonly direction: 'PAGE_TO_EXTENSION';
  readonly type: 'ACCOUNT_CHANGED';
  readonly accounts: readonly string[];
  readonly providerId?: string;
  readonly origin?: string;
}

export interface ChainChangedMessage {
  readonly source: MessageSource;
  readonly direction: 'PAGE_TO_EXTENSION';
  readonly type: 'CHAIN_CHANGED';
  readonly chainId: string;
  readonly providerId?: string;
  readonly origin?: string;
}

export interface ProviderDiscoveredMessage {
  readonly source: MessageSource;
  readonly direction: 'PAGE_TO_EXTENSION';
  readonly type: 'PROVIDER_DISCOVERED';
  readonly providerId: string;
  readonly name: string;
  readonly rdns?: string;
  readonly isMetaMask?: boolean;
}

export type PageToExtensionMessage =
  | InterceptedRequestMessage
  | AccountChangedMessage
  | ChainChangedMessage
  | ProviderDiscoveredMessage;

// -------------------------------------------------------------
// 6B. EXTENSION -> PAGE Messages (Discriminated by `type`)
// -------------------------------------------------------------

export interface AnalysisStartedMessage {
  readonly source: MessageSource;
  readonly direction: 'EXTENSION_TO_PAGE';
  readonly type: 'ANALYSIS_STARTED';
  readonly requestId: string;
}

export interface AnalysisResultMessage {
  readonly source: MessageSource;
  readonly direction: 'EXTENSION_TO_PAGE';
  readonly type: 'ANALYSIS_RESULT';
  readonly requestId: string;
  readonly severity: RiskSeverity;
  readonly riskScore: number;
  readonly summary: string;
  readonly findings?: readonly Finding[];
}

export interface AnalysisUnavailableMessage {
  readonly source: MessageSource;
  readonly direction: 'EXTENSION_TO_PAGE';
  readonly type: 'ANALYSIS_UNAVAILABLE';
  readonly requestId: string;
  readonly reason: string;
}

export interface UserRejectMessage {
  readonly source: MessageSource;
  readonly direction: 'EXTENSION_TO_PAGE';
  readonly type: 'USER_REJECT';
  readonly requestId: string;
  readonly reason?: string;
}

export interface UserContinueMessage {
  readonly source: MessageSource;
  readonly direction: 'EXTENSION_TO_PAGE';
  readonly type: 'USER_CONTINUE';
  readonly requestId: string;
}

export interface InvalidateRequestMessage {
  readonly source: MessageSource;
  readonly direction: 'EXTENSION_TO_PAGE';
  readonly type: 'INVALIDATE_REQUEST';
  readonly requestId: string;
  readonly reason: string;
}

export type ExtensionToPageMessage =
  | AnalysisStartedMessage
  | AnalysisResultMessage
  | AnalysisUnavailableMessage
  | UserRejectMessage
  | UserContinueMessage
  | InvalidateRequestMessage;

// -------------------------------------------------------------
// 6C. Content Script <-> Background Service Worker Protocol
// -------------------------------------------------------------

export type ContentToBackgroundMessage = {
  readonly source: MessageSource;
  readonly type: 'CONTENT_RELAY_TO_BACKGROUND';
  readonly payload: PageToExtensionMessage;
  readonly tabId?: number;
};

export type BackgroundToContentMessage = {
  readonly source: MessageSource;
  readonly type: 'BACKGROUND_RELAY_TO_PAGE';
  readonly payload: ExtensionToPageMessage;
};

// -------------------------------------------------------------
// 6D. Side Panel <-> Background Service Worker Protocol
// -------------------------------------------------------------

export type SidepanelAction =
  | {
      readonly type: 'USER_CLICK_CONTINUE';
      readonly requestId: string;
    }
  | {
      readonly type: 'USER_CLICK_REJECT';
      readonly requestId: string;
      readonly reason?: string;
    }
  | {
      readonly type: 'GET_ACTIVE_REQUEST';
    };

export type BackgroundToSidepanelMessage =
  | {
      readonly type: 'ACTIVE_REQUEST_SYNC';
      readonly snapshot: PendingRequestSnapshot | null;
    }
  | {
      readonly type: 'REQUEST_STATUS_UPDATED';
      readonly requestId: string;
      readonly status: RequestStatus;
      readonly analysis?: AnalysisResult;
      readonly error?: string;
    };

