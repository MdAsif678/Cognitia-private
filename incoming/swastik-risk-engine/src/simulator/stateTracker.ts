import { type SimulationResult, type AssetDelta, type SeparatedEffects, type MisleadingEvent } from '../schemas/simulation';
import { type DecodedIntent } from '../schemas/intent';

export interface PreStateSnapshot {
  nativeBalances: Map<string, bigint>;
  erc20Balances: Map<string, bigint>; // key: `${token}:${account}`
  erc20Allowances: Map<string, bigint>; // key: `${token}:${owner}:${spender}`
  erc721Owners: Map<string, string>; // key: `${token}:${tokenId}`
  erc721Approvals: Map<string, boolean>; // key: `${token}:${owner}:${operator}`
  erc1155Balances: Map<string, bigint>; // key: `${token}:${account}:${id}`
  erc1155Approvals: Map<string, boolean>; // key: `${token}:${owner}:${operator}`
}

export interface PostStateSnapshot extends PreStateSnapshot {}

export interface StateDiffEvaluationParams {
  preState: PreStateSnapshot;
  postState: PostStateSnapshot;
  success: boolean;
  revertReason?: string;
  decodedIntent?: DecodedIntent;
  logs?: Array<{ address: string; topics: string[]; data: string }>;
  inspectedTokens: string[];
  inspectedAccounts: string[];
  assumptions: string[];
}

