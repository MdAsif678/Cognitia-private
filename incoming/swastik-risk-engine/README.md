# Cognitia — EVM Transaction & Signature Risk Analyzer

An EVM transaction and signature risk engine featuring decoded intent trees, multi-modal threat correlation (address, bytecode hash, behavioral, and domain indicators), isolated fork simulations with state overrides, and a deterministic severity-ranked findings matrix.

---

## Architecture Overview

Cognitia decomposes EVM authorization payloads into structured ASTs, runs deterministic risk evaluations, models state modifications on isolated forks, and formats findings with plain-English explanations, structured evidence, and confidence scores.

```
                    ┌─────────────────────────────────────────┐
                    │       AnalysisRequest (Zod Schema)      │
                    │   - Transaction (calldata, value, to)   │
                    │   - EIP-712 (Permit, Permit2, Typed)    │
                    │   - personal_sign (Hex / ASCII)         │
                    └────────────────────┬────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
┌─────────────────────────┐    ┌───────────────────┐            ┌───────────────────┐
│      IntentDecoder      │    │ SignatureAdapters │            │  ThreatProvider   │
│ Standard ABI Variants   │    │ ERC-2612 Permit   │            │ Address indicators│
│ Overlapping Ambiguity   │    │ Permit2 (Uniswap) │            │ Bytecode hashes   │
│ Proxy Resolution        │    │ personal_sign     │            │ Behavioral rules  │
│ Router Adapter Registry │    │ Domain check      │            │ Phishing domains  │
│ Safety Truncation Limits│    └─────────┬─────────┘            └─────────┬─────────┘
└────────────┬────────────┘              │                                │
             │                           │                                │
             └───────────────────────────┼────────────────────────────────┘
                                         │
                                         ▼
                       ┌───────────────────────────────────┐
                       │        SimulationProvider         │
                       │   Local Anvil Isolated Fork       │
                       │   State-Override Allowance Model  │
                       │   Conditional Outcome Tagging     │
                       └─────────────────┬─────────────────┘
                                         │
                                         ▼
                       ┌───────────────────────────────────┐
                       │     DeterministicRulesEngine      │
                       │   Critical / High / Medium /      │
                       │   Low / Unknown Severity Matrix   │
                       │   Never labels report "safe"      │
                       └─────────────────┬─────────────────┘
                                         │
                                         ▼
                       ┌───────────────────────────────────┐
                       │    AnalysisReport (JSON API / UI) │
                       │    Summary, Risk Score (0-100),   │
                       │    Coverage, Findings, Evidence   │
                       └───────────────────────────────────┘
```

---

## Transaction Intent Decoder (`src/engine/intentDecoder.ts`)

The intent decoder resolves the underlying semantics of EVM calldata payloads:

### 1. Supported Standard ABI Variants
- **ERC-20**: `approve(address,uint256)`, `transfer(address,uint256)`, `transferFrom(address,address,uint256)`.
- **ERC-721**: `transferFrom(address,address,uint256)`, `safeTransferFrom(address,address,uint256)`, `safeTransferFrom(address,address,uint256,bytes)`, `setApprovalForAll(address,bool)`.
- **ERC-1155**: `safeTransferFrom(address,address,uint256,uint256,bytes)`, `safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)`, `setApprovalForAll(address,bool)`.
- **ERC-2612**: `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)`.

### 2. Overlapping Selector Ambiguity Resolution
- `0x23b872dd` (`transferFrom(address,address,uint256)`): Arguments alone cannot distinguish whether parameter 2 is an ERC-20 token amount or an ERC-721 tokenId.
  - If contract interface evidence confirms ERC-721: resolved to `assetStandard: 'ERC-721'`, setting `tokenIds`.
  - If contract interface evidence confirms ERC-20: resolved to `assetStandard: 'ERC-20'`, setting `amount`.
  - When interface is unproven: preserves ambiguity as `assetStandard: 'ERC-20 | ERC-721 (ambiguous)'` and logs an unresolved question without guessing.
- `0xa22cb465` (`setApprovalForAll(address,bool)`): Shared between ERC-721 and ERC-1155.
  - When interface is unproven: preserves ambiguity as `assetStandard: 'ERC-721 | ERC-1155 (ambiguous)'`.

