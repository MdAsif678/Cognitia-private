# Pre-Execution Transaction Interceptor & Malicious Signature Simulator

> **Hackathon Interception Prototype**  
> Intercepts Ethereum wallet signing requests in the browser **before** MetaMask or any other wallet provider receives them, transmits the payload to an analysis backend (`/v1/analyze`), renders an interactive risk assessment in an extension-owned Side Panel, and strictly guarantees single-invocation forwarding or EIP-1193 rejection.

---

## ⚠️ Prototype Scope & Architectural Limitations

> [!IMPORTANT]
> **This is a hackathon interception prototype, NOT universal wallet security.**
> 
> Browser-level provider wrapping in the webpage's `MAIN` execution context operates under fundamental web security boundaries:
> 1. **Alternate Provider References:** DApps can query alternate globals, cached local variables, or custom RPC providers instantiated before extension injection.
> 2. **Injection Races:** If a dApp loads synchronous scripts that capture `window.ethereum` before Chrome's `document_start` completes, wrapping may be bypassed.
> 3. **Nested Iframes:** Sandboxed or cross-origin iframes with unique browsing contexts may communicate directly with wallets or RPCs without inheriting the parent window's proxies.
> 4. **Direct Network RPCs:** DApps utilizing backend gasless signers or direct HTTP/WebSocket JSON-RPC transports bypass client-side provider proxies entirely.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------------------+
| WEBPAGE CONTEXT (world: MAIN)                                                          |
| - provider-discovery.ts: Traps window.ethereum & intercepts EIP-6963 announcements      |
| - provider-interceptor.ts: Proxies provider.request(), holds unresolved Promise        |
|   * Intercepts: eth_sendTransaction, eth_signTypedData_v4, personal_sign               |
|   * Flags: eth_sign, eth_signTypedData_v1/v3, eth_sendRawTransaction as UNSUPPORTED     |
|   * Listens: accountsChanged, chainChanged (dispatches invalidation signal)            |
+-----------------------------------------------------------------------------------------+
                                          │
                              window.postMessage()
              (Validated EVENT_BRIDGE_CHANNEL, scoped window.location.origin)
                                          ▼
+-----------------------------------------------------------------------------------------+
| ISOLATED CONTENT SCRIPT (world: ISOLATED)                                               |
| - bridge.ts: Validates MessageEvent, relays to Extension Service Worker                 |
+-----------------------------------------------------------------------------------------+
                                          │
                        chrome.runtime.sendMessage / onMessage
                                          ▼
+-----------------------------------------------------------------------------------------+
| EXTENSION SERVICE WORKER (Background MV3)                                               |
| - service-worker.ts: Central dispatcher, tab tracking, sidepanel orchestration           |
| - pendingRequests.ts: Ephemeral session persistence (chrome.storage.session)            |
| - analyzer.ts: AbortController-timed fetch to /v1/analyze with fail-closed guarantee     |
+-----------------------------------------------------------------------------------------+
                                          │
                             Extension Internal Messaging
                                          ▼
