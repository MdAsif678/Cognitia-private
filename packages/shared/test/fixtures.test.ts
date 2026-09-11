import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnalysisReportSchema, AnalyzeRequestSchema, computeRequestHash, maxSeverity } from "../src";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("sample reports", () => {
  it("exist for benign, malicious and failed cases", () => {
    expect(files).toEqual(expect.arrayContaining(["benign-transfer.json", "malicious-nft-approval.json", "failed-analysis.json"]));
  });

  for (const file of files) {
    it(`${file} matches the shared schemas and its request hash`, () => {
      const { request, report } = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const req = AnalyzeRequestSchema.parse(request);
      const rep = AnalysisReportSchema.parse(report);
      expect(rep.requestHash).toBe(computeRequestHash(req));
      expect(rep.requestId).toBe(req.requestId);
      if (rep.status !== "complete") expect(rep.severity).not.toBe("low");
    });
  }
});

describe("maxSeverity", () => {
  it("ranks unknown above low but below medium", () => {
    expect(maxSeverity(["low", "unknown"])).toBe("unknown");
    expect(maxSeverity(["unknown", "medium"])).toBe("medium");
    expect(maxSeverity([], "unknown")).toBe("unknown");
  });
});