### 3. Unknown Functions Workflow & Proxy Resolution
1. Attempts verified ABI lookup for the configured chain and address.
2. Resolves proxy implementation at analysis block (EIP-1967, EIP-1822, OpenZeppelin) and records both proxy address and implementation address in `proxyInfo` with `abiProvenance: 'proxy_implementation'`.
3. Queries public 4-byte database *only* for candidate signatures (`isCandidate: true`, with disclaimer: `"A selector match does not prove a function's meaning"`).
4. Preserves raw calldata even when decoding succeeds.
5. Explicitly marks the function unknown (`isUnknownFunction: true`, `confidence: { level: 'low' }`) if meaning remains unresolved.

### 4. Router & Multicall Adapter Registry (`src/engine/adapters/`)
- Explicit registry of supported router contracts:
  - `Multicall3Adapter`: Preserves `target`, caller, `callType: 'call'`, and subcall values.
  - `OpenZeppelinMulticallAdapter`: Preserves `target: address(this)`, caller, and `callType: 'delegatecall'`.
  - `FixtureTestRouterAdapter`: Explicitly labeled fixture-only adapter support (`isFixtureOnly: true`) for testing multi-call batch dispatch.
- **Safety Invariant:** Arbitrary byte sequences are never assumed to be nested calls. Only contracts matching registered adapter identity and ABIs are recursively unwrapped.
- **Limits & Truncation:** Enforces `maxRecursionDepth` (5), `maxCalldataSize` (128 KB), and `maxSubcalls` (50), generating structured `truncationReport` objects when exceeded.

---

## Shared Schemas (`src/schemas/`)

All schemas are strictly defined and validated via **Zod**:

1. **`AnalysisRequest` (`src/schemas/request.ts`)**:
   - `transaction`: `chainId`, `from`, `to`, `value` (lossless decimal string), `calldata`.
   - `eip712`: `expectedSigner`, `selectedChainId`, `payload: { types, primaryType, domain, message }`.
   - `personal_sign`: `expectedSigner`, `rawMessage`, `chainId` (optional).
   - *Rule:* Values are never assumed zero if missing; validation fails explicitly.

2. **`DecodedIntent` (`src/schemas/intent.ts`)**:
   - Supports recursive nested calls for `Multicall3` and `Uniswap Universal Router`.
   - Distinguishes standard ABIs, candidate selector directory lookups (`"A selector match does not prove a function's meaning"`), and unverified unknown functions (`isUnknownFunction: true`).

3. **`Evidence` (`src/schemas/evidence.ts`)**:
   - Contains: `id, type, provenance, relevantAddresses, chainId, blockNumber/blockHash, rawSupportingData`.

4. **`Finding` (`src/schemas/finding.ts`)**:
   - Contains: `id, ruleId, severity, title, plainEnglishExplanation, evidenceIds, confidence ({ level, reason }), assumptions, executionContext`.
   - Severities: `critical`, `high`, `medium`, `low`, `unknown`.
   - Execution contexts: `decoded_intent`, `observed_simulation`, `conditional_modeling`.

5. **`Coverage` (`src/schemas/coverage.ts`)**:
   - Separate tracking for `calldataDecoding`, `signatureAnalysis`, `simulation`, `threatMatching`.
   - Statuses: `complete`, `partial`, `unsupported`, `failed`.

6. **`SimulationResult` (`src/schemas/simulation.ts`)**:
   - Asset balance deltas serialized as signed decimal strings.
   - For permits: labeled explicitly with `“Conditional outcome if this permit is signed and accepted.”` and disclosed state-override assumptions.

7. **`AnalysisReport` (`src/schemas/report.ts`)**:
   - Overall severity, risk score (0-100), executive summary, findings, and evidence.
   - *Safety invariant:* Under no circumstances will a report summary state that a transaction "is safe".

---

## Severity Rules Matrix

| Condition | Severity | Plain-English Summary |
|---|---|---|
| Documented malicious spender receives spending authority | **Critical** | Spender address is an identified threat actor / drainer gang. |
| Simulated asset outflow to documented malicious recipient | **Critical** | Simulation reveals asset transfer to a documented threat actor. |
| Transaction originates from documented phishing domain | **Critical** | Domain listed in security blacklist (MetaMask detect). |
| Unlimited approval to an unknown spender | **High** | Approval exceeds 2^128 safety threshold to an unverified address. |
| Collection-wide NFT approval (`setApprovalForAll(true)`) | **High** | Full transfer authority granted across all NFTs in contract. |
| Suspicious disguised transaction in `personal_sign` | **High** | 32-byte hex hash or approval keywords disguised as text. |
| Candidate selector from public directory | **Medium** | Heuristic 4-byte match with unverified disclaimer. |
| Unknown function with unresolved effects | **Unknown** | Selector not in ABI database; coverage partial/warning. |
| Standard transfer with no suspicious findings | **Low** | All deterministic checks passed. Low observed risk. |

