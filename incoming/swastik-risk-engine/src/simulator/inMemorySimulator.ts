import {
  type SimulationResult,
  type PinnedSnapshot,
  type DisclosedOverride,
  type CallTraceNode,
} from '../schemas/simulation';
import { type DecodedIntent } from '../schemas/intent';
import { StateTracker, type PreStateSnapshot, type PostStateSnapshot } from './stateTracker';
import { SnapshotResolver, defaultSnapshotResolver } from './snapshotResolver';
import { IsolatedJobManager, defaultJobManager } from './isolatedJobManager';

export interface InMemorySimulatorConfig {
  snapshotResolver?: SnapshotResolver;
  jobManager?: IsolatedJobManager;
}

export interface SimulateExecutionOptions {
  from: string;
  to: string;
  value: bigint;
  calldata: string;
  chainId: number;
  decodedIntent?: DecodedIntent;
  pinnedBlockNumber?: string;
  pinnedBlockHash?: string;
  impersonate?: boolean;
  fundAmount?: bigint;
  stateOverrides?: Array<{ target: string; slot?: string; value?: string; details: string }>;
  enableTracing?: boolean;
}

export class InMemorySimulationProvider {
  public readonly name = 'in_memory_simulator';
  private snapshotResolver: SnapshotResolver;
  private jobManager: IsolatedJobManager;

  // Global base mock state (acts as read-only base fork)
  private baseNativeBalances = new Map<string, bigint>();
  private baseErc20Balances = new Map<string, bigint>();
  private baseErc20Allowances = new Map<string, bigint>();
  private baseErc721Owners = new Map<string, string>();
  private baseErc721Approvals = new Map<string, boolean>();
  private baseErc1155Balances = new Map<string, bigint>();
  private baseErc1155Approvals = new Map<string, boolean>();

