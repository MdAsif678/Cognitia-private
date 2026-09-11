/**
 * Regenerates packages/shared/fixtures/*.json from real pipeline runs against a local chain,
 * so the extension can be built against realistic reports without the backend running.
 *   npm run fixtures -w @cognitia/api
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, maxUint256, parseEther, type Hex } from "viem";
import { AnalysisReportSchema, type AnalyzeRequest } from "@cognitia/shared";
import { Simulator } from "@cognitia/simulator";
import { ATTACKER, FRIEND, startUpstream } from "@cognitia/simulator/testing";
import { baselineEngine } from "../src/engine";
import { analyze } from "../src/pipeline/analyze";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "shared", "fixtures");
mkdirSync(out, { recursive: true });

const up = await startUpstream();
const chains = [{ chainId: 31337, name: "Local demo chain", rpcUrl: up.url, blockLag: 0 }];
const simulator = new Simulator({ chains });
const deps = { simulator, engine: baselineEngine, timeoutMs: 60_000 };
const call = (abi: string, fn: string, args: unknown[] = []) => encodeFunctionData({ abi: up.abis[abi]!, functionName: fn, args });
const tx = (id: string, to: Hex, data: Hex): AnalyzeRequest => ({
  requestId: id,
  origin: "https://claim-rewards.example",
  chainId: 31337,
  account: up.victim,
  method: "eth_sendTransaction",
  params: [{ from: up.victim, to, data }],
});

const permit = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  domain: { name: "Test USD", version: "1", chainId: 31337, verifyingContract: up.addresses.token },
  message: { owner: up.victim, spender: ATTACKER, value: maxUint256.toString(), nonce: "0", deadline: "99999999999" },
};

const cases: Record<string, AnalyzeRequest> = {
  "benign-transfer": tx("fixture-benign", up.addresses.token, call("TestERC20", "transfer", [FRIEND, parseEther("25")])),
  "malicious-nft-approval": tx("fixture-nft-approval", up.addresses.nft, call("TestERC721", "setApprovalForAll", [ATTACKER, true])),
  "unlimited-erc20-approval": tx("fixture-unlimited-approval", up.addresses.token, call("TestERC20", "approve", [ATTACKER, maxUint256])),
  "hidden-drain-claim": tx("fixture-claim-drain", up.addresses.drainer, call("TestDrainer", "claim", [up.addresses.token])),
  "reverting-claim": tx("fixture-revert", up.addresses.drainer, call("TestDrainer", "claimClosed")),
  "permit-signature": {
    requestId: "fixture-permit",
    origin: "https://claim-rewards.example",
    chainId: 31337,
    account: up.victim,
    method: "eth_signTypedData_v4",
    params: [up.victim, JSON.stringify(permit)],
  },
  "failed-analysis": { ...tx("fixture-failed", up.addresses.token, "0x"), chainId: 424242 },
};

try {
  for (const [name, request] of Object.entries(cases)) {
    const report = AnalysisReportSchema.parse(await analyze(request, deps));
    writeFileSync(join(out, `${name}.json`), `${JSON.stringify({ request, report }, null, 2)}\n`);
    console.log(`${name.padEnd(26)} ${report.status.padEnd(9)} ${report.severity.padEnd(8)} ${report.summary}`);
  }
} finally {
  await simulator.close();
  up.stop();
}