---

## Local Setup & Exact Commands

### Prerequisites
- Node.js >= 18.18.0
- npm >= 9.0.0
- (Optional) Foundry Anvil CLI for live local fork simulation (`curl -L https://foundry.paradigm.xyz | bash && foundryup`). If Anvil is not installed, Cognitia automatically and gracefully falls back to its deterministic in-memory simulation engine.

### Exact Commands

```bash
# 1. Install dependencies
npm install

# 2. Run complete test suite (124 unit and end-to-end tests)
npm test

# 3. Run TypeScript type checks
npx tsc --noEmit

# 4. Run ESLint linting checks
npm run lint

# 5. Build production bundle
npm run build

# 6. Start development server (UI at http://localhost:3000)
npm run dev

# 7. Start production server (after build)
npm start
```

---

## Required Environment Variables

Copy `.env.example` to `.env.local` to customize RPC endpoints and Anvil settings:

```bash
cp .env.example .env.local
```

| Variable | Default | Purpose |
|---|---|---|
| `DEFAULT_CHAIN_ID` | `1` | Default chain ID for transaction analysis (Ethereum Mainnet). |
| `ETHEREUM_RPC_URL` | `"https://eth.llamarpc.com"` | Read-only RPC URL for Mainnet state reads and Anvil fork initialization. |
| `SEPOLIA_RPC_URL` | `"https://rpc.sepolia.org"` | Read-only RPC URL for Sepolia testnet. |
| `POLYGON_RPC_URL` | `"https://polygon-rpc.com"` | Read-only RPC URL for Polygon PoS. |
| `ARBITRUM_RPC_URL` | `"https://arb1.arbitrum.io/rpc"` | Read-only RPC URL for Arbitrum One. |
| `ANVIL_PATH` | `"anvil"` | Path to the local Anvil binary. |
| `ANVIL_PORT` | `8545` | Port for the local isolated Anvil worker. |
| `ANVIL_AUTO_SPAWN` | `true` | Automatically spawn local Anvil sub-process on demand. |
| `ETHERSCAN_API_KEY` | `""` | Optional API key for verified contract ABI lookups. |

> [!IMPORTANT]
> **No Private Keys**: Cognitia never requires, accepts, or stores private keys. All simulation happens on isolated local forks created from read-only RPC snapshots. Transactions are **never** broadcast to public RPCs.

---

## Supported Chains, Tokens, and Adapters

### 1. Supported Chains
- **Ethereum Mainnet** (`chainId: 1`)
- **Sepolia Testnet** (`chainId: 11155111`)
- **Polygon PoS** (`chainId: 137`)
- **Arbitrum One** (`chainId: 42161`)

### 2. Supported Tokens & Precision Handling
- **Canonical Tokens (Verified Decimals & Symbols)**:
  - USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`): 6 decimals
  - USDT (`0xdAC17F958D2ee523a2206206994597C13D831ec7`): 6 decimals
  - DAI (`0x6B175474E89094C44Da98b954EedeAC495271d0F`): 18 decimals
  - WETH (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`): 18 decimals
  - Native ETH (`0x0000000000000000000000000000000000000000`): 18 decimals
- **Exact Unit Formatting**:
  - `MAX_UINT256` (`2^256 - 1`) is explicitly rendered as `"Unlimited (2^256 - 1)"`.
  - `0` is explicitly rendered as `"0 (Revocation / None)"`.
  - **No-Guessing Policy**: For unverified tokens, exact raw base units are displayed without guessing decimals or symbols (e.g. `1234567 base units` with an explicit label `"Decimals and symbol unverified"`).

### 3. Signature & Calldata Adapters
- **ERC-2612 Permit Adapter (`Erc2612SignatureAdapter`)**:
  - Validates typed data structure and signer vs owner.
  - Rejects zero-address owners.
  - Compares deadline to pinned block timestamp.
  - Compares nonce against on-chain `nonces(owner)`.
  - Reconstructs EIP-712 domain separator and compares against on-chain `DOMAIN_SEPARATOR()`.
  - Simulates unsigned permits under `conditional_modeling` using isolated state overrides.
- **personal_sign Adapter (`PersonalSignSignatureAdapter`)**:
  - Preserves raw message bytes and generates hexadecimal view.
  - UTF-8 validation and printable ASCII decoding.
  - Detects disguised 32-byte hash authorizations (eth_sign bypasses) and embedded approval keywords.
  - Displays requested signer and supplied origin metadata (noting origin is client-supplied).
