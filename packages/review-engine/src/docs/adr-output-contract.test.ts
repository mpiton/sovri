// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const ADR_021_PATH = "docs/adr/021-compliance-only-review-taxonomy.md";
const ADR_022_PATH = "docs/adr/022-project-level-compliance-pivot.md";
const SOURCE_MODEL = "Framework -> Control -> Rule -> Evidence";
const CONFLICT_FAILURE = "conflict between CWE-backed Findings and non-CWE ComplianceGaps";
const MISSING_MAT_112_SCOPE_FAILURE = "MAT-112 output-contract scope is missing";
const MAT_112_AFFIRMATIVE_OUTPUT_SCOPE_PHRASES = [
  "MAT-112 is the review output contract",
  "MAT-112 is the PR/report output contract",
  "MAT-112 is scoped to PR/review output",
] as const;
const MAT_112_NEGATED_OUTPUT_SCOPE_PHRASES = [
  "MAT-112 does not describe the review output contract",
  "MAT-112 does not describe the PR/report output contract",
  "MAT-112 does not describe PR/review output",
  "MAT-112 is not the review output contract",
  "MAT-112 is not the PR/report output contract",
  "MAT-112 is not scoped to PR/review output",
  "MAT-112 has no review output contract",
  "MAT-112 has no PR/report output contract",
  "no MAT-112 review output contract",
  "no MAT-112 PR/report output contract",
] as const;

describe("R-07: ADR-021 and ADR-022 reflect the project compliance output model", () => {
  it("keeps Framework to Control to Rule to Evidence as ADR-022's source model", () => {
    // Given ADR-021 is "docs/adr/021-compliance-only-review-taxonomy.md"
    readProjectFile(ADR_021_PATH);

    // And ADR-022 is "docs/adr/022-project-level-compliance-pivot.md"
    const adr022 = readProjectFile(ADR_022_PATH);

    // When ADR-022 is reviewed
    const sourceModelFailures = prReviewSourceModelFailures(adr022);

    // Then ADR-022 describes "Framework -> Control -> Rule -> Evidence" as the source language
    expect(adr022).toContain(SOURCE_MODEL);

    // And ADR-022 describes "ComplianceGap" as project-level compliance output
    expect(adr022).toContain("ComplianceGap");
    expect(adr022).toContain("project-level compliance output");

    // And ADR-022 says PR review output can project ComplianceGap instances
    expect(adr022).toContain("PR review output can project");
    expect(adr022).toContain("ComplianceGap");

    // And ADR-022 does not describe PR review output as the source model
    expect(sourceModelFailures).toEqual([]);
  });

  it("preserves the CWE-backed Finding path while acknowledging non-CWE gaps in ADR-021", () => {
    // Given ADR-021 is "docs/adr/021-compliance-only-review-taxonomy.md"
    const adr021 = readProjectFile(ADR_021_PATH);

    // And ADR-022 is "docs/adr/022-project-level-compliance-pivot.md"
    readProjectFile(ADR_022_PATH);

    // When ADR-021 is reviewed for the MAT-112 output contract
    const findingCategoryFailures = complianceGapFindingCategoryFailures(adr021);

    // Then ADR-021 preserves security and bug Findings as the CWE-backed review path
    expect(adr021).toContain('"bug"');
    expect(adr021).toContain('"security"');
    expect(adr021).toContain("CWE");
    expect(adr021).toContain("finding");

    // And ADR-021 does not require project compliance gaps to have a CWE
    expect(acknowledgesNonCweComplianceGaps(adr021)).toBe(true);

    // And ADR-021 does not define ComplianceGap as a Finding category
    expect(findingCategoryFailures).toEqual([]);
  });

  it("fails when ADRs require all compliance output to be CWE-backed Findings", () => {
    // Given ADR-021 says "all compliance output must be rendered as CWE-backed Findings"
    const adr021 = "all compliance output must be rendered as CWE-backed Findings";

    // And ADR-022 describes ComplianceGap as project-level output
    const adr022 = "ComplianceGap is project-level compliance output";

    // When the ADR consistency check runs
    const failures = adrConsistencyFailures({ adr021, adr022 });

    // Then the ADR consistency check fails
    expect(failures.length).toBeGreaterThan(0);

    // And the failure identifies the conflict between CWE-backed Findings and non-CWE ComplianceGaps
    expect(failures).toContain(CONFLICT_FAILURE);
  });

  it("fails when ADR-022 omits MAT-112's output-contract scope", () => {
    // Given ADR-022 describes MAT-113 as the rules engine work
    const adr022 = [
      "MAT-113 is the project compliance rules engine work.",
      `MAT-113 owns the core model ${SOURCE_MODEL}.`,
    ].join("\n");

    // And ADR-022 does not describe MAT-112 as the PR/report output contract
    expect(adr022).not.toContain("MAT-112");

    // When the ADR consistency check runs
    const failures = adrConsistencyFailures({ adr021: readProjectFile(ADR_021_PATH), adr022 });

    // Then the ADR consistency check fails
    expect(failures.length).toBeGreaterThan(0);

    // And the failure identifies MAT-112 output-contract scope as missing
    expect(failures).toContain(MISSING_MAT_112_SCOPE_FAILURE);
  });

  it("fails when ADR-022 negates MAT-112's output-contract scope", () => {
    const adr022 = [
      "MAT-113 is the project compliance rules engine work.",
      "MAT-112 is not the PR/report output contract.",
    ].join("\n");

    const failures = adrConsistencyFailures({ adr021: readProjectFile(ADR_021_PATH), adr022 });

    expect(failures).toContain(MISSING_MAT_112_SCOPE_FAILURE);
  });

  it("fails when ADR-022 uses non-affirmative MAT-112 output-contract wording", () => {
    const adr022 = [
      "MAT-113 is the project compliance rules engine work.",
      "MAT-112 does not describe the PR/report output contract.",
    ].join("\n");

    const failures = adrConsistencyFailures({ adr021: readProjectFile(ADR_021_PATH), adr022 });

    expect(failures).toContain(MISSING_MAT_112_SCOPE_FAILURE);
  });

  it("keeps an affirmative MAT-112 scope when ADR-022 says it is not the only output contract", () => {
    const adr022 = [
      "MAT-113 is the project compliance rules engine work.",
      "MAT-112 is not the only PR/report output contract; MAT-112 is the PR/report output contract.",
    ].join("\n");

    const failures = adrConsistencyFailures({ adr021: readProjectFile(ADR_021_PATH), adr022 });

    expect(failures).not.toContain(MISSING_MAT_112_SCOPE_FAILURE);
  });

  it("fails when ADR-022 uses ambiguous MAT-112 output-contract wording", () => {
    const adr022 = [
      "MAT-113 is the project compliance rules engine work.",
      "MAT-112 might describe the PR/report output contract.",
    ].join("\n");

    const failures = adrConsistencyFailures({ adr021: readProjectFile(ADR_021_PATH), adr022 });

    expect(failures).toContain(MISSING_MAT_112_SCOPE_FAILURE);
  });

  it("fails when ADR-022 mentions MAT-112 only in an unrelated context", () => {
    const adr022 = [
      "MAT-113 is the project compliance rules engine work.",
      "See MAT-112 for details.",
    ].join("\n");

    const failures = adrConsistencyFailures({ adr021: readProjectFile(ADR_021_PATH), adr022 });

    expect(failures).toContain(MISSING_MAT_112_SCOPE_FAILURE);
  });
});

