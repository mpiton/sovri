// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { describe, expect, it } from "vitest";

import { runReview } from "./orchestrator.js";

describe("runReview", () => {
  it("sends pull request metadata and diff content through the prompt builder", async () => {
    let capturedUserPrompt: string | undefined;
    const provider: LLMProvider = {
      name: "test-provider",
      model: "test-model",
      maxTokens: 2048,
      async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
        capturedUserPrompt = params.userPrompt;

        return params.schema.parse({
          summary: "Reviewed one pull request.",
          findings: [],
          walkthrough_markdown: "No findings.",
        });
      },
    };

    await runReview(
      {
        unifiedDiff: `diff --git a/src/payments.ts b/src/payments.ts
@@ -1,2 +1,3 @@
 export const status = "pending";
+export const reviewed = true;`,
        pullRequest: {
          number: 42,
          repoFullName: "acme/payments",
          title: "Add payment validation",
          description: "Reject invalid card state",
        },
      },
      { provider },
    );

    expect(capturedUserPrompt).toContain("Add payment validation");
    expect(capturedUserPrompt).toContain("Reject invalid card state");
    expect(capturedUserPrompt).toContain("src/payments.ts");
    expect(capturedUserPrompt).toContain("export const reviewed = true");
    expect(capturedUserPrompt).toContain("```diff");
  });
});
