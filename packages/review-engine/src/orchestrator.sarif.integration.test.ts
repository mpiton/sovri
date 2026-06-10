// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Integration test: SARIF reports flow through reviewPullRequest end to end —
// ingested, merged with the LLM findings (deduped, changed-files gated), surfaced
// in the walkthrough with the SARIF badge, and flipped onto the license-scan
// check. Closes the gap where the SARIF engine existed but was never wired into
// the review pipeline (MAT-6 DoD: dedup vs LLM + inject into walkthrough/Checks).

import type { Category, Diff, PullRequest, Severity } from "@sovri/core";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "@sovri/llm-providers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reviewPullRequest } from "./orchestrator.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const COMMIT_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const REVIEWED_FILE = "src/payments/charge.ts";

const pullRequest: PullRequest = {
  number: 4242,
  repo_full_name: "acme-corp/payments",
  head_sha: COMMIT_SHA,
  head_ref: "feature/charge",
  base_sha: "0000000000000000000000000000000000000000",
  base_ref: "main",
  author: "engineer",
  draft: false,
  title: "Charge endpoint",
  body: "Add charge handler.",
  additions: 10,
  deletions: 2,
  changed_files: 1,
};

const config = {
  review: { severityThreshold: "nitpick" as Severity },
  ignores: [] as readonly string[],
  limits: { maxFilesPerReview: 50, maxLinesPerReview: 5000 },
};

const diff: Diff = buildDiff();

interface RawFindingFixture {
  readonly severity: Severity;
  readonly category: Category;
  readonly file: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly title: string;
  readonly body: string;
  readonly recommendation: string;
  readonly confidence: number;
  readonly cwe?: string;
}

function llmFinding(overrides: Partial<RawFindingFixture> = {}): RawFindingFixture {
  return {
    severity: "major",
    category: "bug",
    file: REVIEWED_FILE,
    line_start: 12,
    line_end: 12,
    title: "Missing validation",
    body: "The charge amount is used without validation.",
    recommendation: "Validate the charge amount before processing.",
    confidence: 0.9,
    ...overrides,
  };
}

class FindingsProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;

  constructor(private readonly findings: readonly RawFindingFixture[]) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return (await this.generateStructuredWithUsage(params)).data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    return {
      data: params.schema.parse({
        summary: "Charge review.",
        findings: this.findings,
        walkthrough_markdown: "## Sovri review\n\nCharge review.",
      }),
      tokenUsage: { prompt: 812, completion: 144 },
    };
  }
}

function sarifResult(uri: string, startLine: number, endLine = startLine): Record<string, unknown> {
  return {
    ruleId: "rule-1",
    ruleIndex: 0,
    level: "error",
    message: { text: "Tainted input reaches a SQL sink." },
    locations: [
      { physicalLocation: { artifactLocation: { uri }, region: { startLine, endLine } } },
    ],
  };
}

function sarifReport(results: readonly unknown[], cwe = "CWE-89"): string {
  return JSON.stringify({
    version: "2.1.0",
    runs: [
      { tool: { driver: { rules: [{ id: "rule-1", properties: { cwe: [cwe] } }] } }, results },
    ],
  });
}

function licenseScanConclusion(
  descriptors: readonly { readonly name: string; readonly conclusion: string }[],
): string | undefined {
  return descriptors.find((descriptor) => descriptor.name === "Sovri / license-scan")?.conclusion;
}

describe("reviewPullRequest — SARIF ingestion", () => {
  it("merges SARIF findings into the review, badges the walkthrough, and flips the license-scan check", async () => {
    const provider = new FindingsProvider([llmFinding()]);
    const report = sarifReport([sarifResult(REVIEWED_FILE, 20)]);

    const review = await reviewPullRequest(
      { pullRequest, diff, config, sarifReports: [report] },
      { provider },
    );

    expect(review.findings).toHaveLength(2);
    expect(review.findings.some((finding) => finding.source === "sarif")).toBe(true);
    const sarif = review.findings.find((finding) => finding.source === "sarif");
    expect(sarif?.cwe).toBe("CWE-89");
    expect(review.walkthrough_markdown).toContain("`SARIF`");
    expect(licenseScanConclusion(review.check_run_descriptors)).toBe("success");
  });

  it("dedupes a SARIF finding that collides with an LLM finding (LLM wins)", async () => {
    const provider = new FindingsProvider([llmFinding({ cwe: "CWE-89" })]);
    const report = sarifReport([sarifResult(REVIEWED_FILE, 12)]);

    const review = await reviewPullRequest(
      { pullRequest, diff, config, sarifReports: [report] },
      { provider },
    );

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]?.source).toBe("llm");
  });

  it("drops a SARIF finding whose file is not in the diff", async () => {
    const provider = new FindingsProvider([llmFinding()]);
    const report = sarifReport([sarifResult("src/unrelated.ts", 5)]);

    const review = await reviewPullRequest(
      { pullRequest, diff, config, sarifReports: [report] },
      { provider },
    );

    expect(review.findings).toHaveLength(1);
    expect(review.findings.some((finding) => finding.source === "sarif")).toBe(false);
  });

  it("skips a corrupt SARIF report without failing the review, still ingesting valid siblings", async () => {
    const provider = new FindingsProvider([llmFinding()]);
    const valid = sarifReport([sarifResult(REVIEWED_FILE, 20)]);

    const review = await reviewPullRequest(
      { pullRequest, diff, config, sarifReports: ["}{ not json", valid] },
      { provider },
    );

    expect(review.status).not.toBe("failed");
    expect(review.findings.some((finding) => finding.source === "sarif")).toBe(true);
  });

  it("leaves the LLM-only path unchanged when no SARIF reports are supplied", async () => {
    const provider = new FindingsProvider([llmFinding()]);

    const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]?.source).toBe("llm");
    expect(licenseScanConclusion(review.check_run_descriptors)).toBe("neutral");
  });
});

function buildDiff(): Diff {
  const unified = `diff --git a/${REVIEWED_FILE} b/${REVIEWED_FILE}
index 1111111..2222222 100644
--- a/${REVIEWED_FILE}
+++ b/${REVIEWED_FILE}
@@ -10,2 +20,3 @@ export function charge()
 export function charge() {
+  const amount = req.body.amount;
 }
`;

  return {
    unified_diff: unified,
    files: [
      {
        path: REVIEWED_FILE,
        status: "modified",
        additions: 1,
        deletions: 0,
        sha: "cccccccccccccccccccccccccccccccccccccccc",
        patch: "@@ -10,2 +20,3 @@\n const amount = req.body.amount;",
        hunks: [
          {
            old_start: 10,
            old_lines: 2,
            new_start: 12,
            new_lines: 12,
            header: "@@ -10,2 +20,3 @@ export function charge()",
            lines: [" export function charge() {", "+  const amount = req.body.amount;", " }"],
          },
        ],
      },
    ],
  };
}
