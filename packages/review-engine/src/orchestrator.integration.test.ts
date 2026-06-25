// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { ReviewSchema, z, type Diff, type PullRequest } from "@sovri/core";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "@sovri/llm-providers";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { server } from "../../../tests/msw/server.js";
import { parseUnifiedDiff } from "./diff/index.js";
import { reviewPullRequest } from "./orchestrator.js";
import { buildInlineComments, composeWalkthrough } from "./walkthrough/index.js";

const ProviderUrl = "https://llm.test/v1/messages";

const TokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

class RetryableProviderError extends Error {
  public override readonly name = "RetryableProviderError";
  public readonly retryableWithCorrectivePrompt = true;
  public readonly tokenUsage = { prompt: 7, completion: 3 };
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => server.resetHandlers());

afterAll(() => server.close());

describe("reviewPullRequest MSW integration paths", () => {
  it("returns a successful Review with walkthrough and inline comments on the happy path", async () => {
    let observedProviderRequests = 0;
    server.use(
      http.post(ProviderUrl, () => {
        observedProviderRequests += 1;

        return HttpResponse.json({
          data: {
            summary: "Review completed.",
            findings: [
              {
                severity: "major",
                category: "bug",
                file: "packages/review-engine/src/orchestrator.ts",
                line_start: 42,
                line_end: 42,
                title: "Missing error guard",
                body: "Guard this path before returning the review.",
                recommendation:
                  "Add an error guard before returning the review to handle missing or invalid results.",
                suggested_code: "const review = await runReview(input, options);",
                confidence: 0.91,
                // CWE-20 maps to a framework, so the finding clears the compliance-only publication
                // gate and the walkthrough + inline-comment assertions still see a published finding.
                cwe: "CWE-20",
              },
            ],
            walkthrough_markdown: "## Sovri review\n\nReview completed.",
          },
          tokenUsage: { prompt: 812, completion: 144 },
        });
      }),
    );
    const provider = createHttpProvider();
    const diff = parseUnifiedDiff(unifiedDiff);

    // Given MSW returns a valid provider response with summary "Review completed."
    // And MSW returns one "major" finding on line 42
    // And MSW returns 812 prompt tokens and 144 completion tokens
    // When the integration test calls `reviewPullRequest`
    const review = await reviewPullRequest(
      {
        pullRequest,
        diff,
        config: {
          review: { severityThreshold: "major" },
          ignores: [],
          limits: {
            maxFilesPerReview: 5,
            maxLinesPerReview: 50,
          },
        },
      },
      { provider },
    );

    // Then exactly 1 provider request is observed by MSW
    expect(observedProviderRequests).toBe(1);
    // And the returned Review status is "success"
    expect(review.status).toBe("success");
    // And the returned Review contains 1 finding
    expect(review.findings).toHaveLength(1);
    // And the returned finding carries a deterministic committable suggestion
    expect(review.findings[0]?.suggestion).toEqual({
      code: "const review = await runReview(input, options);",
      committable: true,
    });
    // And the returned Review has non-empty `walkthrough_markdown`
    expect(review.walkthrough_markdown.length).toBeGreaterThan(0);

    // And deriving inline comments from the returned Review findings and parsed diff produces 1 inline comment draft
    const inlineComments = buildInlineComments(review.findings, diff);
    expect(inlineComments).toHaveLength(1);
    // And the inline comment draft path is "packages/review-engine/src/orchestrator.ts"
    // And the inline comment draft line is 42
    expect(inlineComments).toEqual([
      expect.objectContaining({
        path: "packages/review-engine/src/orchestrator.ts",
        line: 42,
      }),
    ]);
    // And the inline body renders the provider suggested_code as a GitHub suggestion block
    expect(inlineComments[0]?.body).toContain(
      ["```suggestion", "const review = await runReview(input, options);", "```"].join("\n"),
    );
  });

  it("retries a schema-invalid first response and returns a partial Review", async () => {
    let observedProviderRequests = 0;
    server.use(
      http.post(ProviderUrl, () => {
        observedProviderRequests += 1;

        if (observedProviderRequests === 1) {
          return HttpResponse.json({
            data: {
              summary: 42,
              findings: [],
              walkthrough_markdown: "## Sovri review\n\nInvalid review.",
            },
            tokenUsage: { prompt: 600, completion: 120 },
          });
        }

        return HttpResponse.json({
          data: {
            summary: "Corrected review.",
            findings: [],
            walkthrough_markdown: "## Sovri review\n\nCorrected review.",
          },
          tokenUsage: { prompt: 300, completion: 80 },
        });
      }),
    );
    const provider = createHttpProvider();
    const diff = parseUnifiedDiff(unifiedDiff);

    // Given MSW first returns schema-invalid provider JSON
    // And MSW then returns a valid provider response with summary "Corrected review."
    // And MSW returns total usage of 900 prompt tokens and 200 completion tokens
    // When the integration test calls `reviewPullRequest`
    const review = await reviewPullRequest(
      {
        pullRequest,
        diff,
        config: {
          review: { severityThreshold: "major" },
          ignores: [],
          limits: {
            maxFilesPerReview: 5,
            maxLinesPerReview: 50,
          },
        },
      },
      { provider },
    );

    // Then exactly 2 provider requests are observed by MSW
    expect(observedProviderRequests).toBe(2);
    // And the returned Review status is "partial"
    expect(review.status).toBe("partial");
    // And the returned Review error is absent
    expect(review.error).toBeUndefined();
    // And no returned finding is titled "review_failed"
    expect(review.findings.some((finding) => finding.title === "review_failed")).toBe(false);
    // And the returned Review `tokens_used.prompt` is 900
    expect(review.tokens_used.prompt).toBe(900);
  });

  it("emits the parse fallback Review after repeated schema-invalid responses", async () => {
    let observedProviderRequests = 0;
    server.use(
      http.post(ProviderUrl, () => {
        observedProviderRequests += 1;

        return HttpResponse.json({
          data: {
            summary: 42,
            findings: [],
            walkthrough_markdown: "## Sovri review\n\nInvalid review.",
          },
          tokenUsage: { prompt: 300, completion: 80 },
        });
      }),
    );
    const provider = createHttpProvider();
    const diff = deletedFileDiff;

    // Given MSW first returns schema-invalid provider JSON
    // And MSW then returns schema-invalid provider JSON again
    // When the integration test calls `reviewPullRequest`
    const review = await reviewPullRequest(
      {
        pullRequest,
        diff,
        config: {
          review: { severityThreshold: "major" },
          ignores: [],
          limits: {
            maxFilesPerReview: 5,
            maxLinesPerReview: 50,
          },
        },
      },
      { provider },
    );

    // Then exactly 2 provider requests are observed by MSW
    expect(observedProviderRequests).toBe(2);
    // And the returned Review validates against `ReviewSchema`
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    // And the returned Review status is "failed"
    expect(review.status).toBe("failed");
    // And the returned Review error contains "could not parse"
    expect(review.error).toContain("could not parse");
    // And the returned Review findings contain a synthetic finding titled "review_failed"
    expect(review.findings).toEqual([
      expect.objectContaining({
        line_end: 1,
        line_start: 1,
        title: "review_failed",
      }),
    ]);
    // And no unhandled network request is observed by MSW
    expect(observedProviderRequests).toBe(2);
  });

  it("truncates parse fallback finding body when retryable provider errors are long", async () => {
    let observedProviderAttempts = 0;
    const provider: LLMProvider = {
      name: "long-error-provider",
      model: "test-model",
      maxTokens: 2048,
      async generateStructured<T>(): Promise<T> {
        observedProviderAttempts += 1;

        throw new RetryableProviderError("x".repeat(3_000));
      },
    };

    // Given the provider fails twice with a retryable error longer than the finding body limit
    // When the integration test calls `reviewPullRequest`
    const review = await reviewPullRequest(
      {
        pullRequest,
        diff: deletedFileDiff,
        config: {
          review: { severityThreshold: "major" },
          ignores: [],
          limits: {
            maxFilesPerReview: 5,
            maxLinesPerReview: 50,
          },
        },
      },
      { provider },
    );

    // Then exactly 2 provider attempts are observed
    expect(observedProviderAttempts).toBe(2);
    // And the returned Review status is "failed"
    expect(review.status).toBe("failed");
    // And the synthetic finding body stays within the schema limit
    const finding = review.findings.at(0);
    expect(finding).toEqual(expect.objectContaining({ title: "review_failed" }));
    expect(finding?.body.length).toBe(2_000);
  });
});

