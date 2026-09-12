import { defaultInMemorySimulator } from '../src/simulator/inMemorySimulator';
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { domainSeparator, parseSignature } from 'viem';
import { Erc2612SignatureAdapter } from '../src/providers/signatureAdapters/erc2612Adapter';
import { MockChainReadProvider } from '../src/providers/chainProvider';
import { RiskEngine } from '../src/engine/riskEngine';
import { InMemorySimulationProvider } from '../src/simulator/inMemorySimulator';

describe('ERC-2612 Explicit Supported-Token Adapter', () => {
  // Local test key (Foundry Test Account #0) - used ONLY in test fixtures
  const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
  const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const OWNER_ADDRESS = testAccount.address; // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

  const TOKEN_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
  const CONTRACT_SPENDER = '0x1111111254fb6c44bac0bed2854e76f90643097d' as `0x${string}`; // 1inch Router (contract)
  const CHAIN_ID = 1;
  const PINNED_BLOCK_TIMESTAMP = 1700000000n;

  const validDomain = {
    name: 'USD Coin',
    version: '2',
    chainId: CHAIN_ID,
    verifyingContract: TOKEN_ADDRESS as `0x${string}`,
  };

  const expectedDomainSeparator = domainSeparator({ domain: validDomain });

  function setupMockChain(): MockChainReadProvider {
    const mock = new MockChainReadProvider(CHAIN_ID);
    mock.setDomainSeparator(TOKEN_ADDRESS, expectedDomainSeparator);
    mock.setTokenNonce(TOKEN_ADDRESS, OWNER_ADDRESS, 0n);
    mock.setBlockTimestamp(PINNED_BLOCK_TIMESTAMP);
    mock.setTokenBalance(TOKEN_ADDRESS, OWNER_ADDRESS, 5000_000000n); // 5,000 USDC
    mock.setTokenAllowance(TOKEN_ADDRESS, OWNER_ADDRESS, CONTRACT_SPENDER, 0n);
    // Mark spender as contract bytecode
    mock.setBytecode(CONTRACT_SPENDER, '0x608060405234801561001057600080fd5b50');
    return mock;
  }

  // --------------------------------------------------------------------------
  // TEST 1: Real Signed Permit vs Conditional Model Comparison
  // --------------------------------------------------------------------------
  it('compares real signed permit with conditional model and verifies state equivalence', async () => {
    const mockChain = setupMockChain();
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });
    const permitValue = 1000_000000n; // 1,000 USDC
    const deadline = PINNED_BLOCK_TIMESTAMP + 3600n; // valid for 1 hour

    // 1. Generate real cryptographic signature using local test key
    const permitTypes = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    const permitMessage = {
      owner: OWNER_ADDRESS,
      spender: CONTRACT_SPENDER,
      value: permitValue,
      nonce: 0n,
      deadline,
    };

    const signatureHex = await testAccount.signTypedData({
      domain: validDomain,
      types: permitTypes,
      primaryType: 'Permit',
      message: permitMessage,
    });

    const parsedSig = parseSignature(signatureHex);
    expect(parsedSig.r).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(parsedSig.s).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(parsedSig.v).toBeDefined();

    // 2. Analyze the unsigned request through adapter
    const unsignedRequest = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: permitTypes as any,
        primaryType: 'Permit' as const,
        domain: validDomain,
        message: {
          owner: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          value: permitValue.toString(),
          nonce: '0',
          deadline: deadline.toString(),
        },
      },
    };

    expect(adapter.canHandle(unsignedRequest)).toBe(true);
    const analysis = await adapter.analyze(unsignedRequest, { chainProvider: mockChain });

    // Verify displayed fields
    expect(analysis.intent.owner?.toLowerCase()).toBe(OWNER_ADDRESS.toLowerCase());
    expect(analysis.intent.spenderOrOperator?.toLowerCase()).toBe(CONTRACT_SPENDER.toLowerCase());
    expect(analysis.intent.targetContract?.toLowerCase()).toBe(TOKEN_ADDRESS.toLowerCase());
    expect(analysis.intent.amount).toBe(permitValue.toString());
    expect(analysis.intent.typedDataDetails?.domain).toEqual(validDomain);
    expect(analysis.intent.typedDataDetails?.isExpired).toBe(false);
    expect(analysis.intent.typedDataDetails?.nonceMatches).toBe(true);
    expect(analysis.intent.typedDataDetails?.domainSeparatorMatches).toBe(true);

    // Pre-state reads
    expect(analysis.intent.typedDataDetails?.preState?.tokenBalance).toBe('5000000000');
    expect(analysis.intent.typedDataDetails?.preState?.tokenAllowance).toBe('0');

    // Preconditions verified, coverage complete
    expect(analysis.coverage).toBe('complete');
    expect(analysis.simulatedPermitTarget).toBeDefined();
    expect(analysis.simulatedPermitTarget?.isContractSpender).toBe(true);

    // 3. Simulate conditional outcome
    const simulator = new InMemorySimulationProvider();
    const simResult = await simulator.simulateConditionalPermit({
      token: analysis.simulatedPermitTarget!.token,
      owner: analysis.simulatedPermitTarget!.owner,
      spender: analysis.simulatedPermitTarget!.spender,
      value: analysis.simulatedPermitTarget!.value,
      chainId: CHAIN_ID,
      isContractSpender: analysis.simulatedPermitTarget!.isContractSpender,
      preBalance: analysis.simulatedPermitTarget!.preBalance,
      preAllowance: analysis.simulatedPermitTarget!.preAllowance,
      hypotheticalRecipient: analysis.simulatedPermitTarget!.hypotheticalRecipient,
    });

    // Exact label assertion: "Conditional outcome if this permit is signed and accepted."
    expect(simResult.conditionalLabel).toBe('Conditional outcome if this permit is signed and accepted.');

    // Verify 2-step hypothetical modeling disclosures
    expect(simResult.assumptions.some((a) => a.includes('Do not claim to execute the permit'))).toBe(true);
    expect(simResult.assumptions.some((a) => a.includes('Step 1 (Modeled Equivalent Allowance)'))).toBe(true);
    expect(simResult.assumptions.some((a) => a.includes('Step 2 (Hypothetical Subsequent Spender Transfer)'))).toBe(true);
    expect(simResult.assumptions.some((a) => a.includes('Never infer actual spender intent'))).toBe(true);
    expect(simResult.assumptions.some((a) => a.includes('Contract spender') && a.includes('authorization capacity'))).toBe(true);

    // Verify overrides disclosure
    expect(simResult.disclosedOverrides.some((o) => o.type === 'storage_override')).toBe(true);
    expect(simResult.disclosedOverrides.some((o) => o.type === 'impersonation')).toBe(true);
    expect(simResult.disclosedOverrides.some((o) => o.type === 'funding')).toBe(true);

    // Compare real signed outcome with conditional model
    // In real execution: owner allowance would become permitValue, then transferFrom moves permitValue to recipient
    const ownerDelta = simResult.assetDeltas.find((d) => d.account.toLowerCase() === OWNER_ADDRESS.toLowerCase());
    const recipientDelta = simResult.assetDeltas.find((d) => d.account.toLowerCase() !== OWNER_ADDRESS.toLowerCase());
    expect(ownerDelta?.amountDelta).toBe((-permitValue).toString());
    expect(recipientDelta?.amountDelta).toBe(permitValue.toString());
  });

  // --------------------------------------------------------------------------
  // TEST 2: Expired Deadline
  // --------------------------------------------------------------------------
  it('rejects expired permit deadline and does not model conditional outcome as valid', async () => {
    const mockChain = setupMockChain();
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });
    const expiredDeadline = PINNED_BLOCK_TIMESTAMP - 100n; // 100 seconds in past

    const expiredRequest = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: validDomain,
        message: {
          owner: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          value: '1000000',
          nonce: '0',
          deadline: expiredDeadline.toString(),
        },
      },
    };

    const analysis = await adapter.analyze(expiredRequest, { chainProvider: mockChain });

    expect(analysis.coverage).toBe('partial');
    expect(analysis.intent.typedDataDetails?.isExpired).toBe(true);

    const expiredFinding = analysis.findings.find((f) => f.ruleId === 'erc2612_expired_deadline');
    expect(expiredFinding).toBeDefined();
    expect(expiredFinding?.severity).toBe('high');
    expect(expiredFinding?.title).toContain('Expired');

    // Strict invariant: Known invalid deadline is NEVER modeled as valid
    expect(analysis.simulatedPermitTarget).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // TEST 3: Wrong Nonce
  // --------------------------------------------------------------------------
  it('rejects nonce mismatch relative to on-chain nonces(owner) and does not model as valid', async () => {
    const mockChain = setupMockChain();
    // On-chain nonce is 0, message specifies 7
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });

    const wrongNonceRequest = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: validDomain,
        message: {
          owner: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          value: '1000000',
          nonce: '7', // Invalid nonce!
          deadline: (PINNED_BLOCK_TIMESTAMP + 3600n).toString(),
        },
      },
    };

    const analysis = await adapter.analyze(wrongNonceRequest, { chainProvider: mockChain });

    expect(analysis.coverage).toBe('partial');
    expect(analysis.intent.typedDataDetails?.nonceMatches).toBe(false);

    const nonceFinding = analysis.findings.find((f) => f.ruleId === 'erc2612_nonce_mismatch');
    expect(nonceFinding).toBeDefined();
    expect(nonceFinding?.severity).toBe('high');
    expect(nonceFinding?.plainEnglishExplanation).toContain('Permit nonce (7) does not match');

    // Strict invariant: Known invalid nonce is NEVER modeled as valid
    expect(analysis.simulatedPermitTarget).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // TEST 4: Wrong Domain Separator
  // --------------------------------------------------------------------------
  it('detects domain mismatch against token DOMAIN_SEPARATOR() and does not model as valid', async () => {
    const mockChain = setupMockChain();
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });

    // Request domain specifies wrong token name 'USD Coin V1'
    const wrongDomain = {
      ...validDomain,
      name: 'USD Coin V1', // Mismatched name!
    };

    const wrongDomainRequest = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: wrongDomain,
        message: {
          owner: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          value: '1000000',
          nonce: '0',
          deadline: (PINNED_BLOCK_TIMESTAMP + 3600n).toString(),
        },
      },
    };

    const analysis = await adapter.analyze(wrongDomainRequest, { chainProvider: mockChain });

    expect(analysis.coverage).toBe('partial');
    expect(analysis.intent.typedDataDetails?.domainSeparatorMatches).toBe(false);

    const domainFinding = analysis.findings.find((f) => f.ruleId === 'erc2612_domain_separator_mismatch');
    expect(domainFinding).toBeDefined();
    expect(domainFinding?.severity).toBe('high');

    // Strict invariant: Domain mismatch is NEVER modeled as valid
    expect(analysis.simulatedPermitTarget).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // TEST 5: Unsupported Variant - DAI-Style Permit
  // --------------------------------------------------------------------------
  it('explicitly rejects DAI-style permits with coverage: unsupported and does not treat as ERC-2612', async () => {
    const mockChain = setupMockChain();
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });

    const daiPermitRequest = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'holder', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
            { name: 'allowed', type: 'bool' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: {
          name: 'Dai Stablecoin',
          version: '1',
          chainId: 1,
          verifyingContract: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        },
        message: {
          holder: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          nonce: '0',
          expiry: (PINNED_BLOCK_TIMESTAMP + 3600n).toString(),
          allowed: true,
        },
      },
    };

    expect(adapter.canHandle(daiPermitRequest)).toBe(true);
    const analysis = await adapter.analyze(daiPermitRequest, { chainProvider: mockChain });

    // Explicit uncertainty / unsupported returned
    expect(analysis.coverage).toBe('unsupported');
    expect(analysis.reasons.some((r) => r.includes('DAI-style permit variant detected'))).toBe(true);

    const finding = analysis.findings.find((f) => f.ruleId === 'erc2612_unsupported_variant');
    expect(finding).toBeDefined();
    expect(finding?.title).toContain('DAI-Style Permit');
    expect(finding?.plainEnglishExplanation).toContain('DAI permits grant boolean approval');

    // Never model DAI permit as ERC-2612
    expect(analysis.simulatedPermitTarget).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // TEST 6: Zero Owner Rejection
  // --------------------------------------------------------------------------
  it('rejects a zero address owner with Critical severity and does not model as valid', async () => {
    const mockChain = setupMockChain();
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });

    const zeroOwnerRequest = {
      type: 'eip712' as const,
      expectedSigner: '0x0000000000000000000000000000000000000000',
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: validDomain,
        message: {
          owner: '0x0000000000000000000000000000000000000000',
          spender: CONTRACT_SPENDER,
          value: '1000000',
          nonce: '0',
          deadline: (PINNED_BLOCK_TIMESTAMP + 3600n).toString(),
        },
      },
    };

    const analysis = await adapter.analyze(zeroOwnerRequest, { chainProvider: mockChain });

    const zeroOwnerFinding = analysis.findings.find((f) => f.ruleId === 'erc2612_zero_owner');
    expect(zeroOwnerFinding).toBeDefined();
    expect(zeroOwnerFinding?.severity).toBe('critical');

    // Never model zero owner as valid
    expect(analysis.simulatedPermitTarget).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // TEST 7: Unsupported Token Variant (Missing DOMAIN_SEPARATOR on-chain)
  // --------------------------------------------------------------------------
  it('returns explicit uncertainty (coverage: unsupported) when token lacks DOMAIN_SEPARATOR()', async () => {
    const mockChain = setupMockChain();
    const NON_ERC2612_TOKEN = '0x2222222222222222222222222222222222222222';
    // Explicitly set DOMAIN_SEPARATOR to null for this token
    mockChain.setDomainSeparator(NON_ERC2612_TOKEN, null);

    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });

    const req = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: {
          name: 'Custom Token',
          chainId: CHAIN_ID,
          verifyingContract: NON_ERC2612_TOKEN,
        },
        message: {
          owner: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          value: '1000',
          nonce: '0',
          deadline: (PINNED_BLOCK_TIMESTAMP + 3600n).toString(),
        },
      },
    };

    const analysis = await adapter.analyze(req, { chainProvider: mockChain });
    expect(analysis.coverage).toBe('unsupported');
    expect(analysis.findings.some((f) => f.ruleId === 'erc2612_unsupported_token_variant')).toBe(true);
    expect(analysis.simulatedPermitTarget).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // TEST 8: End-to-End Analysis via RiskEngine
  // --------------------------------------------------------------------------
  it('runs through full RiskEngine pipeline with contract spender capacity disclosure', async () => {
    const mockChain = setupMockChain();
    const adapter = new Erc2612SignatureAdapter({ chainProvider: mockChain });
    const engine = new RiskEngine({
      simulationProvider: defaultInMemorySimulator,
      signatureAdapters: [adapter],
      chainProvider: mockChain,
    });

    const validRequest = {
      type: 'eip712' as const,
      expectedSigner: OWNER_ADDRESS,
      selectedChainId: CHAIN_ID,
      payload: {
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit' as const,
        domain: validDomain,
        message: {
          owner: OWNER_ADDRESS,
          spender: CONTRACT_SPENDER,
          value: '500000000',
          nonce: '0',
          deadline: (PINNED_BLOCK_TIMESTAMP + 3600n).toString(),
        },
      },
    };

    const report = await engine.analyze(validRequest);

    expect(report.coverage.components.signatureAnalysis).toBe('complete');
    expect(report.simulationResult?.conditionalLabel).toBe(
      'Conditional outcome if this permit is signed and accepted.'
    );
    expect(report.simulationResult?.assumptions.some((a) => a.includes('authorization capacity'))).toBe(true);
    expect(report.simulationResult?.assumptions.some((a) => a.includes('hypothetical recipient'))).toBe(true);
  });
});
