import { describe, it, expect } from 'vitest';
import { encodeFunctionData, encodeAbiParameters, parseAbiParameters } from 'viem';
import { IntentDecoder } from '../src/engine/intentDecoder';
import { DefaultProxyResolver } from '../src/providers/proxyResolver';
import { DefaultInterfaceResolver } from '../src/providers/interfaceResolver';
import { DefaultAbiLookupProvider } from '../src/providers/abiProvider';
import {
  STANDARD_ERC20_ABI,
  STANDARD_ERC721_ABI,
  STANDARD_ERC1155_ABI,
} from '../src/providers/abiProvider';
import {
  FIXTURE_ROUTER_ADDRESS,
  FIXTURE_DISPATCH_BATCH_SELECTOR,
} from '../src/engine/adapters/fixtureTestRouterAdapter';

describe('Transaction Intent Decoder — Comprehensive Suite', () => {
  const proxyResolver = new DefaultProxyResolver();
  const interfaceResolver = new DefaultInterfaceResolver();
  const abiProvider = new DefaultAbiLookupProvider();

  const decoder = new IntentDecoder({
    proxyResolver,
    interfaceResolver,
    abiProvider,
    maxRecursionDepth: 3,
    maxCalldataSize: 1024, // 1 KB limit for tests
    maxSubcalls: 10,
  });

  // ----------------------------------------------------
  // 1. Overloaded Functions Tests
  // ----------------------------------------------------
  describe('Overloaded Functions', () => {
    it('decodes ERC-721 safeTransferFrom with 3 arguments (address,address,uint256)', async () => {
      const from = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const to = '0x1111111254fb6c44bac0bed2854e76f90643097d';
      const tokenId = 42n;

      const calldata = encodeFunctionData({
        abi: STANDARD_ERC721_ABI,
        functionName: 'safeTransferFrom',
        args: [from, to, tokenId],
      });

      const decoded = await decoder.decode(calldata, '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', '0', 1);

      expect(decoded.functionName).toBe('safeTransferFrom');
      expect(decoded.assetStandard).toBe('ERC-721');
      expect(decoded.owner?.toLowerCase()).toBe(from.toLowerCase());
      expect(decoded.recipient?.toLowerCase()).toBe(to.toLowerCase());
      expect(decoded.tokenIds).toEqual(['42']);
      expect(decoded.arguments?.length).toBe(3);
    });

    it('decodes ERC-721 safeTransferFrom with 4 arguments (address,address,uint256,bytes)', async () => {
      const from = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const to = '0x1111111254fb6c44bac0bed2854e76f90643097d';
      const tokenId = 999n;
      const dataBytes = '0x1234';

      const calldata = encodeFunctionData({
        abi: STANDARD_ERC721_ABI,
        functionName: 'safeTransferFrom',
        args: [from, to, tokenId, dataBytes],
      });

      const decoded = await decoder.decode(calldata, '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', '0', 1);

      expect(decoded.functionName).toBe('safeTransferFrom');
      expect(decoded.assetStandard).toBe('ERC-721');
      expect(decoded.tokenIds).toEqual(['999']);
      expect(decoded.arguments?.length).toBe(4);
      expect(decoded.arguments?.find((a) => a.name === 'data')?.value).toBe('0x1234');
    });

    it('decodes ERC-1155 safeTransferFrom (5 arguments: from, to, id, amount, data)', async () => {
      const from = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const to = '0x2222222222222222222222222222222222222222';
      const id = 100n;
      const amount = 5n;

      const calldata = encodeFunctionData({
        abi: STANDARD_ERC1155_ABI,
        functionName: 'safeTransferFrom',
        args: [from, to, id, amount, '0x'],
      });

      const decoded = await decoder.decode(calldata, '0x495f947276749Ce646f68AC8c248420045cb7b5e', '0', 1);

      expect(decoded.functionName).toBe('safeTransferFrom');
      expect(decoded.assetStandard).toBe('ERC-1155');
      expect(decoded.amount).toBe('5');
      expect(decoded.tokenIds).toEqual(['100']);
      expect(decoded.arguments?.length).toBe(5);
    });

    it('decodes ERC-1155 safeBatchTransferFrom with multiple ids and amounts', async () => {
      const from = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const to = '0x2222222222222222222222222222222222222222';
      const ids = [1n, 2n, 3n];
      const amounts = [10n, 20n, 30n];

      const calldata = encodeFunctionData({
        abi: STANDARD_ERC1155_ABI,
        functionName: 'safeBatchTransferFrom',
        args: [from, to, ids, amounts, '0x'],
      });

      const decoded = await decoder.decode(calldata, '0x495f947276749Ce646f68AC8c248420045cb7b5e', '0', 1);

      expect(decoded.functionName).toBe('safeBatchTransferFrom');
      expect(decoded.assetStandard).toBe('ERC-1155');
      expect(decoded.tokenIds).toEqual(['1', '2', '3']);
    });
  });

  // ----------------------------------------------------
  // 2. Overlapping Selector Ambiguity Resolution Tests
  // ----------------------------------------------------
  describe('Selector Ambiguity Resolution', () => {
    const from = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const to = '0x3333333333333333333333333333333333333333';
    const valueOrTokenId = 5000000000000000000n; // 5 units or token ID 5...

    const transferFromCalldata = encodeFunctionData({
      abi: STANDARD_ERC20_ABI,
      functionName: 'transferFrom',
      args: [from, to, valueOrTokenId],
    });

    it('preserves ambiguity for transferFrom (0x23b872dd) when contract interface is unproven', async () => {
      const unverifiedContract = '0x9999999999999999999999999999999999999999';
      const decoded = await decoder.decode(transferFromCalldata, unverifiedContract, '0', 1);

      expect(decoded.functionName).toBe('transferFrom');
      expect(decoded.assetStandard).toBe('ERC-20 | ERC-721 (ambiguous)');
      expect(decoded.confidence?.level).toBe('medium');
      expect(decoded.unresolvedQuestions?.length).toBeGreaterThan(0);
      expect(decoded.unresolvedQuestions?.[0]).toContain('Cannot establish whether parameter 2 is an ERC-20');
      // Both amount and tokenIds are preserved losslessly
      expect(decoded.amount).toBe(valueOrTokenId.toString());
      expect(decoded.tokenIds).toEqual([valueOrTokenId.toString()]);
    });

    it('resolves transferFrom (0x23b872dd) to ERC-721 when interface evidence is present', async () => {
      const nftContract = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
      interfaceResolver.registerInterface(nftContract, 'ERC-721');

      const decoded = await decoder.decode(transferFromCalldata, nftContract, '0', 1);

      expect(decoded.assetStandard).toBe('ERC-721');
      expect(decoded.tokenIds).toEqual([valueOrTokenId.toString()]);
      expect(decoded.confidence?.level).toBe('high');
      expect(decoded.unresolvedQuestions?.length ?? 0).toBe(0);
    });

    it('resolves transferFrom (0x23b872dd) to ERC-20 when interface evidence is present', async () => {
      const erc20Contract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      interfaceResolver.registerInterface(erc20Contract, 'ERC-20');

      const decoded = await decoder.decode(transferFromCalldata, erc20Contract, '0', 1);

      expect(decoded.assetStandard).toBe('ERC-20');
      expect(decoded.amount).toBe(valueOrTokenId.toString());
      expect(decoded.confidence?.level).toBe('high');
      expect(decoded.unresolvedQuestions?.length ?? 0).toBe(0);
    });

    it('preserves ambiguity for setApprovalForAll (0xa22cb465) when interface is unproven', async () => {
      const calldata = encodeFunctionData({
        abi: STANDARD_ERC721_ABI,
        functionName: 'setApprovalForAll',
        args: ['0x1111111254fb6c44bac0bed2854e76f90643097d', true],
      });

      const decoded = await decoder.decode(calldata, '0x7777777777777777777777777777777777777777', '0', 1);

      expect(decoded.functionName).toBe('setApprovalForAll');
      expect(decoded.assetStandard).toBe('ERC-721 | ERC-1155 (ambiguous)');
      expect(decoded.unresolvedQuestions?.[0]).toContain('ERC-721 single-token collection or an ERC-1155');
    });
  });

  // ----------------------------------------------------
  // 3. Malformed Calldata Handling
  // ----------------------------------------------------
  describe('Malformed Calldata', () => {
    it('gracefully handles odd-length hex strings', async () => {
      const oddCalldata = '0x123';
      const decoded = await decoder.decode(oddCalldata, '0x1111111111111111111111111111111111111111', '0', 1);

      expect(decoded.isUnknownFunction).toBe(true);
      expect(decoded.abiProvenance).toBe('unknown');
      expect(decoded.unresolvedQuestions?.[0]).toContain('Malformed calldata');
    });

    it('gracefully handles truncated calldata under 4 bytes', async () => {
      const shortCalldata = '0x1234';
      const decoded = await decoder.decode(shortCalldata, '0x1111111111111111111111111111111111111111', '0', 1);

      expect(decoded.isUnknownFunction).toBe(true);
      expect(decoded.functionName).toBe('fallback_or_raw');
      expect(decoded.unresolvedQuestions?.[0]).toContain('under 4 bytes');
    });
  });

  // ----------------------------------------------------
  // 4. Proxy Implementation Resolution
  // ----------------------------------------------------
  describe('Proxy Resolution Workflow', () => {
    it('resolves proxy implementation at analysis block and records provenance', async () => {
      const proxyAddr = '0x5555555555555555555555555555555555555555';
      const implAddr = '0x6666666666666666666666666666666666666666';

      // Register proxy mapping in proxy resolver
      proxyResolver.registerMockProxy(proxyAddr, implAddr, 'EIP-1967');

      // Register implementation ABI
      abiProvider.registerVerifiedAbi(implAddr, 1, [
        {
          type: 'function',
          name: 'customVaultDeposit',
          inputs: [{ name: 'assets', type: 'uint256' }],
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'nonpayable',
        },
      ]);

      const calldata = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'customVaultDeposit',
            inputs: [{ name: 'assets', type: 'uint256' }],
            outputs: [{ name: '', type: 'uint256' }],
            stateMutability: 'nonpayable',
          },
        ],
        functionName: 'customVaultDeposit',
        args: [1000000n],
      });

      const decoded = await decoder.decode(calldata, proxyAddr, '0', 1);

      expect(decoded.functionName).toBe('customVaultDeposit');
      expect(decoded.abiProvenance).toBe('proxy_implementation');
      expect(decoded.proxyInfo).toBeDefined();
      expect(decoded.proxyInfo?.isProxy).toBe(true);
      expect(decoded.proxyInfo?.proxyStandard).toBe('EIP-1967');
      expect(decoded.proxyInfo?.implementationAddress?.toLowerCase()).toBe(implAddr.toLowerCase());
      expect(decoded.confidence?.level).toBe('high');
    });
  });

  // ----------------------------------------------------
  // 5. Nested Calls via Fixture-Only Adapter
  // ----------------------------------------------------
  describe('Fixture-Only Adapter Support & Nested Dispatch', () => {
    it('decodes nested subcalls via FixtureTestRouterAdapter and preserves execution semantics', async () => {
      const subTarget1 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const subCalldata1 = encodeFunctionData({
        abi: STANDARD_ERC20_ABI,
        functionName: 'approve',
        args: ['0x1111111254fb6c44bac0bed2854e76f90643097d', 1000n],
      });

      const subTarget2 = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
      const subCalldata2 = encodeFunctionData({
        abi: STANDARD_ERC721_ABI,
        functionName: 'setApprovalForAll',
        args: ['0x2222222222222222222222222222222222222222', true],
      });

      // Encode calls: (address target, uint256 value, bytes data)[]
      const encodedCalls = encodeAbiParameters(
        parseAbiParameters('(address target, uint256 value, bytes data)[]'),
        [
          [
            { target: subTarget1, value: 0n, data: subCalldata1 },
            { target: subTarget2, value: 0n, data: subCalldata2 },
          ],
        ]
      );

      const routerCalldata = `${FIXTURE_DISPATCH_BATCH_SELECTOR}${encodedCalls.slice(2)}`;

      const decoded = await decoder.decode(routerCalldata, FIXTURE_ROUTER_ADDRESS, '0', 1);

      expect(decoded.functionName).toBe('dispatchBatch');
      expect(decoded.unresolvedQuestions?.[0]).toContain('Fixture-only router adapter used');
      expect(decoded.nestedCalls).toBeDefined();
      expect(decoded.nestedCalls?.length).toBe(2);

      // Verify subcall 1 execution semantics
      const sub1 = decoded.nestedCalls![0];
      expect(sub1.functionName).toBe('approve');
      expect(sub1.target?.toLowerCase()).toBe(subTarget1.toLowerCase());
      expect(sub1.caller?.toLowerCase()).toBe(FIXTURE_ROUTER_ADDRESS.toLowerCase());
      expect(sub1.callType).toBe('call');

      // Verify subcall 2 execution semantics
      const sub2 = decoded.nestedCalls![1];
      expect(sub2.functionName).toBe('setApprovalForAll');
      expect(sub2.target?.toLowerCase()).toBe(subTarget2.toLowerCase());
      expect(sub2.callType).toBe('call');
    });
  });

  // ----------------------------------------------------
  // 6. Safety Limits & Truncation
  // ----------------------------------------------------
  describe('Safety Limits & Truncation Reporting', () => {
    it('reports truncation when calldata exceeds maxCalldataSize', async () => {
      // Create a payload larger than 1024 bytes
      const hugeCalldata = '0x' + '00'.repeat(1025);
      const decoded = await decoder.decode(hugeCalldata, '0x1111111111111111111111111111111111111111', '0', 1);

      expect(decoded.truncationReport).toBeDefined();
      expect(decoded.truncationReport?.truncated).toBe(true);
      expect(decoded.truncationReport?.reason).toContain('Exceeded maxCalldataSize');
    });
  });
});
