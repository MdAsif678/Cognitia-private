// Find an account holding a token on a live chain (from recent Transfer logs), for demos.
//   npx tsx scripts/find-holder.ts [rpcUrl] [token]
import { createPublicClient, http, parseAbi, parseAbiItem, type Address } from "viem";

const rpc = process.argv[2] ?? "https://ethereum-sepolia-rpc.publicnode.com";
const token = (process.argv[3] ?? "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as Address; // Circle USDC on Sepolia
const client = createPublicClient({ transport: http(rpc) });
const head = await client.getBlockNumber();
const logs = await client.getLogs({
  address: token,
  event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
  fromBlock: head - 400n,
  toBlock: head,
});
const seen = new Set<string>();
for (const log of logs.reverse()) {
  const to = log.args.to!;
  if (seen.has(to) || seen.size > 25) continue;
  seen.add(to);
  const [bal, code] = await Promise.all([
    client.readContract({ address: token, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [to] }),
    client.getCode({ address: to }),
  ]);
  if (bal > 0n && (!code || code === "0x")) {
    console.log(JSON.stringify({ holder: to, balance: bal.toString(), token, block: head.toString() }));
    process.exit(0);
  }
}
console.log("no EOA holder found in recent logs");
