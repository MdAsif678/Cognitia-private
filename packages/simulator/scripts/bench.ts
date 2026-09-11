// Benchmark: simulate a mainnet USDC approval N times and print per-stage timings.
//   npx tsx scripts/bench.ts [--runs 3] [--warm 1] [--no-follow] [-- extra anvil args]
import { parseArgs } from "node:util";
import { encodeFunctionData, maxUint256, parseAbi } from "viem";
import { Simulator } from "../src";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string", default: "2" }, warm: { type: "string", default: "0" }, "no-follow": { type: "boolean" } },
});

const sim = new Simulator({
  chains: [{ chainId: 1, name: "Ethereum Mainnet", rpcUrl: process.env.RPC_URL_1 ?? "https://ethereum-rpc.publicnode.com", blockLag: 2 }],
  anvilExtraArgs: positionals,
  simulateFollowUps: !values["no-follow"],
  warmForksPerChain: Number(values.warm),
});
sim.prewarm();
if (Number(values.warm) > 0) await new Promise((r) => setTimeout(r, 8000));

for (let i = 0; i < Number(values.runs); i++) {
  const r = await sim.simulateTransaction({
    chainId: 1,
    tx: {
      from: "0x28C6c06298d514Db089934071355E5743bf21d60",
      to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      data: encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: ["0x000000000000000000000000000000000000dEaD", maxUint256] }),
    },
  });
  console.log(JSON.stringify({ run: i + 1, block: r.fork.blockNumber, verified: r.fork.verified, ms: r.durationMs, timings: r.timingsMs }));
}
await sim.close();