const mockProviderFindings = (findings: readonly unknown[]): void => {
  server.use(
    http.post(ProviderUrl, () =>
      HttpResponse.json({
        data: {
          summary: "Compliance review.",
          findings,
          walkthrough_markdown: "## Sovri review\n\nCompliance review.",
        },
        tokenUsage: { prompt: 100, completion: 20 },
      }),
    ),
  );
};

const findingFor = (cwe: string | undefined, category: string, severity: string) => ({
  severity,
  category,
  file: "packages/review-engine/src/orchestrator.ts",
  line_start: 42,
  line_end: 42,
  title: "Finding title",
  body: "Finding body.",
  recommendation: "Review the finding and apply the appropriate fix.",
  confidence: 0.9,
  ...(cwe === undefined ? {} : { cwe }),
});

// Acceptance test for: "Orchestrator wires compliance enrichment and audit
// references into findings" (issue #1912). Rules R-03 (every LLM-derived finding
// carries a defined audit_reference), R-04 (compliance_references populated from
// the CWE map or empty), R-06 (cwe propagated then enriched). R-07 (enrichment
// failure degrades the finding) is covered in orchestrator.compliance-failure.test.ts.
describe("reviewPullRequest compliance enrichment", () => {
  const config = {
    review: { severityThreshold: "nitpick" as const },
    ignores: [] as readonly string[],
    limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
  };

  // Rule: R-03, R-04, R-06
  it("gives a finding with a mapped CWE an audit reference and populated compliance references", async () => {
    // Given the LLM provider returns one "major" finding for category "security" with cwe "CWE-798"
    mockProviderFindings([findingFor("CWE-798", "security", "major")]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );

    // Then the returned Review status is "success"
    expect(review.status).toBe("success");
    const finding = review.findings.at(0);
    // And that finding's cwe equals "CWE-798"
    expect(finding?.cwe).toBe("CWE-798");
    // And that finding's audit_reference is defined
    expect(finding?.audit_reference).toBeDefined();
    // And that finding's audit_reference matches "^SOVRI-SC-[A-F0-9]{4}-[A-F0-9]{4}$"
    expect(finding?.audit_reference).toMatch(/^SOVRI-SC-[A-F0-9]{4}-[A-F0-9]{4}$/u);
    // And that finding's compliance_references has at least 4 entries
    expect(finding?.compliance_references.length).toBeGreaterThanOrEqual(4);
    // And that finding's compliance_references include the frameworks GDPR, ISO27001-2022, DORA, NIS2
    const frameworks = (finding?.compliance_references ?? []).map((ref) => ref.framework);
    expect(frameworks).toEqual(expect.arrayContaining(["GDPR", "ISO27001-2022", "DORA", "NIS2"]));
  });

  // Rule: MAT-75 (compliance-only gate drops findings that map to no framework)
  it("drops a finding without a CWE since it maps to no framework", async () => {
    // Given the LLM provider returns one "minor" finding for category "bug" with no cwe
    mockProviderFindings([findingFor(undefined, "bug", "minor")]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );

    // Then the returned Review status is "success"
    expect(review.status).toBe("success");
    // And the finding is withheld: with no mappable CWE it carries no compliance references
    expect(review.findings).toHaveLength(0);
  });

  // Rule: MAT-75 (compliance-only gate drops findings that map to no framework)
  it("drops a finding whose CWE does not resolve to any framework", async () => {
    // Given the LLM provider returns one "major" finding for category "security" with cwe "CWE-9999"
    mockProviderFindings([findingFor("CWE-9999", "security", "major")]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );

    // Then the returned Review status is "success"
    expect(review.status).toBe("success");
    // And the finding is withheld: its CWE resolves to no framework reference
    expect(review.findings).toHaveLength(0);
  });

  // Rule: ADR-021 + MAT-76 — the taxonomy is compliance-only, so a non-compliance category from the
  // model is rejected at the schema boundary rather than published as review noise.
  it("rejects a non-compliance category from the model rather than publishing it (ADR-021)", async () => {
    // Given the LLM provider returns one finding tagged with a generic, now-invalid category
    mockProviderFindings([
      {
        ...findingFor("CWE-89", "maintainability", "minor"),
        confidence: 1,
      },
    ]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );

    // Then the invalid response is rejected: the parse-failure path fails the review and surfaces a
    // synthetic review_failed finding, and every published finding stays within the compliance taxonomy.
    expect(review.status).toBe("failed");
    expect(review.findings.length).toBeGreaterThan(0);
    expect(review.findings.some((finding) => finding.title === "review_failed")).toBe(true);
    for (const finding of review.findings) {
      expect(["security", "bug"]).toContain(finding.category);
    }
  });

  // Rule: ADR-013 (gate: eligible security finding with mapped CWE gets enriched)
  it("populates compliance references for a security finding with a mapped CWE", async () => {
    // Given the LLM provider returns one finding for category "security" with cwe "CWE-89" and confidence 0.9
    mockProviderFindings([
      {
        ...findingFor("CWE-89", "security", "major"),
        confidence: 0.9,
      },
    ]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );

    // Then the returned Review status is "success"
    expect(review.status).toBe("success");
    const finding = review.findings.at(0);
    // And that finding's compliance_references is non-empty (CWE-89 is in the static map)
    expect(finding).toBeDefined();
    expect(finding?.compliance_references.length).toBeGreaterThan(0);
  });

  // Rule: MAT-75 (publish only framework-mapped findings; the retained finding keeps its audit_reference)
  it("publishes only the framework-mapped finding from a mixed batch, keeping its audit reference", async () => {
    // Given the LLM provider returns three findings (mapped cwe, no cwe, unmapped cwe)
    mockProviderFindings([
      findingFor("CWE-798", "security", "blocker"),
      findingFor(undefined, "bug", "major"),
      findingFor("CWE-9999", "security", "minor"),
    ]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When reviewPullRequest runs with the injected provider
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );

    // Then the returned Review status is "success"
    expect(review.status).toBe("success");
    // And only the CWE-798 finding is published; the no-cwe and unmapped-cwe findings are dropped
    expect(review.findings).toHaveLength(1);
    const finding = review.findings.at(0);
    expect(finding?.cwe).toBe("CWE-798");
    // And the retained finding keeps its audit_reference (MAT-75: conserve audit_reference)
    expect(finding?.audit_reference).toBeDefined();
    expect(finding?.audit_reference).toMatch(/^SOVRI-SC-[A-F0-9]{4}-[A-F0-9]{4}$/u);
    // And it carries the mapped framework references
    expect(finding?.compliance_references.length).toBeGreaterThanOrEqual(4);
  });
});