+-----------------------------------------------------------------------------------------+
| SIDE PANEL UI (React + Vite, Extension-Owned)                                          |
| - App.tsx: State machine view coordinator                                               |
| - Components: Loading, RiskReport, AnalysisUnavailable, Forwarding, Rejected           |
+-----------------------------------------------------------------------------------------+
```

---

## State Machine

The lifecycle of every transaction request strictly obeys the following 10-state finite state machine:

| State | Description | Next Permitted States |
|---|---|---|
| `IDLE` | Standby mode; listening for wallet requests. | `INTERCEPTED` |
| `INTERCEPTED` | Intercepted in page context; snapshot created and held pending. | `ANALYZING`, `STALE` |
| `ANALYZING` | In-flight HTTP POST to `/v1/analyze` (5s timeout). | `ANALYSIS_READY`, `ANALYSIS_UNAVAILABLE`, `STALE` |
| `ANALYSIS_READY` | Backend returned risk report; awaiting user decision. | `FORWARDING`, `REJECTED`, `STALE` |
| `ANALYSIS_UNAVAILABLE` | Backend timed out or errored; non-bypassable warning state. | `FORWARDING` (Explicit ack), `REJECTED` |
| `STALE` | `accountsChanged` or `chainChanged` fired; simulation invalidated. | `REJECTED`, `INTERCEPTED` |
| `FORWARDING` | User approved; forwarding exact original method & params once. | `COMPLETED`, `FAILED` |
| `COMPLETED` | Wallet provider successfully signed or broadcasted. | `IDLE` |
| `REJECTED` | Rejected with EIP-1193 error code 4001; original provider never called. | `IDLE` |
| `FAILED` | Wallet provider threw an error or network RPC failed. | `IDLE` |

---

## Supported vs. Unsupported Methods

### Supported Methods (Full Interception & Simulation)
1. `eth_sendTransaction`: Evaluates contract addresses, native ETH transfer values, gas parameters, and simulated token state diffs.
2. `eth_signTypedData_v4`: Decodes structured EIP-712 schemas to detect permit exploits, sea-port listings, and excessive token approvals.
3. `personal_sign`: Decodes UTF-8 and hex messages to detect phishing signatures and authorization grants.

### Unsupported Methods (Explicitly Flagged & Denied)
- `eth_sign`
- `eth_signTypedData` (v1)
- `eth_signTypedData_v3`
- `eth_sendRawTransaction`

Rather than silently passing legacy or obscure signing methods through to the wallet, the interceptor explicitly catches them and rejects them with EIP-1193 Error Code `4200` (`Unsupported Method`).

---

## Core Architectural Explanations

### 1. What each component does
- **`src/page/provider-discovery.ts`**: Intercepts `window.ethereum` via property getters/setters and monitors `eip6963:announceProvider` capture-phase events. Re-dispatches `eip6963:requestProvider` to discover all wallets.
- **`src/page/provider-interceptor.ts`**: Wraps the wallet's `request()` method. When a supported method is called, it halts execution by storing the `resolve` and `reject` functions in an in-memory `Map` keyed by a UUID `requestId`.
- **`src/content/bridge.ts`**: An isolated-world relay that prevents untrusted website scripts from calling Chrome Extension APIs directly while safely passing serialized events.
- **`src/background/service-worker.ts`**: Coordinates the active request, triggers the `/v1/analyze` network request, triggers the Side Panel to open, and dispatches actions to the tab.
- **`src/background/pendingRequests.ts`**: Manages the request state machine and stores active state in `chrome.storage.session` so that service worker suspensions do not lose state.
- **`src/background/analyzer.ts`**: Implements fail-closed HTTP requests to `/v1/analyze` with an `AbortController` 5000ms timeout.
- **`src/sidepanel/App.tsx` & Components**: Isolated, extension-owned React application that displays simulation diffs and enforces UI double-click guards.

### 2. How Page -> Content -> Extension communication works
1. **Page to Content**: `provider-interceptor.ts` invokes `window.postMessage({ channel: EVENT_BRIDGE_CHANNEL, direction: 'PAGE_TO_CONTENT', ... }, window.location.origin)`.
2. **Content Script Verification**: `bridge.ts` checks `event.source === window`, `event.origin === window.location.origin`, and validates the unique channel token before parsing the payload.
3. **Content to Background**: `bridge.ts` calls `chrome.runtime.sendMessage({ type: 'BRIDGE_INTERCEPTED_REQUEST', payload })`.
4. **Background to Side Panel**: The service worker persists the snapshot and notifies open Side Panel instances using `chrome.runtime.sendMessage({ type: 'REQUEST_STATUS_UPDATED', ... })`.
5. **Reverse Direction**: When user clicks Continue or Reject in the Side Panel, the action travels: Side Panel -> Service Worker -> `chrome.tabs.sendMessage` -> Content Script -> `window.postMessage` -> Page Context.

### 3. How the original provider call stays unresolved
In JavaScript, an asynchronous function remains in a pending state as long as the returned `Promise` is neither resolved nor rejected.
```ts
return new Promise((resolve, reject) => {
  const requestId = crypto.randomUUID();
  this.pendingPromises.set(requestId, {
    resolve,
    reject,
    originalRequest,
    provider: targetProvider,
    originalArgs,
    forwarded: false,
    rejected: false,
  });
  // Original provider.request is NOT called here!
  // Execution is paused from the perspective of the calling dApp.
});
```
The Promise resolver functions (`resolve`, `reject`) cannot be serialized across `postMessage` or Chrome messaging channels. They remain in the page memory `Map`. Only serializable metadata (`requestId`, `method`, `params`) is passed to the extension.

### 4. How Continue guarantees exactly one forwarding call
Double-forwarding is prevented at three distinct layers:
1. **UI Layer (`RiskReport.tsx`)**: The Continue and Reject buttons immediately set `isProcessing = true`, disabling further clicks.
2. **Service Worker Layer (`pendingRequests.ts`)**: An `actionLock` and state check ensures transitions to `FORWARDING` can only happen from `ANALYSIS_READY`. Subsequent requests for the same `requestId` are rejected.
3. **Page Interceptor Layer (`provider-interceptor.ts`)**:
```ts
if (record.forwarded || record.rejected) {
  return; // Strict guard against duplicate execution
}
record.forwarded = true;
const result = await record.originalRequest.call(record.provider, record.originalArgs);
record.resolve(result);
this.pendingPromises.delete(requestId);
```

### 5. How account/chain changes invalidate the report
DApps often switch accounts or change networks during an active session. If an analysis was performed on Chain A (e.g. Ethereum Mainnet) or Account A, but the user switches to Chain B or Account B in MetaMask before clicking Continue, the risk simulation is completely invalid.

1. `provider-interceptor.ts` registers event listeners on the provider:
   ```ts
   provider.on('accountsChanged', (accounts) => notifyStateChanged('accountsChanged', accounts));
   provider.on('chainChanged', (chainId) => notifyStateChanged('chainChanged', chainId));
   ```
2. The event is relayed across the bridge to `service-worker.ts`.
3. `pendingRequests.ts` immediately transitions the active request to `STALE`.
4. The Side Panel renders an explicit red invalidation banner, disabling the Continue button until re-simulation or rejection.

---

## Installation & Build

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build extension bundle:
   ```bash
   npm run build
   ```
3. Load in Google Chrome:
   - Navigate to `chrome://extensions`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked**
   - Select the `dist/` directory generated by Vite.
