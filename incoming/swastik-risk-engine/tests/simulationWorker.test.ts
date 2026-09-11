import { describe, it, expect } from 'vitest';
import { encodeFunctionData } from 'viem';
import { InMemorySimulationProvider } from '../src/simulator/inMemorySimulator';
import { STANDARD_ERC20_ABI, STANDARD_ERC721_ABI } from '../src/providers/abiProvider';

describe('Isolated Transaction Simulation Worker', () => {
  const tokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const alice = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const bob = '0x1111111254fb6c44bac0bed2854e76f90643097d';
  const charlie = '0x2222222222222222222222222222222222222222';

  // ----------------------------------------------------
  // 1. Successful Transfers
  // ----------------------------------------------------
  describe('Successful Asset Transfers', () => {
    it('simulates native ETH transfer and records balance deltas', async () => {
      const simulator = new InMemorySimulationProvider();
      simulator.setBaseNativeBalance(alice, 10000000000000000000n); // 10 ETH

      const res = await simulator.simulateTransaction({
        from: alice,
        to: bob,
        value: 2000000000000000000n, // 2 ETH
        calldata: '0x',
        chainId: 1,
      });

      expect(res.success).toBe(true);
      expect(res.pinnedSnapshot).toBeDefined();
      expect(res.pinnedSnapshot?.chainId).toBe(1);

      // Check native asset deltas
      const aliceDelta = res.assetDeltas.find((d) => d.account.toLowerCase() === alice.toLowerCase());
      const bobDelta = res.assetDeltas.find((d) => d.account.toLowerCase() === bob.toLowerCase());

      expect(aliceDelta?.amountDelta).toBe('-2000000000000000000');
      expect(bobDelta?.amountDelta).toBe('2000000000000000000');

      // Check disclosed overrides
      expect(res.disclosedOverrides.some((o) => o.type === 'impersonation')).toBe(true);

      // Check discovery limits disclosure
      expect(res.discoveryLimits.length).toBeGreaterThan(0);
      expect(res.discoveryLimits[1]).toContain('State inspection was strictly limited');
    });

    it('simulates ERC-20 transfer and observes state changes', async () => {
      const simulator = new InMemorySimulationProvider();
      simulator.setBaseErc20Balance(tokenAddress, alice, 5000n * 10n ** 18n);

      const transferCalldata = encodeFunctionData({
        abi: STANDARD_ERC20_ABI,
        functionName: 'transfer',
        args: [bob, 1000n * 10n ** 18n],
      });

      const res = await simulator.simulateTransaction({
        from: alice,
        to: tokenAddress,
        value: 0n,
        calldata: transferCalldata,
        chainId: 1,
      });

      expect(res.success).toBe(true);
      expect(res.stateChanges?.erc20Balances.length).toBe(2);

      const aliceChange = res.stateChanges?.erc20Balances.find(
        (b) => b.account.toLowerCase() === alice.toLowerCase()
      );
      expect(aliceChange?.delta).toBe((-1000n * 10n ** 18n).toString());

      const bobChange = res.stateChanges?.erc20Balances.find(
        (b) => b.account.toLowerCase() === bob.toLowerCase()
      );
      expect(bobChange?.delta).toBe((1000n * 10n ** 18n).toString());

      // Logs are captured
      expect(res.logs).toBeDefined();
      expect(res.logs?.length).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------
  // 2. Authorized transferFrom
  // ----------------------------------------------------
  describe('Authorized transferFrom', () => {
    it('simulates authorized transferFrom updating both balances and remaining allowance', async () => {
      const simulator = new InMemorySimulationProvider();
      // Alice owns tokens, approved Bob (spender/caller) for 500 units
      simulator.setBaseErc20Balance(tokenAddress, alice, 1000n * 10n ** 18n);
      simulator.setBaseErc20Allowance(tokenAddress, alice, bob, 500n * 10n ** 18n);

      // Bob calls transferFrom(alice, charlie, 200 units)
      const calldata = encodeFunctionData({
        abi: STANDARD_ERC20_ABI,
        functionName: 'transferFrom',
        args: [alice, charlie, 200n * 10n ** 18n],
      });

      const res = await simulator.simulateTransaction({
        from: bob, // caller
        to: tokenAddress,
        value: 0n,
        calldata,
        chainId: 1,
      });

      expect(res.success).toBe(true);

      // Verify balance changes
      const aliceChange = res.stateChanges?.erc20Balances.find(
        (b) => b.account.toLowerCase() === alice.toLowerCase()
      );
      expect(aliceChange?.delta).toBe((-200n * 10n ** 18n).toString());

      const charlieChange = res.stateChanges?.erc20Balances.find(
        (b) => b.account.toLowerCase() === charlie.toLowerCase()
      );
      expect(charlieChange?.delta).toBe((200n * 10n ** 18n).toString());

      // Verify allowance depletion
      const allowChange = res.stateChanges?.erc20Allowances[0];
      expect(allowChange?.pre).toBe((500n * 10n ** 18n).toString());
      expect(allowChange?.post).toBe((300n * 10n ** 18n).toString());
    });
  });

  // ----------------------------------------------------
  // 3. Revoked Permissions
  // ----------------------------------------------------
  describe('Revoked Permissions', () => {
    it('simulates revoking ERC-20 approval to 0', async () => {
      const simulator = new InMemorySimulationProvider();
      simulator.setBaseErc20Allowance(tokenAddress, alice, bob, 1000n * 10n ** 18n);

      const revokeCalldata = encodeFunctionData({
        abi: STANDARD_ERC20_ABI,
        functionName: 'approve',
        args: [bob, 0n],
      });

      const res = await simulator.simulateTransaction({
        from: alice,
        to: tokenAddress,
        value: 0n,
        calldata: revokeCalldata,
        chainId: 1,
      });

      expect(res.success).toBe(true);
      const allowChange = res.stateChanges?.erc20Allowances[0];
      expect(allowChange?.pre).toBe((1000n * 10n ** 18n).toString());
      expect(allowChange?.post).toBe('0');
      expect(res.separatedEffects?.observedEffects[0]).toContain('changed from');
    });

    it('simulates revoking ERC-721 operator approval (setApprovalForAll(false))', async () => {
      const simulator = new InMemorySimulationProvider();
      const nftContract = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
      simulator.setBaseErc721Approval(nftContract, alice, bob, true); // initially approved

      const revokeNftCalldata = encodeFunctionData({
        abi: STANDARD_ERC721_ABI,
        functionName: 'setApprovalForAll',
        args: [bob, false],
      });

      const res = await simulator.simulateTransaction({
        from: alice,
        to: nftContract,
        value: 0n,
        calldata: revokeNftCalldata,
        chainId: 1,
      });

      expect(res.success).toBe(true);
      const apprChange = res.stateChanges?.erc721Approvals[0];
      expect(apprChange?.preApproved).toBe(true);
      expect(apprChange?.postApproved).toBe(false);
    });
  });

  // ----------------------------------------------------
  // 4. Revert Handling & Invariants
  // ----------------------------------------------------
  describe('Revert Handling & Safety Invariants', () => {
    it('enforces that reverted calls do NOT contribute reverted transfers to final asset deltas', async () => {
      const simulator = new InMemorySimulationProvider();

      const revertCalldata = '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001';

      const res = await simulator.simulateTransaction({
        from: alice,
        to: tokenAddress,
        value: 1000000000000000000n, // 1 ETH attempted
        calldata: revertCalldata,
        chainId: 1,
      });

      expect(res.success).toBe(false);
      expect(res.revertReason).toBeDefined();

      // STRICT INVARIANT: 0 asset deltas on revert
      expect(res.assetDeltas.length).toBe(0);

      // Check unresolved effects notes that revert != harmless
      expect(res.separatedEffects?.unresolvedEffects.some((u) => u.includes('A transaction revert is NOT evidence that the request is harmless'))).toBe(true);
    });
  });

  // ----------------------------------------------------
  // 5. Misleading Events Detection
  // ----------------------------------------------------
  describe('Misleading Events Detection', () => {
    it('detects and flags fake Transfer event logs that lack on-chain state changes', async () => {
      const simulator = new InMemorySimulationProvider();

      // Trigger test vector with fakelog payload
      const misleadingCalldata = '0x12345678fakelog';

      const res = await simulator.simulateTransaction({
        from: alice,
        to: tokenAddress,
        value: 0n,
        calldata: misleadingCalldata,
        chainId: 1,
      });

      expect(res.misleadingEvents.length).toBeGreaterThan(0);
      expect(res.misleadingEvents[0].name).toBe('Transfer');
      expect(res.misleadingEvents[0].reason).toContain('emitted a Transfer event log, but on-chain state inspection confirmed no corresponding balance');
    });
  });

  // ----------------------------------------------------
  // 6. Unavailable Tracing
  // ----------------------------------------------------
  describe('Unavailable Tracing & Coverage Impact', () => {
    it('explicitly reduces coverage when call tracing is disabled or unavailable', async () => {
      const simulator = new InMemorySimulationProvider();

      const res = await simulator.simulateTransaction({
        from: alice,
        to: bob,
        value: 0n,
        calldata: '0x',
        chainId: 1,
        enableTracing: false, // Tracing disabled
      });

      expect(res.coverageImpact).toBeDefined();
      expect(res.coverageImpact?.status).toBe('partial');
      expect(res.coverageImpact?.reasons[0]).toContain('Call tracing disabled or unsupported');
    });
  });

  // ----------------------------------------------------
  // 7. Job Isolation & Zero Cross-Request State Leakage
  // ----------------------------------------------------
  describe('Job Isolation & Zero State Leakage', () => {
    it('ensures Job A state mutations never leak to Job B', async () => {
      const simulator = new InMemorySimulationProvider();
      simulator.setBaseErc20Balance(tokenAddress, alice, 1000n * 10n ** 18n);

      const transferAllCalldata = encodeFunctionData({
        abi: STANDARD_ERC20_ABI,
        functionName: 'transfer',
        args: [bob, 1000n * 10n ** 18n],
      });

      // Job A: Alice transfers ALL 1,000 units to Bob
      const jobA = await simulator.simulateTransaction({
        from: alice,
        to: tokenAddress,
        value: 0n,
        calldata: transferAllCalldata,
        chainId: 1,
      });

      expect(jobA.success).toBe(true);
      const jobADelta = jobA.assetDeltas.find((d) => d.account.toLowerCase() === alice.toLowerCase());
      expect(jobADelta?.amountDelta).toBe((-1000n * 10n ** 18n).toString());

      // Job B: Alice attempts to transfer 1,000 units again in a fresh job session
      // If Job A leaked, Alice's balance would be 0 and Job B would revert.
      // Because jobs are isolated, Alice still has her original base balance!
      const jobB = await simulator.simulateTransaction({
        from: alice,
        to: tokenAddress,
        value: 0n,
        calldata: transferAllCalldata,
        chainId: 1,
      });

      expect(jobB.success).toBe(true);
      const jobBDelta = jobB.assetDeltas.find((d) => d.account.toLowerCase() === alice.toLowerCase());
      expect(jobBDelta?.amountDelta).toBe((-1000n * 10n ** 18n).toString());
    });
  });
});