- **Generic EIP-712 Adapter (`GenericEip712Adapter`)**:
  - Preserves complete original payload and extracts recognized fields as candidates.
  - Returns `partial` / `unsupported` coverage, strictly preventing false low-risk verdicts.
- **Router / Multicall Adapters**:
  - `Multicall3Adapter`: Canonical Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`).
  - `OpenZeppelinMulticallAdapter`: OpenZeppelin Multicall (`delegatecall` semantics).
  - `FixtureTestRouterAdapter`: Labeled fixture batch dispatcher for testing.
- **Next Dedicated Adapter — Permit2 (Uniswap)**:
  - Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) is currently registered with an explicit unsupported coverage status and a dedicated adapter extension point (`src/providers/signatureAdapters/permit2Adapter.ts`).
  - Scheduled as the next dedicated adapter following ERC-2612 acceptance verification.

---

## Fork-Worker Isolation & Cleanup (`src/simulator/`)

1. **Deterministic Snapshot Pinning**:
   - Each analysis pins an immutable snapshot `{ chainId, blockNumber, blockHash }`.
   - The same block snapshot is used across code lookups, proxy resolution, balances, nonces, and simulation.
2. **Local-Only Execution**:
   - Simulated transactions are executed exclusively on local Anvil forks or in-memory EVM state trackers.
   - Transactions are **never sent to public upstream RPCs**.
   - Impersonation (`anvil_impersonateAccount`), funding, and storage overrides are strictly confined to the local worker and recorded in `disclosedOverrides`.
3. **State Isolation & Concurrency Control (`src/simulator/isolatedJobManager.ts`)**:
   - Concurrency is throttled to prevent resource contention.
   - Every job executes inside a try/finally block that enforces guaranteed teardown:
     ```typescript
     try {
       return await executeJob();
     } finally {
       await cleanupState(); // Reverts state / resets fork snapshot
     }
     ```
   - Zero state leakage between successive simulation requests.
4. **Graceful Fallback**:
   - If the local Anvil binary is unavailable, the simulator automatically falls back to deterministic in-memory EVM simulation and appends a disclosure to `assumptions`.

---

## Threat Dataset Sources & Update Procedure

### Threat Dataset Sources
Cognitia's versioned threat intelligence store (`src/providers/threatProvider.ts`) is curated from verified security records:
1. **Etherscan Verified Labels**:
   - Inferno Drainer Spender (`0x0000db5c8B030ae5034102f866416f8B25530182`)
   - PinkDrainer Operator (`0x000000000000543666fe5bc9635f793b82141505`)
   - Fake Phishing Forwarder (`0x0000000000787723901b67f1b74d6c44933a39e8`)
2. **US Treasury OFAC Sanctions List**:
   - Tornado Cash Router (`0xd90e2f925da726b50c4ed8d0fb90ad053324f31b`)
3. **Security Incident Post-Mortems (Paradigm & OpenZeppelin)**:
   - Tornado Cash Governance Exploiter Recipient (`0x592340957ebc9e4afb0e9af221d06fdddf789de9`)
4. **MetaMask `eth-phishing-detect` Catalog**:
   - Phishing lure domains (e.g. `uniswap-airdrop-claim.com`, `opensea-revokecash-security.io`)

### Threat Update Procedure
To add or update threat records:
1. Open [`src/providers/threatProvider.ts`](file:///Users/macbookair/Downloads/Cognitia/src/providers/threatProvider.ts).
2. Append a new `ThreatRecord` to `PRODUCTION_THREAT_DATABASE`:
   ```typescript
   {
     id: 'threat-addr-new-actor',
     chainId: 1, // On-chain records must specify chainId; null allowed only for domain/generic rules
     matchType: 'address', // 'address' | 'codehash' | 'domain' | 'behavioral'
     matchValue: '0x...'.toLowerCase(),
     label: 'Descriptive Label of Threat Actor',
     sourceUrl: 'https://etherscan.io/address/0x...',
     confidence: 'high',
     updatedAt: '2025-01-01T00:00:00Z',
     demoOnly: false,
     entityRole: 'spender', // 'spender' | 'operator' | 'recipient' | 'target' | 'implementation'
     description: 'Detailed threat context and attribution.',
   }
   ```
3. For bytecode hash indicators, compute `keccak256` over the exact deployed runtime bytecode (`matchType: 'codehash'`). Never hash creation bytecode or empty code.
4. For synthetic demo indicators, add them to `DEMO_THREAT_DATABASE` with `demoOnly: true`.

---

## Known Coverage Limits

1. **Unsigned Permits Cannot Be Executed**:
   - An unsigned EIP-712 permit payload cannot be submitted to an on-chain contract because cryptographic signatures cannot be forged.
   - Cognitia models permit authorization capacity via local state overrides, labeling results as `conditional_modeling` (`"Conditional outcome if this permit is signed and accepted."`).
2. **Dynamic Unverified Delegatecalls**:
   - Calldata inspection cannot predict arbitrary storage modifications executed by unverified proxy implementations or dynamic `delegatecall` contracts. Such calls are assigned `unknown` severity with partial coverage warnings.
3. **Downstream Authority of `personal_sign`**:
   - An off-chain text or hex message signed via `personal_sign` can be used by off-chain web applications or relayers in ways not discernable from message bytes alone. Cognitia flags downstream effect status as `uninferable`.
4. **RPC Outages & Tracing Support**:
   - If an RPC endpoint fails or drops a call during analysis, Cognitia marks `Coverage: failed` and forces `overallSeverity = 'unknown'`. Cognitia **never** assumes zero or returns a low-risk verdict when coverage is incomplete.

---

## How to Add a New Adapter or Severity Rule

### 1. Adding a New Signature Adapter
1. Create a new adapter file in `src/providers/signatureAdapters/` implementing `SignatureAdapterProvider`:
   ```typescript
   import { type SignatureAdapterProvider, type AdapterContext } from '../types';
   import { type AnalysisRequest } from '../../schemas/request';
   import { type DecodedIntent } from '../../schemas/intent';
   
   export class MyNewSignatureAdapter implements SignatureAdapterProvider {
     public readonly id = 'my_new_adapter';
   
     public canHandle(request: AnalysisRequest): boolean {
       return request.type === 'eip712' && request.payload.primaryType === 'MyType';
     }
   
     public async analyze(request: AnalysisRequest, context?: AdapterContext) {
       // Decode intent, validate preconditions, generate findings and evidence
       return {
         intent,
         findings,
         evidence,
         coverage: 'complete',
         reasons: [],
         simulatedPermitTarget: undefined,
       };
     }
   }
   ```
2. Register the adapter in `src/engine/riskEngine.ts`:
   ```typescript
   this.signatureAdapters = options?.signatureAdapters || [
     new Erc2612SignatureAdapter({ chainProvider: this.chainProvider }),
     new MyNewSignatureAdapter(),
     new Permit2SignatureAdapter(),
     new PersonalSignSignatureAdapter(),
     new GenericEip712Adapter(),
   ];
   ```

### 2. Adding a New Router / Multicall Calldata Adapter
1. Create a new adapter in `src/engine/adapters/` implementing `RouterAdapter`:
   ```typescript
   import { type RouterAdapter, type RouterAdapterDecodeParams } from './types';
   
   export class MyRouterAdapter implements RouterAdapter {
     public readonly id = 'my_router_adapter';
     public readonly name = 'MyRouter';
     public readonly isFixtureOnly = false;
   
     public canHandle(target: string, calldata: string, chainId: number): boolean {
       // Check target address and function selector
     }
   
     public async decode(params: RouterAdapterDecodeParams) {
       // Decode parameters and call params.decodeSubcall(...) for nested calls
     }
   }
   ```
2. Register the adapter in `RouterAdapterRegistry` (`src/engine/adapters/adapterRegistry.ts`).

### 3. Adding a New Deterministic Severity Rule
1. Open [`src/engine/deterministicRules.ts`](file:///Users/macbookair/Downloads/Cognitia/src/engine/deterministicRules.ts).
2. Add your rule logic inside `evaluateDeterministicRules`.
3. Ensure every generated finding adheres strictly to `findingSchema`:
   ```typescript
   findings.push({
     id: `finding-my-rule-${Date.now()}`,
     ruleId: 'my_new_security_rule',
     severity: 'high', // 'critical' | 'high' | 'medium' | 'low' | 'unknown'
     title: 'Clear Descriptive Title',
     plainEnglishExplanation: 'Actionable explanation for the user.',
     evidenceIds: [evId],
     confidence: { level: 'high', reason: 'Deterministic verification reason' },
     assumptions: ['Explicit assumption about protocol behavior'],
     executionContext: 'decoded_intent', // 'decoded_intent' | 'observed_simulation' | 'conditional_modeling'
     remediation: 'Concrete recommended action to protect wallet.',
   });
   ```
4. Add comprehensive unit tests in [`tests/deterministicFindingsEngine.test.ts`](file:///Users/macbookair/Downloads/Cognitia/tests/deterministicFindingsEngine.test.ts).

