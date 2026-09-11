// Does every report my backend produces pass Atif's extension-side Zod contract?
//   npx tsx incoming/integration/contract-check.ts [http://localhost:8080]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAnalysisReport } from "../atif-extension/src/shared/api-contract";
import { mapReportToAnalysisResult } from "../atif-extension/src/background/analyzer";

const dir = join(import.meta.dirname, "..", "..", "packages", "shared", "fixtures");
let failures = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const { report } = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const parsed = parseAnalysisReport(report);
  if (parsed.success) {
    const ui = mapReportToAnalysisResult(parsed.report, report.requestId);
    console.log(`PASS ${file.padEnd(32)} -> UI status=${ui.status} severity=${ui.severity} warnings=${ui.warnings.length}`);
  } else {
    failures++;
    console.log(`FAIL ${file.padEnd(32)} ${parsed.error}`);
  }
}

const base = process.argv[2];
if (base) {
  // Live Sepolia: unlimited USDC approval from a real holder to the demo attacker address.
  const live = {
    requestId: "contract-check-live",
    origin: "https://claim-rewards.example",
    chainId: 11155111,
    account: "0xd46F94e12cfbdf39103617bf29Be11daf78E9ad3",
    method: "eth_sendTransaction",
    params: [{ from: "0xd46F94e12cfbdf39103617bf29Be11daf78E9ad3", to: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", data: "0x095ea7b300000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }],
  };
  const res = await fetch(`${base}/v1/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(live) });
  const parsed = parseAnalysisReport(await res.json());
  console.log(parsed.success ? `PASS live /v1/analyze -> ${parsed.report.severity}: ${parsed.report.summary}` : `FAIL live /v1/analyze ${parsed.error}`);
  if (!parsed.success) failures++;
}
process.exit(failures ? 1 : 0);
