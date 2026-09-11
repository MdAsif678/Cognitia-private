/**
 * Simulate an unsigned transaction against live chain state from the command line.
 *
 *   npm run simulate -w @cognitia/simulator -- --example mainnet-usdc-approve
 *   npm run simulate -w @cognitia/simulator -- --chain 11155111 --from 0x.. --to 0x.. --data 0x.. [--value wei] [--block n]
 */
import { parseArgs } from "node:util";
import { encodeFunctionData, maxUint256, parseAbi } from "viem";
import { chainsFromEnv, Simulator } from "../src";

const ERC20 = parseAbi(["function approve(address,uint256)", "function transfer(address,uint256)"]);

/** Real mainnet/Sepolia contracts and holders, so the output reflects actual on-chain state. */
const EXAMPLES: Record<string, { chainId: number; from: `0x${string}`; to: `0x${string}`; data: `0x${string}`; note: string }> = {
  "mainnet-usdc-approve": {
    chainId: 1,
    note: "Unlimited USDC approval from a large exchange hot wallet (Binance 14) to an arbitrary address",
    from: "0x28C6c06298d514Db089934071355E5743bf21d60",
    to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: ["0x000000000000000000000000000000000000dEaD", maxUint256] }),
  },
  "mainnet-usdc-transfer": {
    chainId: 1,
    note: "1,000 USDC transfer from Binance 14 through the FiatTokenProxy (exercises DELEGATECALL tracing)",
    from: "0x28C6c06298d514Db089934071355E5743bf21d60",
    to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: ["0x000000000000000000000000000000000000dEaD", 1_000_000_000n] }),
  },
};

const { values } = parseArgs({
  options: {
    example: { type: "string" },
    chain: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    data: { type: "string" },
    value: { type: "string" },
    block: { type: "string" },
    full: { type: "boolean" },
  },
});

const ex = values.example ? EXAMPLES[values.example] : undefined;
if (values.example && !ex) throw new Error(`unknown example; choose one of: ${Object.keys(EXAMPLES).join(", ")}`);
const chainId = Number(values.chain ?? ex?.chainId);
const from = (values.from ?? ex?.from) as `0x${string}`;
if (!chainId || !from) throw new Error("need --example or --chain and --from");

const sim = new Simulator({ chains: chainsFromEnv() });
try {
  if (ex) console.error(`# ${ex.note}`);
  const result = await sim.simulateTransaction({
    chainId,
    tx: { from, to: (values.to ?? ex?.to) as `0x${string}`, data: (values.data ?? ex?.data) as `0x${string}`, value: values.value },
    blockNumber: values.block ? BigInt(values.block) : undefined,
  });
  const { calls, accounts, ...summary } = result;
  console.log(JSON.stringify(values.full ? result : { ...summary, calls: `${calls.length} frames`, accounts: `${accounts.length} accounts` }, null, 2));
} finally {
  await sim.close();
}
