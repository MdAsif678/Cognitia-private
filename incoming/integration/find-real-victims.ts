// Find real mainnet approvals granted to a documented drainer (Swastik's threat DB) in recent blocks.
//   npx tsx incoming/integration/find-real-victims.ts [blocksBack=30000]
import { createPublicClient, getAddress, http, parseAbiItem, type Address } from "viem";

const DRAINERS: Record<string, Address> = {
  "Inferno Drainer spender": getAddress("0x0000db5c8b030ae5034102f866416f8b25530182"),
  "PinkDrainer operator": getAddress("0x000000000000543666fe5bc9635f793b82141505"),
};
const client = createPublicClient({ transport: http(process.env.RPC_URL_1 ?? "https://ethereum-rpc.publicnode.com", { timeout: 30_000 }) });
const APPROVAL = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");
const APPROVAL_FOR_ALL = parseAbiItem("event ApprovalForAll(address indexed owner, address indexed operator, bool approved)");

const head = await client.getBlockNumber();
const back = BigInt(process.argv[2] ?? 30_000);
// Public RPCs reject eth_getLogs without a contract filter; scan the tokens drainers target most.
const TOKENS: Address[] = [
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
  "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
];
const step = 5_000n; // publicnode's maximum window per call
console.log(`scanning mainnet blocks ${head - back}..${head} for approvals to documented drainers`);
for (const [label, addr] of Object.entries(DRAINERS)) {
  const hits: { block: bigint; tx: `0x${string}`; token: Address; owner: Address; kind: string }[] = [];
  for (const token of TOKENS) {
    // publicnode: exactly one contract address per eth_getLogs call
    for (let from = head - back; from <= head && hits.length < 5; from += step) {
      const to = from + step - 1n > head ? head : from + step - 1n;
      try {
        const logs = await client.getLogs({ address: token, event: APPROVAL, args: { spender: addr }, fromBlock: from, toBlock: to });
        for (const l of logs) hits.push({ block: l.blockNumber!, tx: l.transactionHash!, token: l.address, owner: l.args.owner!, kind: "approve" });
      } catch (err) {
        console.log(`  ${token.slice(0, 8)} range ${from}-${to}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }
  console.log(`\n${label} (${addr}): ${hits.length} approval(s) found`);
  for (const h of hits.slice(-5)) console.log(`  block ${h.block}  ${h.kind}  token ${h.token}  victim ${h.owner}  tx ${h.tx}`);
}
