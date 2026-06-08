// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { PullRequest } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { describe, expect, it, vi } from "vitest";

import { parseUnifiedDiff } from "./diff/index.js";
import { reviewPullRequest } from "./orchestrator.js";

// Acceptance test for: "Compliance enrichment failure degrades the finding but
// the review still succeeds" (issue #1912, R-07). The scenario explicitly
// describes the stub ("compliance enrichment throws an unexpected error"), so
// mocking @sovri/compliance is permitted.
vi.mock("@sovri/compliance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sovri/compliance")>();

  return {
    ...actual,
    enrichFindingCompliance: (): never => {
      throw new Error("compliance map unavailable");
    },
  };
});

const unifiedDiff = `diff --git a/packages/review-engine/src/orchestrator.ts b/packages/review-engine/src/orchestrator.ts
index 1111111..2222222 100644
--- a/packages/review-engine/src/orchestrator.ts
+++ b/packages/review-engine/src/orchestrator.ts
@@ -40,3 +40,3 @@ export async function reviewPullRequest()
 const startedAt = new Date();
-const review = await runReview(input, options);
+const review = await generateParsedProviderReview(options.provider, params);
 return review;
`;

const pullRequest: PullRequest = {
  number: 38,
  repo_full_name: "mpiton/sovri",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_ref: "feature/review-orchestrator",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  base_ref: "main",
  author: "maintainer",
  draft: false,
  title: "Implement orchestrator TypeScript review",
  body: "Wire parsing, filtering, and review output.",
  additions: 1,
  deletions: 1,
  changed_files: 1,
};

const config = {
  review: { severityThreshold: "nitpick" as const },
  ignores: [] as readonly string[],
  limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
};

const provider: LLMProvider = {
  name: "compliance-failure-provider",
  model: "test-model",
  maxTokens: 2048,
  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return params.schema.parse({
      summary: "Compliance review.",
      findings: [
        {
          severity: "major",
          category: "security",
          file: "packages/review-engine/src/orchestrator.ts",
          line_start: 42,
          line_end: 42,
          title: "Hardcoded credential",
          body: "Avoid hardcoding credentials in source.",
          recommendation:
            "Move the credential to an environment variable or a secrets manager instead of hardcoding it.",
          confidence: 0.9,
          cwe: "CWE-798",
        },
      ],
      walkthrough_markdown: "## Sovri review\n\nCompliance review.",
    });
  },
};

describe("reviewPullRequest compliance enrichment failure", () => {
  // Rule: R-07
  it("degrades the finding and logs when compliance enrichment throws", async () => {
    const errorLogs: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const logger = {
      info(): void {},
      error(fields: Record<string, unknown>, message: string): void {
        errorLogs.push({ fields, message });
      },
    };

    // Given compliance enrichment throws an unexpected error for any finding
    // And the LLM provider returns one "major" finding for category "security" with cwe "CWE-798"
    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff: parseUnifiedDiff(unifiedDiff), config },
      { provider, logger },
    );

    // Then the returned Review status is "success"
    expect(review.status).toBe("success");
    const finding = review.findings.at(0);
    // And that finding's audit_reference is defined
    expect(finding?.audit_reference).toBeDefined();
    // And that finding's compliance_references is empty
    expect(finding?.compliance_references).toEqual([]);
    // And an error is logged describing the enrichment failure
    expect(errorLogs.some(({ message }) => message.includes("Compliance enrichment failed"))).toBe(
      true,
    );
  });
});