function createHttpProvider(): LLMProvider {
  const model = "test-model";

  return {
    name: "msw-provider",
    model,
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      const generation = await generateHttpStructured(params, model);

      return generation.data;
    },
    async generateStructuredWithUsage<T>(
      params: GenerateStructuredParams<T>,
    ): Promise<StructuredGeneration<T>> {
      return generateHttpStructured(params, model);
    },
  };
}

async function generateHttpStructured<T>(
  params: GenerateStructuredParams<T>,
  model: string,
): Promise<StructuredGeneration<T>> {
  const response = await fetch(ProviderUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      maxTokens: params.maxTokens,
      model,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
    }),
  });
  const body: unknown = await response.json();
  const parsed = createProviderHttpResponseSchema<T>().parse(body);

  return {
    data: parsed.data,
    tokenUsage: parsed.tokenUsage,
  };
}

function createProviderHttpResponseSchema<T>() {
  return z.object({
    data: z.custom<T>(),
    tokenUsage: TokenUsageSchema,
  });
}

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

const deletedFileUnifiedDiff = `diff --git a/packages/review-engine/src/orchestrator.ts b/packages/review-engine/src/orchestrator.ts
deleted file mode 100644
index 1111111..0000000
--- a/packages/review-engine/src/orchestrator.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export function removedReviewPath() {
-}
`;

