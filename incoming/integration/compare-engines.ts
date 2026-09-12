/**
 * Runs the demo scenarios through the full pipeline twice — baseline engine vs Swastik's engine
 * bridged onto the fork simulator — and prints the verdicts side by side.
 *   npx tsx incoming/integration/compare-engines.ts        (needs the local demo chain on :8545)
 */
import { encodeFunctionData, getAddress, maxUint256, parseAbi, parseEther, type Address, type Hex } from "viem";
import type { AnalysisReport, AnalyzeRequest } from "@cognitia/shared";
import { chainsFromEnv, Simulator } from "@cognitia/simulator";
import { baselineEngine } from "../../services/api/src/engine";
import { analyze } from "../../services/api/src/pipeline/analyze";
import { createSwastikEngine } from "./swastik-bridge";

const LOCAL = 31337;
const wallet = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const attacker = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const pUSD = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address;
const pNFT = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as Address;
const drainer = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ABI = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)", "function setApprovalForAll(address,bool)", "function claim(address)"]);

const tx = (id: string, to: Address, data: Hex, origin = "https://claim-rewards.example", chainId = LOCAL, from = wallet): AnalyzeRequest => ({
  requestId: id, origin, chainId, account: from, method: "eth_sendTransaction", params: [{ from, to, data }],
});
const permit = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
    Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
  },
  primaryType: "Permit",
  domain: { name: "Phantom USD", version: "1", chainId: LOCAL, verifyingContract: pUSD },
  message: { owner: wallet, spender: attacker, value: maxUint256.toString(), nonce: "0", deadline: "99999999999" },
};

const scenarios: [string, AnalyzeRequest][] = [
  ["benign transfer 10 pUSD", tx("c1", pUSD, encodeFunctionData({ abi: ABI, functionName: "transfer", args: [attacker, parseEther("10")] }))],
  ["unlimited pUSD approval → attacker", tx("c2", pUSD, encodeFunctionData({ abi: ABI, functionName: "approve", args: [attacker, maxUint256] }))],
  ["setApprovalForAll(attacker) on pNFT", tx("c3", pNFT, encodeFunctionData({ abi: ABI, functionName: "setApprovalForAll", args: [attacker, true] }))],
  ["misleading claim() drains stale approval", tx("c4", drainer, encodeFunctionData({ abi: ABI, functionName: "claim", args: [pUSD] }))],
  ["unsigned ERC-2612 permit → attacker", { requestId: "c5", origin: "https://claim-rewards.example", chainId: LOCAL, account: wallet, method: "eth_signTypedData_v4", params: [wallet, JSON.stringify(permit)] }],
  ["benign transfer from a documented phishing domain", tx("c6", pUSD, encodeFunctionData({ abi: ABI, functionName: "transfer", args: [attacker, parseEther("1")] }), "https://uniswap-airdrop-claim.com")],
  ["MAINNET: approve(Inferno Drainer, 1000 USDC) from Binance 14", tx("c7", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", encodeFunctionData({ abi: ABI, functionName: "approve", args: [getAddress("0x0000db5c8b030ae5034102f866416f8b25530182"), 1_000_000_000n] }), "https://app.example", 1, "0x28C6c06298d514Db089934071355E5743bf21d60")],
  ["personal_sign plain text", { requestId: "c8", origin: "https://app.example", chainId: LOCAL, account: wallet, method: "personal_sign", params: ["0x48656c6c6f", wallet] }],
];

const chains = [
  { chainId: LOCAL, name: "Local demo chain", rpcUrl: "http://127.0.0.1:8545", blockLag: 0 },
  // Keyless public upstreams with fallbacks, or whatever RPC_URL_1 configures.
  ...chainsFromEnv({ ...process.env, SIM_CHAINS: "1" }),
];
const simulator = new Simulator({ chains });
const engines = { baseline: baselineEngine, swastik: createSwastikEngine({ chains }) };

const short = (r: AnalysisReport) => `${r.status}/${r.severity.toUpperCase().padEnd(8)} ${r.summary}`;
try {
  for (const [label, req] of scenarios) {
    console.log(`\n### ${label}`);
    for (const [name, engine] of Object.entries(engines)) {
      const r = await analyze(req, { simulator, engine, timeoutMs: 90_000 });
      console.log(`  ${name.padEnd(9)} ${short(r)}`);
      for (const f of r.findings) console.log(`             [${f.severity}] ${f.ruleId}: ${f.title}`);
    }
  }
} finally {
  await simulator.close();
}
