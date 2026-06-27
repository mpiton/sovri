// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adrDocsRoot = findAdrDocsRoot(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(dirname(adrDocsRoot));
const pivotAdrPath = join(adrDocsRoot, "022-project-level-compliance-pivot-vocabulary.md");

// These literals are the MAT-80 acceptance contract, not reusable product configuration.
const requiredDefinitions = [
  {
    term: "ComplianceGap",
    meaning: "project-level compliance output for an unmet control or missing evidence",
  },
  {
    term: "ControlResult",
    meaning: "result of evaluating a control against its rules and collected evidence",
  },
  {
    term: "Control",
    meaning: "framework requirement that the project must satisfy",
  },
  {
    term: "Rule",
    meaning: "technical verification attached to a control",
  },
  {
    term: "Evidence",
    meaning: "collected proof or observation used to support a control result or compliance gap",
  },
  {
    term: "FrameworkReference",
    meaning: "versioned framework citation with official text or source URL from a catalog",
  },
] as const;
const requiredProjectLevelTerms = ["ComplianceGap", "ControlResult"] as const;
const modelSplitDocPaths = ["PRD.md", "ARCHI.md", "CONTEXT.md"] as const;
const supersessionStatements = {
  mat77: "MAT-77",
  superseded: "superseded",
  mat113SupersedesMat77: "MAT-113 supersedes MAT-77",
} as const;
const traceabilityStatements = {
  mat77Superseded: "MAT-77: Superseded - enum-only compliance category scope is too narrow",
  mat113RulesEngine:
    "MAT-113: Project compliance rules engine - framework controls, evidence, gaps",
} as const;
const activeImplementationStatements = {
  activeMat77: "MAT-77: Active - enum-only compliance category scope",
  mat77IsSupersededByMat113: "MAT-77 is superseded by MAT-113",
  missingMat77SupersessionFailure: "MAT-77 missing superseded-by-MAT-113 relationship",
  missingMat77HistoryFailure: "MAT-77 missing from supersession history",
} as const;
const issueScopeStatements = {
  mat112CoreDomainModel: "MAT-112 defines the core compliance domain model",
  mat112ReviewOutputContract: "MAT-112 is the review output contract",
  mat113RulesEngineImplementationWork: "MAT-113 is the rules engine implementation work",
  mat113ProjectComplianceRulesEngineWork: "MAT-113 is the project compliance rules engine work",
  mat112OutputContractFailure: "MAT-112 is output contract, not core domain model",
  mat112MissingOutputContractFailure: "MAT-112 missing from output contract map",
} as const;
const modelSplitStatements = {
  sourceModel: "project compliance scans evaluate Framework -> Control -> Rule -> Evidence",
  complianceGapOutput: "project compliance scan produces ComplianceGap output",
  prProjection: "PR review may project relevant compliance gaps into pull request output",
  missingPrProjectionFailure: "missing PR review projection statement",
} as const;
const complianceGapFindingCategoryMisuse = {
  term: "ComplianceGap",
  statement: "ComplianceGap is a Finding category emitted by PR review",
  explanation: "ComplianceGap must be project-level compliance output",
  pattern: /\bComplianceGap\b\s+is\s+a\s+Finding\s+category\b(?:\s+emitted\s+by\s+PR\s+review\b)?/i,
} as const;

function findAdrDocsRoot(startDir: string): string {
  let currentDir = startDir;

  for (;;) {
    const candidate = join(currentDir, "docs", "adr");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not locate docs/adr from compliance pivot docs test");
    }
    currentDir = parentDir;
  }
}

function readDocs(): string {
  return readdirSync(adrDocsRoot)
    .filter((docPath) => docPath.endsWith(".md"))
    .map((docPath) => readFileSync(join(adrDocsRoot, docPath), "utf8"))
    .join("\n");
}

function readCompliancePivotDocs(): string {
  return [...modelSplitDocPaths.map(readProjectDoc), readDocs()].join("\n");
}

function readPivotAdr(): string {
  return readFileSync(pivotAdrPath, "utf8");
}

function readProjectDoc(docPath: string): string {
  return readFileSync(join(projectRoot, docPath), "utf8");
}

function findDefinitionLines(
  docs: string,
  term: string,
  options: { glossaryOnly?: boolean } = {},
): string[] {
  const definitionMarker = `**${term.toLowerCase()}**`;
  const glossaryDefinitionPrefix = `- ${definitionMarker}`;

  return docs.split(/\r?\n/).filter((line) => {
    const normalizedLine = line.trimStart().toLowerCase();
    return options.glossaryOnly === true
      ? normalizedLine.startsWith(glossaryDefinitionPrefix)
      : normalizedLine.includes(definitionMarker);
  });
}