export class StateTracker {
  /**
   * Evaluates the pre-to-post state difference, detects misleading logs,
   * enforces the revert invariant (no asset deltas on revert), and separates effects.
   */
  public static evaluateDiff(params: StateDiffEvaluationParams): {
    assetDeltas: AssetDelta[];
    stateChanges: NonNullable<SimulationResult['stateChanges']>;
    separatedEffects: SeparatedEffects;
    misleadingEvents: MisleadingEvent[];
    discoveryLimits: string[];
  } {
    const {
      preState,
      postState,
      success,
      revertReason,
      decodedIntent,
      logs,
      inspectedTokens,
      assumptions,
    } = params;

    const stateChanges: NonNullable<SimulationResult['stateChanges']> = {
      nativeBalances: [],
      erc20Balances: [],
      erc20Allowances: [],
      erc721Ownership: [],
      erc721Approvals: [],
      erc1155Balances: [],
      erc1155Approvals: [],
    };

    const assetDeltas: AssetDelta[] = [];
    const observedEffects: string[] = [];
    const unresolvedEffects: string[] = [];
    const misleadingEvents: MisleadingEvent[] = [];

    // 1. Discovery Limits Disclosure
    // "Do not claim that all assets were inspected when only some were discovered."
    const discoveryLimits = [
      `Inspected assets: [${['Native Currency', ...inspectedTokens].join(', ')}].`,
      'Discovery limit: State inspection was strictly limited to assets and accounts discovered in decoded calldata, intent parameters, and execution traces. Unindexed or unreferenced assets on other contracts were not exhaustively scanned.',
    ];

    // 2. Decoded Requested Actions
    const decodedRequestedActions: string[] = [];
    if (decodedIntent) {
      decodedRequestedActions.push(
        `Requested ${decodedIntent.functionName || 'call'} on target ${decodedIntent.target || 'unknown'}`
      );
      if (decodedIntent.parameters) {
        for (const p of decodedIntent.parameters) {
          decodedRequestedActions.push(`Param ${p.name} (${p.type}): ${p.value}`);
        }
      }
    }

    // 3. Revert Rule: Reverted calls must NOT contribute reverted transfers to final asset deltas!
    if (!success) {
      unresolvedEffects.push(
        `Transaction execution reverted: ${revertReason || 'execution reverted without reason'}.`
      );
      unresolvedEffects.push(
        'Critical safety rule: A transaction revert is NOT evidence that the request is harmless (e.g. caller may currently lack balance or permit deadline may be unreached). Reverted transfers are excluded from asset deltas.'
      );

      return {
        assetDeltas: [], // STRICT INVARIANT: 0 asset deltas on revert
        stateChanges,
        separatedEffects: {
          decodedRequestedActions,
          observedEffects: ['Execution reverted; zero on-chain state changes finalized.'],
          unresolvedEffects,
        },
        misleadingEvents,
        discoveryLimits,
      };
    }

    // 4. Native Balance Diffs
    const allNativeAccounts = new Set([
      ...preState.nativeBalances.keys(),
      ...postState.nativeBalances.keys(),
    ]);
    for (const account of allNativeAccounts) {
      const preBal = preState.nativeBalances.get(account) ?? 0n;
      const postBal = postState.nativeBalances.get(account) ?? 0n;
      const delta = postBal - preBal;
      if (delta !== 0n) {
        stateChanges.nativeBalances.push({
          account,
          pre: preBal.toString(),
          post: postBal.toString(),
          delta: delta.toString(),
        });

        assetDeltas.push({
          account,
          token: '0x0000000000000000000000000000000000000000',
          symbol: 'ETH',
          amountDelta: delta.toString(),
        });

        observedEffects.push(
          `Native ETH balance for ${account} changed by ${delta > 0n ? '+' : ''}${delta.toString()} wei`
        );
      }
    }

    // 5. ERC-20 Balance Diffs
    const allErc20Keys = new Set([
      ...preState.erc20Balances.keys(),
      ...postState.erc20Balances.keys(),
    ]);
    for (const key of allErc20Keys) {
      const [token, account] = key.split(':');
      const preBal = preState.erc20Balances.get(key) ?? 0n;
      const postBal = postState.erc20Balances.get(key) ?? 0n;
      const delta = postBal - preBal;
      if (delta !== 0n) {
        stateChanges.erc20Balances.push({
          token,
          account,
          pre: preBal.toString(),
          post: postBal.toString(),
          delta: delta.toString(),
        });

        assetDeltas.push({
          account,
          token,
          amountDelta: delta.toString(),
        });

        observedEffects.push(
          `ERC-20 balance on token ${token} for ${account} changed by ${delta > 0n ? '+' : ''}${delta.toString()} units`
        );
      }
    }

    // 6. ERC-20 Allowance Diffs
    const allAllowKeys = new Set([
      ...preState.erc20Allowances.keys(),
      ...postState.erc20Allowances.keys(),
    ]);
    for (const key of allAllowKeys) {
      const [token, owner, spender] = key.split(':');
      const preAllow = preState.erc20Allowances.get(key) ?? 0n;
      const postAllow = postState.erc20Allowances.get(key) ?? 0n;
      const delta = postAllow - preAllow;
      if (delta !== 0n) {
        stateChanges.erc20Allowances.push({
          token,
          owner,
          spender,
          pre: preAllow.toString(),
          post: postAllow.toString(),
          delta: delta.toString(),
        });

        observedEffects.push(
          `ERC-20 allowance on token ${token} from ${owner} to spender ${spender} changed from ${preAllow.toString()} to ${postAllow.toString()}`
        );
      }
    }

    // 7. ERC-721 Ownership Diffs
    for (const [key, preOwner] of preState.erc721Owners.entries()) {
      const [token, tokenId] = key.split(':');
      const postOwner = postState.erc721Owners.get(key) ?? preOwner;
      if (preOwner.toLowerCase() !== postOwner.toLowerCase()) {
        stateChanges.erc721Ownership.push({
          token,
          tokenId,
          preOwner,
          postOwner,
        });

        observedEffects.push(
          `ERC-721 token ${token} ID ${tokenId} transferred from ${preOwner} to ${postOwner}`
        );
      }
    }

    // 8. ERC-721 Operator Approval Diffs
    for (const [key, preAppr] of preState.erc721Approvals.entries()) {
      const [token, owner, operator] = key.split(':');
      const postAppr = postState.erc721Approvals.get(key) ?? preAppr;
      if (preAppr !== postAppr) {
        stateChanges.erc721Approvals.push({
          token,
          owner,
          operator,
          preApproved: preAppr,
          postApproved: postAppr,
        });

        observedEffects.push(
          `ERC-721 collection-wide approval on ${token} for operator ${operator} by ${owner} set to ${postAppr}`
        );
      }
    }

    // 9. ERC-1155 Balance & Approval Diffs
    for (const [key, preBal] of preState.erc1155Balances.entries()) {
      const [token, account, id] = key.split(':');
      const postBal = postState.erc1155Balances.get(key) ?? preBal;
      const delta = postBal - preBal;
      if (delta !== 0n) {
        stateChanges.erc1155Balances.push({
          token,
          account,
          id,
          pre: preBal.toString(),
          post: postBal.toString(),
          delta: delta.toString(),
        });

        observedEffects.push(
          `ERC-1155 token ${token} id ${id} balance for ${account} changed by ${delta > 0n ? '+' : ''}${delta.toString()}`
        );
      }
    }

    for (const [key, preAppr] of preState.erc1155Approvals.entries()) {
      const [token, owner, operator] = key.split(':');
      const postAppr = postState.erc1155Approvals.get(key) ?? preAppr;
      if (preAppr !== postAppr) {
        stateChanges.erc1155Approvals.push({
          token,
          owner,
          operator,
          preApproved: preAppr,
          postApproved: postAppr,
        });

        observedEffects.push(
          `ERC-1155 approval on ${token} for operator ${operator} by ${owner} set to ${postAppr}`
        );
      }
    }

    // 10. Misleading Event Logs Analysis
    // Rule: "Treat logs as supporting evidence, not sufficient proof of asset movement."
    // If a log emits Transfer(from, to, val) but state changes show NO matching balance decrease/increase:
    if (logs) {
      // Transfer event topic: keccak256("Transfer(address,address,uint256)")
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      logs.forEach((log, idx) => {
        if (log.topics && log.topics[0]?.toLowerCase() === transferTopic) {
          // Check if token balance actually changed
          const hasBalanceChange = stateChanges.erc20Balances.some(
            (b) => b.token.toLowerCase() === log.address.toLowerCase()
          ) || stateChanges.erc721Ownership.some(
            (o) => o.token.toLowerCase() === log.address.toLowerCase()
          );

          if (!hasBalanceChange) {
            misleadingEvents.push({
              name: 'Transfer',
              reason: `Contract ${log.address} emitted a Transfer event log, but on-chain state inspection confirmed no corresponding balance or ownership changes occurred. (Potential spoofed or fake event log).`,
              logIndex: idx,
            });
            unresolvedEffects.push(
              `Warning: Log ${idx} on ${log.address} emitted Transfer topic without verified state change.`
            );
          }
        }
      });
    }

    if (observedEffects.length === 0 && success) {
      observedEffects.push('No asset balance, ownership, or approval state changes observed for discovered accounts.');
    }

    return {
      assetDeltas,
      stateChanges,
      separatedEffects: {
        decodedRequestedActions,
        observedEffects,
        unresolvedEffects,
      },
      misleadingEvents,
      discoveryLimits,
    };
  }
}
