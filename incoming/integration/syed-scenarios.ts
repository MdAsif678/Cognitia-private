/**
 * Every button on Syed's demo site (incoming/ps2-project/demo), sent through the analysis pipeline
 * with the EXACT calldata from HANDOFF_TO_TEAM.md, against his real contracts on the local chain.
 *   npx tsx incoming/integration/syed-scenarios.ts [--engine baseline|swastik|both] [--full]
 * Addresses come from incoming/integration/syed-local.json (written by the deploy step).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { maxUint256, type Address } from "viem";
import type { AnalysisReport, AnalyzeRequest } from "@cognitia/shared";
import { Simulator } from "@cognitia/simulator";
import { baselineEngine } from "../../services/api/src/engine";
import { analyze } from "../../services/api/src/pipeline/analyze";
import { createSwastikEngine } from "./swastik-bridge";

const { values: a } = parseArgs({ options: { engine: { type: "string", default: "both" }, full: { type: "boolean" } } });
const d = JSON.parse(readFileSync(join(import.meta.dirname, "syed-local.json"), "utf8")) as Record<string, string> & { chainId: number };
const chainId = d.chainId;
const wallet = d.testWallet as Address;
const origin = "https://aurarewards.example";

const tx = (id: string, to: string, data: string): AnalyzeRequest => ({
  requestId: id, origin, chainId, account: wallet, method: "eth_sendTransaction", params: [{ from: wallet, to, data, value: "0x0" }],
});

// Calldata copied verbatim from HANDOFF_TO_TEAM.md (attacker/friend addresses are fixed Anvil accounts).
const CALLDATA = {
  approveUnlimited: "0x095ea7b300000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  setApprovalForAll: "0xa22cb46500000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000001",
  claim: "0x4e71d92d",
  transfer10: "0xa9059cbb0000000000000000000000009965507d1a55bcc2695c58ba16fb37d819b0a4df0000000000000000000000000000000000000000000000008ac7230489e80000",
  revoke: "0x095ea7b300000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000000",
};
const permit = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
    Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
  },
  primaryType: "Permit",
  domain: { name: "PS2 Test USD", version: "1", chainId, verifyingContract: d.testToken },
  message: { owner: wallet, spender: d.attacker, value: maxUint256.toString(), nonce: 0, deadline: Math.floor(Date.now() / 1000) + 3600 },
};

const buttons: [string, string, AnalyzeRequest][] = [
  ["1 Claim 500 pUSD Airdrop", "HIGH", tx("b1", d.testToken, CALLDATA.approveUnlimited)],
  ["2 Mint Cyber NFT", "HIGH", tx("b2", d.testNFT, CALLDATA.setApprovalForAll)],
  ["3 Claim Staking Yield (claim())", "HIGH/CRITICAL", tx("b3", d.fakeRewardsDrainer, CALLDATA.claim)],
  ["4 Sign Gasless Voucher (permit)", "HIGH", { requestId: "b4", origin, chainId, account: wallet, method: "eth_signTypedData_v4", params: [wallet, JSON.stringify(permit)] }],
  ["5 Claim Event Badges (ERC-1155)", "HIGH", tx("b5", d.testERC1155, CALLDATA.setApprovalForAll)],
  ["6 Send 10 pUSD (Safe)", "LOW", tx("b6", d.testToken, CALLDATA.transfer10)],
  ["7 Revoke Allowance", "LOW", tx("b7", d.testToken, CALLDATA.revoke)],
];

const chains = [{ chainId, name: "Syed's local chain", rpcUrl: d.rpcUrl, blockLag: 0 }];
const simulator = new Simulator({ chains });
const engines: Record<string, typeof baselineEngine> = {};
if (a.engine !== "swastik") engines.baseline = baselineEngine;
if (a.engine !== "baseline") engines.swastik = createSwastikEngine({ chains });

const line = (c: AnalysisReport["immediateChanges"][number]) => `${c.type} ${c.asset ?? ""}${"account" in c ? ` ${c.account.slice(0, 8)}…` : ""}${c.spender ? ` spender=${c.spender.slice(0, 8)}…` : ""}${c.from && c.to ? ` ${c.from.slice(0, 8)}…→${c.to.slice(0, 8)}…` : ""}${c.amount ? ` ${c.amount}` : ""}`;
let mismatches = 0;
try {
  for (const [label, expected, req] of buttons) {
    console.log(`\n### Button ${label}   (Syed expects ${expected})`);
    for (const [name, engine] of Object.entries(engines)) {
      const r = await analyze(req, { simulator, engine, timeoutMs: 90_000 });
      const ok = expected.split("/").some((e) => e.toLowerCase() === r.severity) || (expected === "LOW" && r.severity === "low");
      if (!ok) mismatches++;
      console.log(`  ${name.padEnd(9)} ${ok ? "✓" : "✗"} ${r.status}/${r.severity.toUpperCase().padEnd(8)} ${r.summary}  [${r.durationMs}ms, block #${r.fork?.blockNumber}]`);
      for (const f of r.findings) console.log(`              [${f.severity}] ${f.title}`);
      if (name === "baseline") {
        if (r.immediateChanges.length) console.log("              immediate:   " + r.immediateChanges.map(line).join(" | "));
        if (r.conditionalChanges.length) console.log("              conditional: " + r.conditionalChanges.map(line).join(" | "));
      }
      if (a.full) console.log(JSON.stringify(r, null, 2));
    }
  }
  console.log(`\n${mismatches === 0 ? "All verdicts match Syed's expected severities." : `${mismatches} verdict(s) differ from Syed's expectations.`}`);
} finally {
  await simulator.close();
}
