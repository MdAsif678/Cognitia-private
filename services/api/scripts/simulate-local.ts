/**
 * Run the demo scenarios through the full pipeline against the team's demo chain.
 *   npx tsx services/api/scripts/simulate-local.ts [--rpc http://127.0.0.1:8545] [--full]
 * Addresses default to the deterministic Anvil demo deployment; override with --pusd/--pnft/--wallet/--attacker.
 */
import { parseArgs } from "node:util";
import { encodeFunctionData, maxUint256, parseAbi, parseEther, type Address, type Hex } from "viem";
import type { AnalysisReport, AnalyzeRequest } from "@cognitia/shared";
import { Simulator } from "@cognitia/simulator";
import { baselineEngine } from "../src/engine";
import { analyze } from "../src/pipeline/analyze";

const { values: a } = parseArgs({
  options: {
    rpc: { type: "string", default: "http://127.0.0.1:8545" },
    chain: { type: "string", default: "31337" },
    pusd: { type: "string", default: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" },
    pnft: { type: "string", default: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" },
    drainer: { type: "string", default: "0x5FbDB2315678afecb367f032d93F642f64180aa3" },
    wallet: { type: "string", default: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
    attacker: { type: "string", default: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
    full: { type: "boolean" },
  },
});
const chainId = Number(a.chain);
const [pUSD, pNFT, drainer, wallet, attacker] = [a.pusd, a.pnft, a.drainer, a.wallet, a.attacker].map((x) => x as Address) as [Address, Address, Address, Address, Address];

const ABI = parseAbi([
  "function transfer(address,uint256)",
  "function approve(address,uint256)",
  "function setApprovalForAll(address,bool)",
  "function claim(address)",
]);
const tx = (id: string, to: Address, data: Hex): AnalyzeRequest => ({
  requestId: id, origin: "https://claim-rewards.example", chainId, account: wallet,
  method: "eth_sendTransaction", params: [{ from: wallet, to, data }],
});
const permit = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
    Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
  },
  primaryType: "Permit",
  domain: { name: "Phantom USD", version: "1", chainId, verifyingContract: pUSD },
  message: { owner: wallet, spender: attacker, value: maxUint256.toString(), nonce: "0", deadline: "99999999999" },
};

const scenarios: [string, AnalyzeRequest][] = [
  ["1. benign: transfer 10 pUSD to attacker-as-merchant", tx("s1", pUSD, encodeFunctionData({ abi: ABI, functionName: "transfer", args: [attacker, parseEther("10")] }))],
  ["2. unlimited pUSD approval to attacker", tx("s2", pUSD, encodeFunctionData({ abi: ABI, functionName: "approve", args: [attacker, maxUint256] }))],
  ["3. fake NFT claim: setApprovalForAll(attacker, true)", tx("s3", pNFT, encodeFunctionData({ abi: ABI, functionName: "setApprovalForAll", args: [attacker, true] }))],
  ["4. misleading claim() using a stale approval", tx("s4", drainer, encodeFunctionData({ abi: ABI, functionName: "claim", args: [pUSD] }))],
  ["5. unsigned ERC-2612 permit to attacker", { requestId: "s5", origin: "https://claim-rewards.example", chainId, account: wallet, method: "eth_signTypedData_v4", params: [wallet, JSON.stringify(permit)] }],
];

const simulator = new Simulator({ chains: [{ chainId, name: `Demo chain ${chainId}`, rpcUrl: a.rpc!, blockLag: 0 }] });
const deps = { simulator, engine: baselineEngine, timeoutMs: 60_000 };
const changes = (r: AnalysisReport, list: AnalysisReport["immediateChanges"]) =>
  list.map((c) => {
    const sym = r.tokens.find((t) => t.address.toLowerCase() === ("token" in c ? c.token : "").toLowerCase())?.symbol ?? "";
    switch (c.kind) {
      case "erc20-balance": return `   ${sym} balance ${c.account.slice(0, 8)}…: ${c.before} → ${c.after}`;
      case "erc20-allowance": return `   ${sym} allowance ${c.owner.slice(0, 8)}…→${c.spender.slice(0, 8)}…: ${c.before} → ${c.unlimitedAfter ? "UNLIMITED" : c.after}`;
      case "operator-approval": return `   ${sym} operator ${c.owner.slice(0, 8)}…→${c.operator.slice(0, 8)}…: ${c.before} → ${c.after}`;
      case "erc721-owner": return `   ${sym} #${c.tokenId} owner: ${c.before?.slice(0, 8)}… → ${c.after?.slice(0, 8)}…`;
      case "native-balance": return `   ETH ${c.account.slice(0, 8)}…: ${c.delta} wei`;
      default: return `   ${c.kind}`;
    }
  }).join("\n");

try {
  for (const [label, req] of scenarios) {
    const r = await analyze(req, deps);
    console.log(`\n${label}`);
    console.log(`   ${r.status.toUpperCase()} | ${r.summary} | block #${r.fork?.blockNumber ?? "-"}${r.fork?.verified ? " (verified)" : ""} | ${r.durationMs}ms`);
    for (const f of r.findings) console.log(`   [${f.severity}] ${f.title}`);
    if (r.immediateChanges.length) console.log("   immediate:\n" + changes(r, r.immediateChanges));
    if (r.conditionalChanges.length) console.log("   conditional (if the attacker acts next):\n" + changes(r, r.conditionalChanges));
    if (a.full) console.log(JSON.stringify(r, null, 2));
  }
} finally {
  await simulator.close();
}