  constructor(config?: InMemorySimulatorConfig) {
    this.snapshotResolver = config?.snapshotResolver || defaultSnapshotResolver;
    this.jobManager = config?.jobManager || defaultJobManager;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  // Base state seeders for test vectors
  public setBaseNativeBalance(account: string, amount: bigint) {
    this.baseNativeBalances.set(account.toLowerCase(), amount);
  }

  public setBaseErc20Balance(token: string, account: string, amount: bigint) {
    this.baseErc20Balances.set(`${token.toLowerCase()}:${account.toLowerCase()}`, amount);
  }

  public setBaseErc20Allowance(token: string, owner: string, spender: string, amount: bigint) {
    this.baseErc20Allowances.set(`${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`, amount);
  }

  public setBaseErc721Owner(token: string, tokenId: string, owner: string) {
    this.baseErc721Owners.set(`${token.toLowerCase()}:${tokenId}`, owner.toLowerCase());
  }

  public setBaseErc721Approval(token: string, owner: string, operator: string, approved: boolean) {
    this.baseErc721Approvals.set(`${token.toLowerCase()}:${owner.toLowerCase()}:${operator.toLowerCase()}`, approved);
  }

  public setBaseErc1155Balance(token: string, account: string, id: string, amount: bigint) {
    this.baseErc1155Balances.set(`${token.toLowerCase()}:${account.toLowerCase()}:${id}`, amount);
  }

  public setBaseErc1155Approval(token: string, owner: string, operator: string, approved: boolean) {
    this.baseErc1155Approvals.set(`${token.toLowerCase()}:${owner.toLowerCase()}:${operator.toLowerCase()}`, approved);
  }

  /**
   * Simulates a transaction inside an isolated job session without cross-request state leakage.
   */
  public async simulateTransaction(options: SimulateExecutionOptions): Promise<SimulationResult> {
    const jobId = `sim_job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return await this.jobManager.executeIsolatedJob(jobId, async () => {
      // 1. Pin Snapshot
      const pinnedSnapshot: PinnedSnapshot = await this.snapshotResolver.resolvePinnedSnapshot(
        options.chainId,
        undefined,
        options.pinnedBlockNumber,
        options.pinnedBlockHash
      );

      // 2. Clone Isolated State (Guarantees zero cross-job leakage)
      const localNative = new Map(this.baseNativeBalances);
      const localErc20 = new Map(this.baseErc20Balances);
      const localErc20Allow = new Map(this.baseErc20Allowances);
      const localErc721 = new Map(this.baseErc721Owners);
      const localErc721Appr = new Map(this.baseErc721Approvals);
      const localErc1155 = new Map(this.baseErc1155Balances);
      const localErc1155Appr = new Map(this.baseErc1155Approvals);

      const disclosedOverrides: DisclosedOverride[] = [];
      const assumptions: string[] = [
        `Analysis pinned to chain ${pinnedSnapshot.chainId} at block ${pinnedSnapshot.blockNumber}.`,
        'Execution restricted to isolated local worker; transaction was never broadcast to public RPCs.',
      ];

      // 3. Local Impersonation & Funding (Disclosed)
      if (options.impersonate !== false) {
        disclosedOverrides.push({
          type: 'impersonation',
          target: options.from,
          details: `Locally impersonated caller ${options.from} to execute transaction without private key.`,
        });
        assumptions.push(`Local impersonation active for caller ${options.from}.`);
      }

      // Ensure caller has gas/funding in local worker
      const currentCallerNative = localNative.get(options.from.toLowerCase()) ?? 10_000_000_000_000_000_000n; // 10 ETH default
      localNative.set(options.from.toLowerCase(), currentCallerNative);

      if (options.fundAmount) {
        const newBal = currentCallerNative + options.fundAmount;
        localNative.set(options.from.toLowerCase(), newBal);
        disclosedOverrides.push({
          type: 'funding',
          target: options.from,
          details: `Funded account with ${options.fundAmount.toString()} wei in local worker.`,
        });
        assumptions.push(`Local funding override applied to caller.`);
      }

      // State overrides
      if (options.stateOverrides) {
        for (const ov of options.stateOverrides) {
          disclosedOverrides.push({
            type: 'storage_override',
            target: ov.target,
            details: ov.details,
          });
          assumptions.push(`Storage override: ${ov.details}`);
        }
      }

      // 4. Capture Pre-State
      const fromNorm = options.from.toLowerCase();
      const toNorm = options.to.toLowerCase();
      const inspectedTokens = new Set<string>();
      const inspectedAccounts = new Set<string>([fromNorm, toNorm]);

      if (options.decodedIntent) {
        if (options.decodedIntent.target) inspectedTokens.add(options.decodedIntent.target.toLowerCase());
        if (options.decodedIntent.recipient) inspectedAccounts.add(options.decodedIntent.recipient.toLowerCase());
        if (options.decodedIntent.owner) inspectedAccounts.add(options.decodedIntent.owner.toLowerCase());
        if (options.decodedIntent.spenderOrOperator) inspectedAccounts.add(options.decodedIntent.spenderOrOperator.toLowerCase());
      }

      const preState: PreStateSnapshot = {
        nativeBalances: new Map(localNative),
        erc20Balances: new Map(localErc20),
        erc20Allowances: new Map(localErc20Allow),
        erc721Owners: new Map(localErc721),
        erc721Approvals: new Map(localErc721Appr),
        erc1155Balances: new Map(localErc1155),
        erc1155Approvals: new Map(localErc1155Appr),
      };

      // 5. Execute Simulation Logic
      let success = true;
      let revertReason: string | undefined = undefined;
      const logs: Array<{ address: string; topics: string[]; data: string }> = [];
      const callTraces: CallTraceNode[] = [];
      const delegatecallTargets: string[] = [];

      const calldata = options.calldata.toLowerCase();
      const selector = calldata.slice(0, 10);

      // Check for intentional test revert triggers
      if (calldata.includes('revert') || selector === '0xdeadbeef') {
        success = false;
        revertReason = 'Execution reverted: Panic(0x01) or custom require assertion failed';
      }

      // Check call tracing support
      const tracingSupported = options.enableTracing !== false;
      let coverageImpact: SimulationResult['coverageImpact'] = undefined;
      if (!tracingSupported) {
        coverageImpact = {
          status: 'partial',
          reasons: ['Call tracing disabled or unsupported by worker provider; internal delegatecalls could not be inspected.'],
        };
      }

      // If successful, apply state transitions
      if (success) {
        // Native ETH movement
        if (options.value > 0n) {
          const fromBal = localNative.get(fromNorm) ?? 0n;
          if (fromBal < options.value) {
            success = false;
            revertReason = 'insufficient funds for native transfer';
          } else {
            localNative.set(fromNorm, fromBal - options.value);
            const toBal = localNative.get(toNorm) ?? 0n;
            localNative.set(toNorm, toBal + options.value);
          }
        }

        // Trace root call
        callTraces.push({
          from: options.from,
          to: options.to,
          value: options.value.toString(),
          callType: 'call',
          depth: 0,
          gasUsed: '21000',
        });

        // Delegatecall inspection in intent / multicall
        if (options.decodedIntent?.nestedCalls) {
          for (const nested of options.decodedIntent.nestedCalls) {
            if (nested.callType === 'delegatecall' && nested.target) {
              delegatecallTargets.push(nested.target);
            }
          }
        }

        // ERC-20 transfer(address to, uint256 amount) [0xa9059cbb]
        if (selector === '0xa9059cbb' && calldata.length >= 74) {
          const recipient = `0x${calldata.slice(34, 74)}`;
          const amount = BigInt(`0x${calldata.slice(74, 138)}`);
          inspectedTokens.add(toNorm);
          inspectedAccounts.add(recipient.toLowerCase());

          const fromKey = `${toNorm}:${fromNorm}`;
          const toKey = `${toNorm}:${recipient.toLowerCase()}`;
          const currentFromBal = localErc20.get(fromKey) ?? 1000n * 10n ** 18n; // default 1,000 units
          const currentToBal = localErc20.get(toKey) ?? 0n;

          if (currentFromBal < amount) {
            success = false;
            revertReason = 'ERC20: transfer amount exceeds balance';
          } else {
            localErc20.set(fromKey, currentFromBal - amount);
            localErc20.set(toKey, currentToBal + amount);

            // Emit standard transfer log
            logs.push({
              address: options.to,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer
                `0x000000000000000000000000${fromNorm.slice(2)}`,
                `0x000000000000000000000000${recipient.slice(2).toLowerCase()}`,
              ],
              data: `0x${amount.toString(16).padStart(64, '0')}`,
            });
          }
        }

        // ERC-20 approve(address spender, uint256 amount) [0x095ea7b3]
        if (selector === '0x095ea7b3' && calldata.length >= 74) {
          const spender = `0x${calldata.slice(34, 74)}`.toLowerCase();
          const amount = BigInt(`0x${calldata.slice(74, 138)}`);
          inspectedTokens.add(toNorm);
          inspectedAccounts.add(spender);

          const allowKey = `${toNorm}:${fromNorm}:${spender}`;
          localErc20Allow.set(allowKey, amount);

          logs.push({
            address: options.to,
            topics: [
              '0x8c5be1e5eb7d874a754291c33d04f1369ddfa7002f1376e033d438094a5e0f01', // Approval
              `0x000000000000000000000000${fromNorm.slice(2)}`,
              `0x000000000000000000000000${spender.slice(2)}`,
            ],
            data: `0x${amount.toString(16).padStart(64, '0')}`,
          });
        }

        // ERC-20 / ERC-721 transferFrom(address from, address to, uint256 valueOrId) [0x23b872dd]
        if (selector === '0x23b872dd' && calldata.length >= 138) {
          const fromAcc = `0x${calldata.slice(34, 74)}`.toLowerCase();
          const toAcc = `0x${calldata.slice(74, 138).slice(24)}`.toLowerCase();
          const valOrId = BigInt(`0x${calldata.slice(138, 202)}`);
          inspectedTokens.add(toNorm);
          inspectedAccounts.add(fromAcc);
          inspectedAccounts.add(toAcc);

          // Check if token is registered as ERC-721
          const nftKey = `${toNorm}:${valOrId.toString()}`;
          const currentOwner = localErc721.get(nftKey);

          if (currentOwner) {
            // ERC-721 transferFrom
            localErc721.set(nftKey, toAcc);
            logs.push({
              address: options.to,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                `0x000000000000000000000000${fromAcc.slice(2)}`,
                `0x000000000000000000000000${toAcc.slice(2)}`,
                `0x${valOrId.toString(16).padStart(64, '0')}`,
              ],
              data: '0x',
            });
          } else {
            // ERC-20 transferFrom
            const fromKey = `${toNorm}:${fromAcc}`;
            const toKey = `${toNorm}:${toAcc}`;
            const allowKey = `${toNorm}:${fromAcc}:${fromNorm}`; // caller is spender

            const currentBal = localErc20.get(fromKey) ?? 1000n * 10n ** 18n;
            const currentAllow = localErc20Allow.get(allowKey) ?? 1000000n * 10n ** 18n;

            if (currentBal < valOrId) {
              success = false;
              revertReason = 'ERC20: transfer amount exceeds balance';
            } else if (currentAllow < valOrId) {
              success = false;
              revertReason = 'ERC20: insufficient allowance';
            } else {
              localErc20.set(fromKey, currentBal - valOrId);
              localErc20.set(toKey, (localErc20.get(toKey) ?? 0n) + valOrId);
              if (currentAllow < 2n ** 255n) {
                localErc20Allow.set(allowKey, currentAllow - valOrId);
              }
            }
          }
        }

        // ERC-721 / ERC-1155 setApprovalForAll(address operator, bool approved) [0xa22cb465]
        if (selector === '0xa22cb465' && calldata.length >= 74) {
          const operator = `0x${calldata.slice(34, 74)}`.toLowerCase();
          const approved = calldata.slice(74, 138).endsWith('1');
          inspectedTokens.add(toNorm);
          inspectedAccounts.add(operator);

          const apprKey = `${toNorm}:${fromNorm}:${operator}`;
          localErc721Appr.set(apprKey, approved);
          localErc1155Appr.set(apprKey, approved);
        }

        // Misleading Event Simulation Vector:
        // If calldata requests a fake event test, emit a Transfer event without state changes
        if (calldata.includes('fakelog')) {
          logs.push({
            address: options.to,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer
              `0x000000000000000000000000${fromNorm.slice(2)}`,
              '0x000000000000000000000000deaddeaddeaddeaddeaddeaddeaddeaddead0001',
            ],
            data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
          });
        }
      }

      // 6. Capture Post-State
      const postState: PostStateSnapshot = {
        nativeBalances: new Map(localNative),
        erc20Balances: new Map(localErc20),
        erc20Allowances: new Map(localErc20Allow),
        erc721Owners: new Map(localErc721),
        erc721Approvals: new Map(localErc721Appr),
        erc1155Balances: new Map(localErc1155),
        erc1155Approvals: new Map(localErc1155Appr),
      };

      // 7. Evaluate State Differences, Misleading Logs & Reverts
      const diffResult = StateTracker.evaluateDiff({
        preState,
        postState,
        success,
        revertReason,
        decodedIntent: options.decodedIntent,
        logs,
        inspectedTokens: Array.from(inspectedTokens),
        inspectedAccounts: Array.from(inspectedAccounts),
        assumptions,
      });

      return {
        success,
        executionContext: 'observed_simulation',
        assumptions,
        assetDeltas: diffResult.assetDeltas,
        gasUsed: success ? '45000' : undefined,
        revertReason,
        pinnedSnapshot,
        disclosedOverrides,
        callTraces,
        delegatecallTargets,
        stateChanges: diffResult.stateChanges,
        discoveryLimits: diffResult.discoveryLimits,
        separatedEffects: diffResult.separatedEffects,
        misleadingEvents: diffResult.misleadingEvents,
        coverageImpact,
        logs,
      };
    }, { timeoutMs: 5000 });
  }

  /**
   * Simulates a conditional unsigned permit with isolated state overrides.
   * Follows strict ERC-2612 requirements:
   * 1. Does not claim to execute the permit.
   * 2. Assumes preconditions have already been validated.
   * 3. Models equivalent allowance using impersonated approval / state override on isolated fork.
   * 4. Simulates a subsequent spender transfer as a separate hypothetical step.
   * 5. Labels the result exactly: "Conditional outcome if this permit is signed and accepted."
   */
  public async simulateConditionalPermit(params: {
    token: string;
    owner: string;
    spender: string;
    value: bigint;
    chainId: number;
    pinnedBlockNumber?: string;
    isContractSpender?: boolean;
    preBalance?: bigint;
    preAllowance?: bigint;
    hypotheticalRecipient?: string;
  }): Promise<SimulationResult> {
    const pinnedSnapshot: PinnedSnapshot = await this.snapshotResolver.resolvePinnedSnapshot(
      params.chainId,
      undefined,
      params.pinnedBlockNumber
    );

    const recipient = params.hypotheticalRecipient || '0x1111111111111111111111111111111111111111';
    const caller = params.spender;
    const initialBalance = params.preBalance ?? 1000n * 10n ** 18n;
    const initialAllowance = params.preAllowance ?? 0n;

    const assumptions = [
      `Analysis pinned to chain ${pinnedSnapshot.chainId} at block ${pinnedSnapshot.blockNumber}.`,
      'State override / impersonated approval applied: Unsigned permit cannot execute directly on-chain because owner signature does not exist yet (per ERC-2612 specification). The simulator modeled an isolated state override to inject equivalent allowance on the target token.',
      'Do not claim to execute the permit: An unsigned permit cannot execute directly on-chain because owner cryptographic signature has not been generated or provided.',
      `Step 1 (Modeled Equivalent Allowance): Modeled equivalent allowance of ${params.value.toString()} units on token ${params.token} for spender ${params.spender} from owner ${params.owner} using isolated state override / impersonated approval.`,
      `Step 2 (Hypothetical Subsequent Spender Transfer): Simulated caller ${caller} invoking transferFrom for ${params.value.toString()} units to hypothetical recipient ${recipient} on isolated local fork.`,
      'Never infer actual spender intent from a hypothetical recipient chosen for the scenario.',
    ];

    if (params.isContractSpender) {
      assumptions.push(
        `Contract spender ${params.spender} was locally impersonated. This models authorization capacity and does not prove its real code can initiate that transfer. Prefer a supported real execution path when available.`
      );
    }

    const disclosedOverrides: DisclosedOverride[] = [
      {
        type: 'storage_override',
        target: params.token,
        details: `Injected modeled allowance of ${params.value.toString()} units for spender ${params.spender} from owner ${params.owner} on local worker fork.`,
      },
      {
        type: 'impersonation',
        target: caller,
        details: `Impersonated spender ${caller} as caller to execute hypothetical subsequent transferFrom.`,
      },
      {
        type: 'funding',
        target: caller,
        details: `Funded caller ${caller} with 1 ETH in local worker to pay simulation gas fees.`,
      },
    ];

    const assetDeltas = [
      {
        account: params.owner,
        token: params.token,
        amountDelta: (-params.value).toString(),
      },
      {
        account: recipient,
        token: params.token,
        amountDelta: params.value.toString(),
      },
    ];

    const postBal = initialBalance >= params.value ? initialBalance - params.value : 0n;

    return {
      success: true,
      executionContext: 'conditional_modeling',
      conditionalLabel: 'Conditional outcome if this permit is signed and accepted.',
      assumptions,
      assetDeltas,
      gasUsed: '45000',
      pinnedSnapshot,
      disclosedOverrides,
      delegatecallTargets: [],
      stateChanges: {
        nativeBalances: [],
        erc20Balances: [
          {
            token: params.token,
            account: params.owner,
            pre: initialBalance.toString(),
            post: postBal.toString(),
            delta: (-params.value).toString(),
          },
          {
            token: params.token,
            account: recipient,
            pre: '0',
            post: params.value.toString(),
            delta: params.value.toString(),
          },
        ],
        erc20Allowances: [
          {
            token: params.token,
            owner: params.owner,
            spender: params.spender,
            pre: initialAllowance.toString(),
            post: params.value.toString(),
            delta: (params.value - initialAllowance).toString(),
          },
        ],
        erc721Ownership: [],
        erc721Approvals: [],
        erc1155Balances: [],
        erc1155Approvals: [],
      },
      discoveryLimits: [
        `Inspected asset [${params.token}]. Discovery limited to permit verifyingContract.`,
      ],
      separatedEffects: {
        decodedRequestedActions: [
          `Step 1 (Modeled Equivalent Allowance): owner ${params.owner} authorizes spender ${params.spender} for ${params.value.toString()} units on ${params.token}.`,
          `Step 2 (Hypothetical Subsequent Spender Transfer): caller ${caller} transfers ${params.value.toString()} units from ${params.owner} to recipient ${recipient}.`,
        ],
        observedEffects: [
          `Conditional outcome if this permit is signed and accepted: Spender allowance set to ${params.value.toString()} units; owner balance decreased by ${params.value.toString()} units; recipient balance increased by ${params.value.toString()} units.`,
        ],
        unresolvedEffects: [
          'Never infer actual spender intent from a hypothetical recipient chosen for the scenario.',
          ...(params.isContractSpender
            ? [
                `Contract spender ${params.spender} was locally impersonated. This models authorization capacity and does not prove its real code can initiate that transfer. Prefer a supported real execution path when available.`,
              ]
            : []),
        ],
      },
      misleadingEvents: [],
    };
  }
}

export const defaultInMemorySimulator = new InMemorySimulationProvider();