function missingRequiredDefinitionTerms(_docs: string): string[] {
  return requiredProjectLevelTerms.filter((term) => findDefinitionLines(_docs, term).length === 0);
}

function findingCategoryFailureMessages(_docs: string): string[] {
  return _docs
    .split(/\r?\n/)
    .filter((line) => complianceGapFindingCategoryMisuse.pattern.test(line))
    .map(() => complianceGapFindingCategoryMisuse.explanation);
}

function modelSplitFailureMessages(_docs: string): string[] {
  const hasSourceModel = _docs.includes(modelSplitStatements.sourceModel);
  const hasComplianceGapOutput = _docs.includes(modelSplitStatements.complianceGapOutput);
  const hasPrProjection = _docs.includes(modelSplitStatements.prProjection);

  return hasSourceModel && hasComplianceGapOutput && !hasPrProjection
    ? [modelSplitStatements.missingPrProjectionFailure]
    : [];
}

function issueHistoryFailureMessages(_docs: string): string[] {
  const failureMessages: string[] = [];
  const hasActiveMat77 =
    _docs.includes(activeImplementationStatements.activeMat77) ||
    (_docs.includes("MAT-77") && _docs.includes("Active compliance implementation work"));
  const hasMat77SupersededByMat113 = _docs.includes(
    activeImplementationStatements.mat77IsSupersededByMat113,
  );
  const hasMat113RulesEngineHistory = _docs.includes(traceabilityStatements.mat113RulesEngine);
  const hasMat77History = _docs.includes("MAT-77");

  if (hasActiveMat77 && !hasMat77SupersededByMat113) {
    failureMessages.push(activeImplementationStatements.missingMat77SupersessionFailure);
  }

  if (hasMat113RulesEngineHistory && !hasMat77History) {
    failureMessages.push(activeImplementationStatements.missingMat77HistoryFailure);
  }

  return failureMessages;
}

function issueScopeFailureMessages(_docs: string): string[] {
  const normalizedDocs = _docs.toLowerCase();
  const failureMessages: string[] = [];
  const mat112ClaimsCoreModel = normalizedDocs.includes(
    issueScopeStatements.mat112CoreDomainModel.toLowerCase(),
  );
  const mat113RulesEngineWorkIsMissing = !normalizedDocs.includes(
    issueScopeStatements.mat113RulesEngineImplementationWork.toLowerCase(),
  );
  const mat113IdentifiesProjectComplianceRulesEngine =
    normalizedDocs.includes(
      issueScopeStatements.mat113ProjectComplianceRulesEngineWork.toLowerCase(),
    ) || normalizedDocs.includes(traceabilityStatements.mat113RulesEngine.toLowerCase());
  const mat112OutputContractEntryIsMissing = !normalizedDocs.includes(
    issueScopeStatements.mat112ReviewOutputContract.toLowerCase(),
  );

  if (mat112ClaimsCoreModel) {
    if (mat113RulesEngineWorkIsMissing) {
      failureMessages.push(issueScopeStatements.mat112OutputContractFailure);
    }
  }

  if (mat113IdentifiesProjectComplianceRulesEngine) {
    if (mat112OutputContractEntryIsMissing) {
      failureMessages.push(issueScopeStatements.mat112MissingOutputContractFailure);
    }
  }

  return failureMessages;
}

