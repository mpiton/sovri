// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

import { ReviewSchema, type Finding, type Review, type Severity } from "@sovri/core";
import { describe, expect, it, vi } from "vitest";

import {
  composeWalkthrough,
  computeEffortScore,
  renderAssessmentBlock,
  renderEffortMeter,
  renderMetricChips,
  renderSeverityDistribution,
} from "./index.js";

const ASSESSMENT_SOURCE_URL = new URL("./assessment.ts", import.meta.url);
const INTERNAL_IMPORT_PATTERN = /from\s+"(?<specifier>\.[^"]+)"/gu;
const FINDING_ID_SUFFIX_BY_SEVERITY: Readonly<Record<Severity, string>> = {
  blocker: "000000000001",
  major: "000000000002",
  minor: "000000000003",
  info: "000000000004",
  nitpick: "000000000005",
};

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/review.ts",
  line_start: 18,
  line_end: 18,
  title: "Secret token should not appear in assessment output",
  body: "github_pat_test API key raw webhook payload",
  source: "llm",
  confidence: 0.87,
};

const baseReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "Review completed.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("assessment quality contract (R-09)", () => {
  it("keeps the public header and ESM imports contract", () => {
    // Given the source file "packages/review-engine/src/walkthrough/assessment.ts"
    // When the file is inspected
    const source = readAssessmentSource();
    const lines = source.split(/\r?\n/u);

    // Then the first line is "// SPDX-License-Identifier: Apache-2.0"
    expect(lines[0]).toBe("// SPDX-License-Identifier: Apache-2.0");
    // And the second line is "// Copyright 2026 Sovri SAS"
    expect(lines[1]).toBe("// Copyright 2026 Sovri SAS");
    // And every internal relative import uses an explicit ".js" extension
    const internalImports = extractInternalRelativeImports(source);
    expect(internalImports).toContain("./badge.js");
    expect(internalImports.every((specifier) => specifier.endsWith(".js"))).toBe(true);
    // And the module imports Finding and Severity types from "@sovri/core"
    const coreImports = extractCoreImports(source);
    expect(coreImports).toMatch(/\btype\s+Finding\b/u);
    expect(coreImports).toMatch(/\btype\s+Severity\b/u);
  });

  it("keeps the source free of forbidden TypeScript escape hatches", () => {
    // Given the source file "packages/review-engine/src/walkthrough/assessment.ts"
    // When the file is inspected
    const source = readAssessmentSource();

    // Then it contains no "any" type
    expect(source).not.toMatch(/\bany\b/u);
    // And it contains no unjustified "as" assertion
    expect(source).not.toMatch(/\sas\s/u);
    // And it contains no "@ts-ignore" comment
    expect(source).not.toContain("@ts-ignore");
    // And it contains no "@ts-expect-error" comment
    expect(source).not.toContain("@ts-expect-error");
    // And it contains no "oxlint-disable" comment
    expect(source).not.toContain("oxlint-disable");
  });

  it("keeps helpers pure and free of secret-bearing output", () => {
    // Given a review containing normal findings
    const findings = [
      baseFinding,
      makeFinding("minor", "src/docs.ts", "Document the review summary."),
    ];
    const consoleSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network access is disabled in this test"));

    try {
      // When computeEffortScore, renderEffortMeter, renderMetricChips,
      // renderSeverityDistribution, and renderAssessmentBlock are called
      const rendered = renderAssessmentOutputs(findings).toLowerCase();

      // Then no helper reads from the file system
      // And no helper performs network access
      expect(fetchSpy).not.toHaveBeenCalled();
      // And no helper reads environment variables
      expectSourceToAvoidIoAndEnvironment(readAssessmentSource());
      // And no helper writes logs
      for (const spy of consoleSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      // And no helper renders tokens, keys, or raw webhook payloads
      expect(rendered).not.toContain("github_pat_test");
      expect(rendered).not.toContain("api key");
      expect(rendered).not.toContain("raw webhook payload");
      expect(rendered).not.toContain("token");
    } finally {
      fetchSpy.mockRestore();
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
    }
  });

  it("rejects invalid external review input before assessment rendering", () => {
    // Given an unknown walkthrough input whose finding has severity "critical"
    const invalidInput = {
      ...baseReview,
      findings: [{ ...baseFinding, severity: "critical" }],
    };
    let markdown: string | undefined;

    // When composeWalkthrough parses the input
    const compose = (): void => {
      markdown = composeWalkthrough(invalidInput);
    };

    // Then ReviewSchema validation rejects the input
    expect(ReviewSchema.safeParse(invalidInput).success).toBe(false);
    expect(compose).toThrow();
    // And no assessment markdown is returned
    expect(markdown).toBeUndefined();
  });
});

function readAssessmentSource(): string {
  return readFileSync(ASSESSMENT_SOURCE_URL, "utf8");
}

function extractInternalRelativeImports(source: string): readonly string[] {
  const specifiers: string[] = [];

  for (const match of source.matchAll(INTERNAL_IMPORT_PATTERN)) {
    const specifier = match.groups?.specifier;
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function extractCoreImports(source: string): string {
  const match = source.match(/import\s+\{(?<imports>[^}]+)\}\s+from "@sovri\/core";/u);
  return match?.groups?.imports ?? "";
}

function makeFinding(severity: Severity, file: string, body: string): Finding {
  return {
    ...baseFinding,
    id: `22222222-2222-4222-8222-${FINDING_ID_SUFFIX_BY_SEVERITY[severity]}`,
    severity,
    file,
    line_start: 24,
    line_end: 24,
    title: `${severity} finding`,
    body,
  };
}

function renderAssessmentOutputs(findings: readonly Finding[]): string {
  const score = computeEffortScore(findings);

  return [
    String(score),
    renderEffortMeter(score),
    renderMetricChips(findings),
    ...renderSeverityDistribution(findings),
    ...renderAssessmentBlock(findings),
  ].join("\n");
}

function expectSourceToAvoidIoAndEnvironment(source: string): void {
  const forbiddenPatterns = [
    ["file system access", /\b(?:readFileSync|readFile|writeFile|createReadStream)\b/u],
    ["file system imports", /from\s+"(?:node:fs|fs)"/u],
    ["network access", /\b(?:fetch|XMLHttpRequest|WebSocket|Octokit)\b/u],
    ["network imports", /from\s+"(?:node:http|node:https|http|https)"/u],
    ["environment reads", /\bprocess\.env\b|import\.meta\.env/u],
    ["logger access", /\b(?:console\.|createLogger|logger\.)\b/u],
  ] satisfies ReadonlyArray<readonly [string, RegExp]>;

  for (const [label, pattern] of forbiddenPatterns) {
    expect(source, `assessment.ts should not use ${label}`).not.toMatch(pattern);
  }
}