function findProjectRoot(startDir: string): string {
  let currentDir = realpathSync(startDir);

  while (true) {
    if (existsSync(join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = realpathSync(dirname(currentDir));
    if (parentDir === currentDir) {
      throw new Error(`Could not find project root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

function readProjectFile(path: string): string {
  return utf8Decoder.decode(readFileSync(join(projectRoot, path)));
}

function prReviewSourceModelFailures(adr022: string): readonly string[] {
  return lines(adr022)
    .filter((line) =>
      lineContainsAny(line, [
        "PR review output is the source model",
        "PR review findings are the source compliance model",
      ]),
    )
    .map(() => "PR review output must be a projection, not the source model");
}

function complianceGapFindingCategoryFailures(adr: string): readonly string[] {
  return lines(adr)
    .filter(
      (line) =>
        lineContainsAll(line, ["ComplianceGap", "Finding category"]) &&
        !lineContainsAny(line, ["must not", "never", "is not"]),
    )
    .map(() => "ComplianceGap must not be a Finding category");
}

function acknowledgesNonCweComplianceGaps(adr021: string): boolean {
  return lines(adr021).some((line) => lineContainsAll(line, ["non-CWE", "ComplianceGap"]));
}

function adrConsistencyFailures({
  adr021,
  adr022,
}: {
  readonly adr021: string;
  readonly adr022: string;
}): readonly string[] {
  const failures: string[] = [];

  if (
    lineContainsAny(adr021, ["all compliance output must be rendered as CWE-backed Findings"]) &&
    lines(adr022).some((line) => lineContainsAll(line, ["ComplianceGap", "project-level"]))
  ) {
    failures.push(CONFLICT_FAILURE);
  }

  if (mentionsMat113RulesEngine(adr022) && !hasAffirmativeMat112OutputScope(adr022)) {
    failures.push(MISSING_MAT_112_SCOPE_FAILURE);
  }

  return failures;
}

function mentionsMat113RulesEngine(adr022: string): boolean {
  return lines(adr022).some((line) => lineContainsAll(line, ["MAT-113", "rules engine"]));
}

function hasAffirmativeMat112OutputScope(adr022: string): boolean {
  return lines(adr022).some((line) => {
    if (lineNegatesMat112OutputScope(line)) {
      return false;
    }

    return lineContainsAny(line, MAT_112_AFFIRMATIVE_OUTPUT_SCOPE_PHRASES);
  });
}

function lineNegatesMat112OutputScope(line: string): boolean {
  return lineContainsAny(line, MAT_112_NEGATED_OUTPUT_SCOPE_PHRASES);
}

function lines(text: string): readonly string[] {
  return text.split(/\r?\n/);
}

function lineContainsAll(line: string, values: readonly string[]): boolean {
  const normalizedLine = line.toLowerCase();
  return values.every((value) => normalizedLine.includes(value.toLowerCase()));
}

function lineContainsAny(line: string, values: readonly string[]): boolean {
  const normalizedLine = line.toLowerCase();
  return values.some((value) => normalizedLine.includes(value.toLowerCase()));
}