describe("MAT-80 compliance pivot vocabulary docs", () => {
  it("defines each required project-level compliance term explicitly", () => {
    // When the compliance vocabulary is reviewed
    const docs = readDocs();
    const pivotAdr = readPivotAdr();

    expect(pivotAdr, "pivot ADR must have the expected title").toContain(
      "# ADR-022 - Project-level compliance pivot vocabulary",
    );
    expect(pivotAdr, "pivot ADR must be accepted").toContain("**Status:** Accepted");
    expect(pivotAdr, "pivot ADR must explain context").toContain("## Context");
    expect(pivotAdr, "pivot ADR must record the decision").toContain("## Decision");
    expect(pivotAdr, "pivot ADR must record consequences").toContain("## Consequences");
    expect(
      findingCategoryFailureMessages(docs),
      `${complianceGapFindingCategoryMisuse.term} must not be documented as a Finding category`,
    ).toEqual([]);

    const requiredTermKeys = requiredDefinitions.map(({ term }) => term.toLowerCase());
    expect(
      new Set(requiredTermKeys).size,
      "required definitions must not contain case-insensitive duplicate terms",
    ).toBe(requiredDefinitions.length);

    for (const { term, meaning } of requiredDefinitions) {
      const definitionLines = findDefinitionLines(docs, term);

      expect(
        definitionLines,
        `${term} must have exactly one case-insensitive definition`,
      ).toHaveLength(1);

      const definitionText = definitionLines[0] ?? "";
      const normalizedDefinitionText = definitionText.toLowerCase();

      // Then the term "<term>" is defined with the meaning "<meaning>"
      expect(definitionText, `${term} must be defined with meaning: ${meaning}`).toContain(meaning);

      // And the definition does not describe "<term>" as an enum-only review category
      expect(
        normalizedDefinitionText,
        `${term} must not be an enum-only review category`,
      ).not.toContain("enum-only review category");
      expect(normalizedDefinitionText, `${term} must not be a finding category`).not.toContain(
        "finding category",
      );
      expect(
        normalizedDefinitionText,
        `${term} must not be a category emitted by PR review`,
      ).not.toContain("category emitted by pr review");
    }
  });

  it("fails the vocabulary check when project-level vocabulary is missing", () => {
    // Given "CONTEXT.md" defines "Finding" as a diff/code issue
    const docs = ["# CONTEXT.md", "**Finding** - diff/code issue"].join("\n");

    // And the documentation set has no definition for "ComplianceGap"
    expect(docs, "fixture must omit ComplianceGap").not.toMatch(/\*\*ComplianceGap\*\*/i);

    // And the documentation set has no definition for "ControlResult"
    expect(docs, "fixture must omit ControlResult").not.toMatch(/\*\*ControlResult\*\*/i);

    // When the compliance vocabulary is reviewed
    const missingTerms = missingRequiredDefinitionTerms(docs);

    // Then the vocabulary check fails
    expect(missingTerms.length, "vocabulary check must report missing terms").toBeGreaterThan(0);

    // And the missing terms are "ComplianceGap, ControlResult"
    expect(missingTerms.join(", "), "vocabulary check must report the required missing terms").toBe(
      requiredProjectLevelTerms.join(", "),
    );
  });

  it("fails when ComplianceGap is documented as a Finding category", () => {
    // Given "ARCHI.md" says "ComplianceGap is a Finding category emitted by PR review"
    const docs = ["# ARCHI.md", complianceGapFindingCategoryMisuse.statement].join("\n");

    // When the compliance vocabulary is reviewed
    const failureMessages = findingCategoryFailureMessages(docs);

    // Then the vocabulary check fails
    expect(failureMessages.length, "finding-category misuse check must fail").toBeGreaterThan(0);

    // And the failure explains that "ComplianceGap" must be project-level compliance output
    expect(
      failureMessages.join("\n"),
      "finding-category misuse check must explain the failure",
    ).toContain(complianceGapFindingCategoryMisuse.explanation);
  });

  it.each(modelSplitDocPaths)("names the source model and PR projection in %s", (docPath) => {
    // Given "<doc_path>" is part of the compliance pivot documentation set
    const docs = readProjectDoc(docPath);

    // When the compliance model documentation is reviewed

    // Then "<doc_path>" states that project compliance scans evaluate "Framework -> Control -> Rule -> Evidence"
    expect(docs, `${docPath} must name the project compliance source model`).toContain(
      modelSplitStatements.sourceModel,
    );

    // And "<doc_path>" states that the project compliance scan produces "ComplianceGap" output
    expect(docs, `${docPath} must name ComplianceGap as project compliance scan output`).toContain(
      modelSplitStatements.complianceGapOutput,
    );

    // And "<doc_path>" states that PR review may project relevant compliance gaps into pull request output
    expect(docs, `${docPath} must name the PR review projection`).toContain(
      modelSplitStatements.prProjection,
    );
  });

  it("fails when the source model is documented without the PR projection", () => {
    // Given "ARCHI.md" states that project compliance scans evaluate "Framework -> Control -> Rule -> Evidence"
    const docs = [
      "# ARCHI.md",
      modelSplitStatements.sourceModel,
      modelSplitStatements.complianceGapOutput,
    ].join("\n");

    expect(docs, "fixture must name the project compliance source model").toContain(
      modelSplitStatements.sourceModel,
    );

    // And "ARCHI.md" states that the project compliance scan produces "ComplianceGap" output
    expect(docs, "fixture must name ComplianceGap as project compliance scan output").toContain(
      modelSplitStatements.complianceGapOutput,
    );

    // And the docs do not state that PR review may project relevant compliance gaps into pull request output
    expect(docs, "fixture must omit the PR review projection").not.toContain(
      modelSplitStatements.prProjection,
    );

    // When the compliance model documentation is reviewed
    const failureMessages = modelSplitFailureMessages(docs);

    // Then the model split check fails
    expect(failureMessages.length, "model split check must fail").toBeGreaterThan(0);

    // And the failure identifies the missing PR review projection statement
    expect(
      failureMessages.join("\n"),
      "model split check must identify the missing PR review projection statement",
    ).toContain(modelSplitStatements.missingPrProjectionFailure);
  });

  it("keeps Finding separate from ComplianceGap in CONTEXT.md", () => {
    // Given "CONTEXT.md" defines "Finding" as a diff/code issue
    const docs = readProjectDoc("CONTEXT.md");
    const findingDefinitions = findDefinitionLines(docs, "Finding", { glossaryOnly: true });

    expect(findingDefinitions.length, "CONTEXT.md must define Finding").toBeGreaterThan(0);
    const findingDefinition = findingDefinitions[0] ?? "";
    expect(findingDefinition, "CONTEXT.md must define Finding as a diff/code issue").toContain(
      "diff/code issue",
    );

    // When the compliance model documentation is reviewed
    const complianceGapDefinitions = findDefinitionLines(docs, "ComplianceGap", {
      glossaryOnly: true,
    });

    // Then it keeps "Finding" separate from "ComplianceGap"
    expect(complianceGapDefinitions.length, "CONTEXT.md must define ComplianceGap").toBeGreaterThan(
      0,
    );
    const complianceGapDefinition = complianceGapDefinitions[0] ?? "";
    expect(complianceGapDefinition, "CONTEXT.md must define ComplianceGap").toContain(
      "**ComplianceGap**",
    );
    expect(
      findingDefinition,
      "CONTEXT.md must keep Finding and ComplianceGap definitions separate",
    ).not.toBe(complianceGapDefinition);

    // And it identifies "ComplianceGap" as project-level compliance output
    expect(
      complianceGapDefinition,
      "CONTEXT.md must identify ComplianceGap as project-level compliance output",
    ).toContain("project-level compliance output");
  });

  it("records MAT-77 as superseded by MAT-113", () => {
    // When the compliance pivot history is reviewed
    const docs = readCompliancePivotDocs();
    const mat77Lines = docs
      .split(/\r?\n/)
      .filter((line) => line.includes(supersessionStatements.mat77));

    // Then the docs reference "MAT-77"
    expect(docs, "compliance pivot docs must reference MAT-77").toContain(
      supersessionStatements.mat77,
    );

    // And the docs describe "MAT-77" as "superseded"
    expect(
      mat77Lines.join("\n").toLowerCase(),
      "compliance pivot docs must describe MAT-77 as superseded",
    ).toContain(supersessionStatements.superseded);

    // And the docs state that "MAT-113" supersedes "MAT-77"
    expect(docs, "compliance pivot docs must state that MAT-113 supersedes MAT-77").toContain(
      supersessionStatements.mat113SupersedesMat77,
    );
  });

  it("keeps both supersession issue identifiers traceable", () => {
    // When the compliance pivot history is reviewed
    const docs = readCompliancePivotDocs();

    // Then the docs reference "MAT-77: Superseded - enum-only compliance category scope is too narrow"
    expect(docs, "compliance pivot docs must keep the MAT-77 superseded issue trace").toContain(
      traceabilityStatements.mat77Superseded,
    );

    // And the docs reference "MAT-113: Project compliance rules engine - framework controls, evidence, gaps"
    expect(docs, "compliance pivot docs must keep the MAT-113 rules-engine issue trace").toContain(
      traceabilityStatements.mat113RulesEngine,
    );
  });

  it("fails when MAT-112 replaces the project compliance source model", () => {
    // Given the docs say "MAT-112 defines the core compliance domain model"
    const docs = [
      "# Compliance pivot issue map",
      `- ${issueScopeStatements.mat112CoreDomainModel}`,
    ].join("\n");

    expect(docs, "fixture must put MAT-112 in the core domain model role").toContain(
      issueScopeStatements.mat112CoreDomainModel,
    );

    // And the docs do not identify "MAT-113" as the rules engine implementation work
    expect(docs, "fixture must omit MAT-113 as the rules engine implementation work").not.toContain(
      issueScopeStatements.mat113RulesEngineImplementationWork,
    );

    // When the compliance pivot issue map is reviewed
    const failureMessages = issueScopeFailureMessages(docs);

    // Then the issue scope check fails
    expect(failureMessages.length, "issue scope check must fail").toBeGreaterThan(0);

    // And the failure explains that "MAT-112" is output contract, not core domain model
    expect(
      failureMessages.join("\n"),
      "issue scope failure must explain MAT-112's output-contract scope",
    ).toContain(issueScopeStatements.mat112OutputContractFailure);

    expect(
      issueScopeFailureMessages(readCompliancePivotDocs()),
      "project docs must not identify MAT-112 as the project compliance source model",
    ).toEqual([]);
  });

  it("fails when MAT-112 is omitted from the output contract map", () => {
    // Given the docs identify "MAT-113" as the project compliance rules engine work
    const docs = [
      "# Compliance pivot issue map",
      `- ${issueScopeStatements.mat113ProjectComplianceRulesEngineWork}`,
    ].join("\n");

    expect(docs, "fixture must identify MAT-113 as project compliance rules engine work").toContain(
      issueScopeStatements.mat113ProjectComplianceRulesEngineWork,
    );

    // And the docs do not reference "MAT-112"
    expect(docs.toLowerCase(), "fixture must omit MAT-112").not.toContain("mat-112");

    // When the compliance pivot issue map is reviewed
    const failureMessages = issueScopeFailureMessages(docs);

    // Then the issue scope check fails
    expect(failureMessages.length, "issue scope check must fail").toBeGreaterThan(0);

    // And the failure identifies "MAT-112" as missing from the output contract map
    expect(
      failureMessages.join("\n"),
      "issue scope failure must identify MAT-112 as missing from the output contract map",
    ).toContain(issueScopeStatements.mat112MissingOutputContractFailure);

    expect(
      issueScopeFailureMessages(readCompliancePivotDocs()),
      "project docs must include MAT-112 in the output contract map",
    ).toEqual([]);
  });

  it("fails when MAT-77 remains active without its supersession relationship", () => {
    // Given the docs list "MAT-77" under active compliance implementation work
    const docs = [
      "# Compliance implementation history",
      "Active compliance implementation work:",
      `- ${activeImplementationStatements.activeMat77}`,
    ].join("\n");

    expect(docs, "fixture must list MAT-77").toContain("MAT-77");
    expect(docs, "fixture must list active compliance implementation work").toContain(
      "Active compliance implementation work",
    );

    // And the docs do not say "MAT-77 is superseded by MAT-113"
    expect(docs, "fixture must omit the MAT-77 superseded-by-MAT-113 relationship").not.toContain(
      activeImplementationStatements.mat77IsSupersededByMat113,
    );

    // When the compliance pivot history is reviewed
    const failureMessages = issueHistoryFailureMessages(docs);

    // Then the issue history check fails
    expect(failureMessages.length, "issue history check must fail").toBeGreaterThan(0);

    // And the failure identifies "MAT-77" as missing its superseded-by-MAT-113 relationship
    expect(
      failureMessages.join("\n"),
      "issue history check must identify MAT-77's missing supersession relationship",
    ).toContain(activeImplementationStatements.missingMat77SupersessionFailure);

    expect(
      issueHistoryFailureMessages(readCompliancePivotDocs()),
      "project docs must not list MAT-77 as active without its supersession relationship",
    ).toEqual([]);
  });

  it("fails when MAT-113 supersedes an unmentioned MAT-77", () => {
    // Given the docs reference "MAT-113: Project compliance rules engine - framework controls, evidence, gaps"
    const docs = [
      "# Compliance implementation history",
      `- ${traceabilityStatements.mat113RulesEngine}`,
    ].join("\n");

    expect(docs, "fixture must reference MAT-113 rules-engine history").toContain(
      traceabilityStatements.mat113RulesEngine,
    );

    // And the docs do not reference "MAT-77"
    expect(docs, "fixture must omit MAT-77").not.toContain("MAT-77");

    // When the compliance pivot history is reviewed
    const failureMessages = issueHistoryFailureMessages(docs);

    // Then the issue history check fails
    expect(failureMessages.length, "issue history check must fail").toBeGreaterThan(0);

    // And the failure identifies "MAT-77" as missing from the supersession history
    expect(
      failureMessages.join("\n"),
      "issue history check must identify MAT-77 as missing from supersession history",
    ).toContain(activeImplementationStatements.missingMat77HistoryFailure);
  });
});