const deletedFileDiff: Diff = {
  unified_diff: deletedFileUnifiedDiff,
  files: [
    {
      path: "packages/review-engine/src/orchestrator.ts",
      status: "removed",
      additions: 0,
      deletions: 2,
      sha: "cccccccccccccccccccccccccccccccccccccccc",
      patch: "@@ -1,2 +0,0 @@\n-export function removedReviewPath() {\n-}",
      hunks: [
        {
          old_start: 1,
          old_lines: 2,
          new_start: 0,
          new_lines: 0,
          header: "@@ -1,2 +0,0 @@",
          lines: ["-export function removedReviewPath() {", "-}"],
        },
      ],
    },
  ],
};

// Acceptance test for bug-2606 R-01 (scenario sub-issue #2611): a security or bug finding on
// regulated code that maps to a known CWE renders its framework references in the walkthrough
// "Compliance & provenance" section. Drives the real gate + enricher through reviewPullRequest, then
// renders the public walkthrough composer — only the LLM is mocked, at the provider boundary.
describe("reviewPullRequest renders compliance references in the walkthrough (bug-2606 R-01)", () => {
  const config = {
    review: { severityThreshold: "nitpick" as const },
    ignores: [] as readonly string[],
    limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
  };

  // Background: a pull request that adds raw SQL string concatenation against the "users" table in
  // "src/users/repository.ts". The added SQL line is new-file line 11, where the findings anchor.
  const regulatedSqlDiff = `diff --git a/src/users/repository.ts b/src/users/repository.ts
index 1111111..2222222 100644
--- a/src/users/repository.ts
+++ b/src/users/repository.ts
@@ -10,3 +10,3 @@ export class UserRepository {
   async findByEmail(email: string) {
-    return this.db.query(buildParameterizedUserQuery(email));
+    return this.db.query("SELECT * FROM users WHERE email = '" + email + "'");
   }
`;

  const regulatedFinding = (
    cwe: string | undefined,
    category: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    ...findingFor(cwe, category, "major"),
    file: "src/users/repository.ts",
    line_start: 11,
    line_end: 11,
    confidence: 0.9,
    ...overrides,
  });

  // @nominal Scenario: an SQL-injection finding tagged CWE-89 shows its GDPR reference
  it("shows the GDPR and CWE references for a CWE-89 security finding", async () => {
    // Given the configured LLM returns one finding with category "security", cwe "CWE-89", confidence 0.9
    mockProviderFindings([regulatedFinding("CWE-89", "security")]);
    const diff = parseUnifiedDiff(regulatedSqlDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");
    const walkthrough = composeWalkthrough(review);

    // Then the "Compliance & provenance" section lists a "GDPR: Art. 32" reference
    expect(walkthrough).toContain("### Compliance & audit");
    expect(walkthrough).toContain("GDPR: Art. 32");
    // And it also lists the "CWE: CWE-89" reference
    expect(walkthrough).toContain("CWE: CWE-89");
    // And the GDPR line is flagged "applicable if" the system processes personal data
    expect(walkthrough).toMatch(/applicable if:.*personal data/i);
  });

  // @nominal Scenario Outline: every web-injection CWE in the map renders the GDPR duty
  it.each([
    { category: "security", cwe: "CWE-89" },
    { category: "security", cwe: "CWE-79" },
    { category: "bug", cwe: "CWE-89" },
  ])(
    "renders the GDPR Art. 32 duty for a $category finding tagged $cwe",
    async ({ category, cwe }) => {
      // Given the configured LLM returns one finding with category "<category>", cwe "<cwe>", confidence 0.9
      mockProviderFindings([regulatedFinding(cwe, category)]);
      const diff = parseUnifiedDiff(regulatedSqlDiff);

      // When the review runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider: createHttpProvider() },
      );
      expect(review.status).toBe("success");

      // Then the "Compliance & provenance" section lists a "GDPR: Art. 32" reference
      expect(composeWalkthrough(review)).toContain("GDPR: Art. 32");
    },
  );

  // @technical Scenario: references render inside the collapsible compliance section
  it("renders the references under the Compliance & audit heading", async () => {
    // Given the configured LLM returns one finding with category "security", cwe "CWE-89", confidence 0.9
    mockProviderFindings([regulatedFinding("CWE-89", "security")]);
    const diff = parseUnifiedDiff(regulatedSqlDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    const walkthrough = composeWalkthrough(review);

    // Then the walkthrough shows "Potential compliance references" under the "Compliance & audit" heading
    const auditIdx = walkthrough.indexOf("### Compliance & audit");
    const refsIdx = walkthrough.indexOf("Potential compliance references");
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(refsIdx).toBeGreaterThan(auditIdx);
  });

  // @technical Scenario: in a mixed review only the eligible finding is published; the ineligible one
  // is dropped entirely by the compliance-only gate (MAT-75).
  it("publishes only the eligible finding in a mixed review, dropping the ineligible one", async () => {
    // Given the configured LLM returns two findings (security/CWE-89 and bug with an unmapped CWE)
    mockProviderFindings([
      regulatedFinding("CWE-89", "security", { title: "SQL injection in query" }),
      regulatedFinding("CWE-99999", "bug", {
        title: "Inconsistent quotes",
        severity: "minor",
        confidence: 0.95,
      }),
    ]);
    const diff = parseUnifiedDiff(regulatedSqlDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    const walkthrough = composeWalkthrough(review);

    // Then only the SQL-injection finding is published, with its "GDPR: Art. 32" reference
    expect(review.findings).toHaveLength(1);
    const sqlIdx = walkthrough.indexOf("#### SQL injection in query");
    expect(sqlIdx).toBeGreaterThanOrEqual(0);
    expect(walkthrough.slice(sqlIdx)).toContain("GDPR: Art. 32");
    // And the ineligible "Inconsistent quotes" finding is dropped entirely by the compliance-only gate
    expect(walkthrough).not.toContain("#### Inconsistent quotes");
  });
});

// Acceptance test for bug-2606 R-03 (scenario sub-issue #2612): a finding that does not clear the
// gate — non-security/bug category, no mappable CWE, or confidence < 0.7 — renders no framework
// reference. No false regulatory attribution. Drives the real gate + enricher + composer through
// reviewPullRequest with the LLM mocked at the provider boundary.
describe("reviewPullRequest withholds compliance references when the gate is unmet (bug-2606 R-03)", () => {
  const config = {
    review: { severityThreshold: "nitpick" as const },
    ignores: [] as readonly string[],
    limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
  };

  // Note: the pre-pivot "non-eligible category never carries a framework reference" scenarios were
  // removed with the generic categories (ADR-021, MAT-76). A non-compliance category is now rejected
  // at the schema boundary (see parsing/provider-finding-schema-category-required.test.ts), so it can
  // never reach the enrichment gate. The security-category cases below still exercise the gate.

  // @violation Scenario: a security finding with an unmapped CWE carries no framework reference
  it("renders no framework reference for a security finding with an unmapped CWE", async () => {
    // Given the configured LLM returns one finding with category "security", cwe "CWE-99999", confidence 0.9
    mockProviderFindings([{ ...findingFor("CWE-99999", "security", "major"), confidence: 0.9 }]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");

    // Then the "Compliance & provenance" section lists no framework reference for that finding
    const walkthrough = composeWalkthrough(review);
    expect(walkthrough).not.toContain("Potential compliance references");
    expect(walkthrough).not.toContain("GDPR");
  });

  // @limit Scenario Outline: the confidence floor of 0.70 decides enrichment.
  it.each([
    { confidence: 0.7, state: "present" },
    { confidence: 0.69, state: "absent" },
  ])("renders references $state at confidence $confidence", async ({ confidence, state }) => {
    // Given the configured LLM returns one finding with category "security", cwe "CWE-89", confidence <confidence>
    mockProviderFindings([{ ...findingFor("CWE-89", "security", "major"), confidence }]);
    const diff = parseUnifiedDiff(unifiedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");

    // Then the finding's framework references are <state>
    const walkthrough = composeWalkthrough(review);
    if (state === "present") {
      expect(walkthrough).toContain("GDPR: Art. 32");
    } else {
      expect(walkthrough).not.toContain("GDPR");
    }
  });
});

// Acceptance test for feat-2610 R-01 (scenario sub-issue #2616): a security or bug finding the model
// returned with NO cwe, but whose content maps unambiguously to a mapped CWE, surfaces at least one
// informational framework reference derived deterministically from finding signals (category +
// title/body keywords), with no second LLM call. Implements ADR-020. Drives the real gate + enricher
// + walkthrough composer through reviewPullRequest; only the LLM is mocked, at the provider boundary.
describe("reviewPullRequest derives a compliance reference from finding content when CWE omitted (feat-2610 R-01)", () => {
  const config = {
    review: { severityThreshold: "nitpick" as const },
    ignores: [] as readonly string[],
    limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
  };

  // Background: a pull request whose diff touches code that processes personal data — raw SQL string
  // concatenation against the "users" table in "src/users/repository.ts" (added new-file line 11).
  const regulatedDiff = `diff --git a/src/users/repository.ts b/src/users/repository.ts
index 1111111..2222222 100644
--- a/src/users/repository.ts
+++ b/src/users/repository.ts
@@ -10,3 +10,3 @@ export class UserRepository {
   async findByEmail(email: string) {
-    return this.db.query(buildParameterizedUserQuery(email));
+    return this.db.query("SELECT * FROM users WHERE email = '" + email + "'");
   }
`;

  // A finding the model returned with NO cwe field. Its `body` carries the content the scenario
  // describes — the title/body keyword signal the deterministic deriver reads.
  const noCweFinding = (
    category: string,
    content: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    ...findingFor(undefined, category, "major"),
    file: "src/users/repository.ts",
    line_start: 11,
    line_end: 11,
    title: content,
    body: `The finding describes ${content}.`,
    confidence: 0.9,
    ...overrides,
  });

  // @nominal Scenario Outline: a regulated finding with no cwe but unambiguous content derives its reference
  it.each([
    { content: "raw SQL string concatenation against the users table" },
    { content: "unescaped user input rendered into an HTML response" },
  ])("derives GDPR: Art. 32 for a security finding describing $content", async ({ content }) => {
    // Given the configured LLM returns one finding with category "security" and confidence 0.9
    // And the finding carries no cwe field
    // And the finding describes "<content>"
    mockProviderFindings([noCweFinding("security", content)]);
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");

    // Then the "Compliance & provenance" section lists a "GDPR: Art. 32" reference
    expect(composeWalkthrough(review)).toContain("GDPR: Art. 32");
  });

  // @nominal Scenario: a bug-category finding with no cwe derives the same reference as a security one
  it("derives GDPR: Art. 32 for a bug-category finding with no cwe", async () => {
    // Given the configured LLM returns one finding with category "bug" and confidence 0.9
    // And the finding carries no cwe field
    // And the finding describes "raw SQL string concatenation against the users table"
    mockProviderFindings([
      noCweFinding("bug", "raw SQL string concatenation against the users table"),
    ]);
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");

    // Then the "Compliance & provenance" section lists a "GDPR: Art. 32" reference
    expect(composeWalkthrough(review)).toContain("GDPR: Art. 32");
  });

  // @technical Scenario: a derived reference renders informational, never confirmed
  it("flags the derived reference applicable if, never confirmed", async () => {
    // Given the configured LLM returns one finding with category "security" and confidence 0.9
    // And the finding carries no cwe field
    // And the finding describes "raw SQL string concatenation against the users table"
    mockProviderFindings([
      noCweFinding("security", "raw SQL string concatenation against the users table"),
    ]);
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    const walkthrough = composeWalkthrough(review);

    // Then the derived "GDPR: Art. 32" line is flagged "applicable if" the system processes personal data
    expect(walkthrough).toContain("GDPR: Art. 32");
    expect(walkthrough).toMatch(/applicable if:.*personal data/i);
    // And the derived reference is not flagged "confirmed"
    expect(walkthrough).not.toMatch(/confirmed/i);
  });

  // @technical Scenario: derivation adds no second LLM call on the hot path
  it("issues exactly one LLM completion call while emitting the derived reference", async () => {
    // Given the configured LLM returns one finding with category "security" and confidence 0.9
    // And the finding carries no cwe field, describing raw SQL string concatenation against the users table
    let observedProviderRequests = 0;
    server.use(
      http.post(ProviderUrl, () => {
        observedProviderRequests += 1;

        return HttpResponse.json({
          data: {
            summary: "Compliance review.",
            findings: [
              noCweFinding("security", "raw SQL string concatenation against the users table"),
            ],
            walkthrough_markdown: "## Sovri review\n\nCompliance review.",
          },
          tokenUsage: { prompt: 100, completion: 20 },
        });
      }),
    );
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");

    // Then the review issues exactly one LLM completion call
    expect(observedProviderRequests).toBe(1);
    // And the "Compliance & provenance" section lists a "GDPR: Art. 32" reference
    expect(composeWalkthrough(review)).toContain("GDPR: Art. 32");
  });

  // @technical Scenario: in a mixed review derivation fires only on the no-cwe finding whose content maps
  it("attaches the derived reference only to the no-cwe finding whose content maps in a mixed review", async () => {
    // Given the configured LLM returns two findings, each with no cwe field:
    //   | security | 0.9  | raw SQL string concatenation against the users table |
    //   | bug      | 0.95 | inconsistent quote style in the same file            |
    mockProviderFindings([
      noCweFinding("security", "raw SQL string concatenation against the users table", {
        title: "Raw SQL concatenation against users",
      }),
      noCweFinding("bug", "inconsistent quote style in the same file", {
        title: "Inconsistent quote style",
        severity: "minor",
        confidence: 0.95,
      }),
    ]);
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    const walkthrough = composeWalkthrough(review);

    // Then the compliance block for the security finding lists a "GDPR: Art. 32" reference
    const securityIdx = walkthrough.indexOf("#### Raw SQL concatenation against users");
    expect(securityIdx).toBeGreaterThanOrEqual(0);
    expect(walkthrough.slice(securityIdx)).toContain("GDPR: Art. 32");
    // And the non-derivable bug finding is dropped entirely by the compliance-only gate (MAT-75)
    expect(walkthrough).not.toContain("#### Inconsistent quote style");
  });
});

// Acceptance test for feat-2610 R-02 (scenario sub-issue #2617): a finding that already carries a
// model cwe behaves exactly as today. Derivation only fills the no-cwe path; it never overrides or
// alters an existing model CWE (no regression). Drives the real gate + enricher + composer through
// reviewPullRequest with the LLM mocked at the provider boundary.
describe("reviewPullRequest leaves the model-supplied CWE path unchanged (feat-2610 R-02)", () => {
  const config = {
    review: { severityThreshold: "nitpick" as const },
    ignores: [] as readonly string[],
    limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
  };

  // Background: a pull request that adds raw SQL string concatenation against the "users" table in
  // "src/users/repository.ts" — content that WOULD derive CWE-89 on the no-cwe path.
  const regulatedSqlDiff = `diff --git a/src/users/repository.ts b/src/users/repository.ts
index 1111111..2222222 100644
--- a/src/users/repository.ts
+++ b/src/users/repository.ts
@@ -10,3 +10,3 @@ export class UserRepository {
   async findByEmail(email: string) {
-    return this.db.query(buildParameterizedUserQuery(email));
+    return this.db.query("SELECT * FROM users WHERE email = '" + email + "'");
   }
`;

  // A finding the model returned WITH a cwe. Its content would derive CWE-89 on the no-cwe path, so
  // any "CWE: CWE-89" leaking in would prove derivation wrongly overrode the model-supplied cwe.
  const modelCweFinding = (cwe: string | undefined, overrides: Record<string, unknown> = {}) => ({
    ...findingFor(cwe, "security", "major"),
    file: "src/users/repository.ts",
    line_start: 11,
    line_end: 11,
    confidence: 0.9,
    title: "raw SQL string concatenation against the users table",
    body: "The finding describes raw SQL string concatenation against the users table.",
    ...overrides,
  });

  // @nominal Scenario: a finding that already carries a model CWE renders exactly as before
  it("renders the GDPR and CWE references for a model-supplied CWE-89, unchanged", async () => {
    // Given the configured LLM returns one finding with category "security", cwe "CWE-89", confidence 0.9
    mockProviderFindings([modelCweFinding("CWE-89")]);
    const diff = parseUnifiedDiff(regulatedSqlDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");
    const walkthrough = composeWalkthrough(review);

    // Then the "Compliance & provenance" section lists a "GDPR: Art. 32" reference
    expect(walkthrough).toContain("GDPR: Art. 32");
    // And it also lists the "CWE: CWE-89" reference
    expect(walkthrough).toContain("CWE: CWE-89");
  });

  // @violation Scenario Outline: derivation never overrides a model-supplied CWE
  it.each([{ cwe: "CWE-79" }, { cwe: "CWE-256" }])(
    "keeps the model CWE $cwe and never derives CWE-89 from the content",
    async ({ cwe }) => {
      // Given the configured LLM returns one finding with category "security", cwe "<cwe>", confidence 0.9
      // And the finding describes "raw SQL string concatenation against the users table"
      mockProviderFindings([modelCweFinding(cwe)]);
      const diff = parseUnifiedDiff(regulatedSqlDiff);

      // When the review runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider: createHttpProvider() },
      );
      expect(review.status).toBe("success");
      const walkthrough = composeWalkthrough(review);

      // Then the "Compliance & provenance" section lists the "CWE: <cwe>" reference
      expect(walkthrough).toContain(`CWE: ${cwe}`);
      // And it lists no "CWE: CWE-89" reference (derivation did not override the model CWE)
      expect(walkthrough).not.toContain("CWE: CWE-89");
    },
  );

  // @violation Scenario: a model-supplied unmapped CWE is not rescued by derivation
  it("does not rescue a model-supplied unmapped CWE through derivation", async () => {
    // Given the configured LLM returns one finding with category "security", cwe "CWE-99999", confidence 0.9
    // And the finding describes "raw SQL string concatenation against the users table"
    mockProviderFindings([modelCweFinding("CWE-99999")]);
    const diff = parseUnifiedDiff(regulatedSqlDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");
    const walkthrough = composeWalkthrough(review);

    // Then the "Compliance & provenance" section lists no framework reference for that finding
    expect(walkthrough).not.toContain("Potential compliance references");
    expect(walkthrough).not.toContain("GDPR");
  });
});

// Acceptance test for feat-2610 R-03 (scenario sub-issue #2618): derivation declines when content
// maps to no specific mapped CWE, when confidence is below 0.7, or when the category is not
// security/bug. No guess, no false attribution — a wrong GDPR/DORA citation is worse than none.
// Drives the real gate + enricher + composer through reviewPullRequest with the LLM mocked at the
// provider boundary.
describe("reviewPullRequest declines derivation rather than guess a framework reference (feat-2610 R-03)", () => {
  const config = {
    review: { severityThreshold: "nitpick" as const },
    ignores: [] as readonly string[],
    limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
  };

  // Background: a pull request whose diff touches code that processes personal data.
  const regulatedDiff = `diff --git a/src/users/repository.ts b/src/users/repository.ts
index 1111111..2222222 100644
--- a/src/users/repository.ts
+++ b/src/users/repository.ts
@@ -10,3 +10,3 @@ export class UserRepository {
   async findByEmail(email: string) {
-    return this.db.query(buildParameterizedUserQuery(email));
+    return this.db.query("SELECT * FROM users WHERE email = '" + email + "'");
   }
`;

  const noCweFinding = (
    category: string,
    content: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    ...findingFor(undefined, category, "major"),
    file: "src/users/repository.ts",
    line_start: 11,
    line_end: 11,
    title: content,
    body: `The finding describes ${content}.`,
    confidence: 0.9,
    ...overrides,
  });

  // @violation Scenario: derivation declines when content maps to no specific vulnerability class
  it("declines when the content maps to no specific vulnerability class", async () => {
    // Given a security finding with no cwe describing a generic concern with no vulnerability class
    mockProviderFindings([
      noCweFinding("security", "possible security concern", {
        body: "A generic possible security concern with no identifiable vulnerability class.",
      }),
    ]);
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");
    const walkthrough = composeWalkthrough(review);

    // Then the "Compliance & provenance" section lists no framework reference for that finding
    expect(walkthrough).not.toContain("Potential compliance references");
    expect(walkthrough).not.toContain("GDPR");
  });

  // @violation Scenario: derivation respects the confidence floor on the no-cwe path
  it("declines on the no-cwe path when confidence is below the floor", async () => {
    // Given a security finding with no cwe, confidence 0.5, describing raw SQL string concatenation
    mockProviderFindings([
      noCweFinding("security", "raw SQL string concatenation against the users table", {
        confidence: 0.5,
      }),
    ]);
    const diff = parseUnifiedDiff(regulatedDiff);

    // When the review runs
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: createHttpProvider() },
    );
    expect(review.status).toBe("success");
    const walkthrough = composeWalkthrough(review);

    // Then no framework reference is emitted for that finding
    expect(walkthrough).not.toContain("Potential compliance references");
    expect(walkthrough).not.toContain("GDPR");
  });

  // Note: the pre-pivot "non-eligible category never derives a reference" scenarios were removed with
  // the generic categories (ADR-021, MAT-76); such a category is now rejected at the schema boundary
  // before derivation can run. The content-maps-to-nothing and confidence-floor cases (above and
  // below) still exercise decline-by-default on eligible security/bug findings.

  // @limit Scenario Outline: the confidence floor of 0.70 decides derivation on the no-cwe path
  it.each([
    { confidence: 0.7, present: true },
    { confidence: 0.69, present: false },
  ])(
    "derives on the no-cwe path at confidence $confidence only when it meets the 0.70 floor",
    async ({ confidence, present }) => {
      // Given a security finding with no cwe at the given confidence describing raw SQL string concatenation
      mockProviderFindings([
        noCweFinding("security", "raw SQL string concatenation against the users table", {
          confidence,
        }),
      ]);
      const diff = parseUnifiedDiff(regulatedDiff);

      // When the review runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider: createHttpProvider() },
      );
      expect(review.status).toBe("success");
      const walkthrough = composeWalkthrough(review);

      // Then the finding's framework references are present at >= 0.70 and absent below it
      if (present) {
        expect(walkthrough).toContain("GDPR: Art. 32");
      } else {
        expect(walkthrough).not.toContain("GDPR");
      }
    },
  );
});
