// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adrDocsRoot = findAdrDocsRoot(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(dirname(adrDocsRoot));
const pivotAdrPath = join(adrDocsRoot, "022-project-level-compliance-pivot.md");

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
const snapshotDocPairs = [
  { sourcePath: "PRD.md", snapshotPath: "../sovri-docs/PRD.md" },
  { sourcePath: "ARCHI.md", snapshotPath: "../sovri-docs/ARCHI.md" },
  { sourcePath: "CONTEXT.md", snapshotPath: "../sovri-docs/glossary.md" },
] as const;
const adrIndexExamples = [
  {
    changeType: "creates",
    adrPath: "docs/adr/022-project-level-compliance-pivot.md",
    adrTitle: "Project-level compliance pivot vocabulary",
  },
  {
    changeType: "revises",
    adrPath: "docs/adr/020-deterministic-compliance-derivation.md",
    adrTitle: "Deterministic compliance derivation",
  },
] as const;
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
const issueScopeExamples = [
  {
    issueId: "MAT-112",
    requiredScope: "output contract",
    forbiddenScope: "core domain model",
  },
  {
    issueId: "MAT-113",
    requiredScope: "project compliance rules engine work",
    forbiddenScope: "PR output contract",
  },
] as const;
const modelSplitStatements = {
  sourceModel: "project compliance scans evaluate Framework -> Control -> Rule -> Evidence",
  complianceGapOutput: "project compliance scan produces ComplianceGap output",
  prProjection: "PR review may project relevant compliance gaps into pull request output",
  missingPrProjectionFailure: "missing PR review projection statement",
  prReviewAsSourceModel: "PR review findings are the source compliance model",
  prReviewProjectionOnlyFailure:
    "PR review is only a projection of project compliance gaps, not the source compliance model",
} as const;
const issueModelStatements = {
  mat112: "MAT-112",
  mat113: "MAT-113",
  mat113RulesEngineWork: "project compliance rules engine work",
  coreModel: "Framework -> Control -> Rule -> Evidence",
  prReviewOutput: "PR/review output",
} as const;
const complianceGapFindingCategoryMisuse = {
  term: "ComplianceGap",
  statement: "ComplianceGap is a Finding category emitted by PR review",
  explanation: "ComplianceGap must be project-level compliance output",
  pattern: /\bComplianceGap\b\s+is\s+a\s+Finding\s+category\b(?:\s+emitted\s+by\s+PR\s+review\b)?/i,
} as const;

function snapshotVocabularyTerms(): readonly string[] {
  return uniqueStrings(
    flattenContractStrings(snapshotVocabularySources()).flatMap(vocabularyCandidates),
  );
}

function snapshotVocabularySources(): readonly unknown[] {
  return [
    requiredDefinitions,
    issueScopeExamples,
    supersessionStatements,
    traceabilityStatements,
    issueScopeStatements,
    modelSplitStatements,
    issueModelStatements,
    complianceGapFindingCategoryMisuse,
  ];
}

function flattenContractStrings(input: unknown): string[] {
  if (typeof input === "string") {
    return [input];
  }

  if (Array.isArray(input)) {
    return input.flatMap(flattenContractStrings);
  }

  if (typeof input === "object" && input !== null) {
    return Object.values(input).flatMap(flattenContractStrings);
  }

  return [];
}

function vocabularyCandidates(value: string): readonly string[] {
  return [
    value,
    ...(value.match(/\bMAT-\d+\b/g) ?? []),
    ...(value.match(/\b[A-Z][A-Za-z]+(?:[A-Z][A-Za-z]+)*\b/g) ?? []),
  ];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)) {
    if (!seen.has(value)) {
      uniqueValues.push(value);
      seen.add(value);
    }
  }

  return uniqueValues;
}

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

function readAdrIndex(): string {
  return readFileSync(join(adrDocsRoot, "README.md"), "utf8");
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

function modelSplitFailureMessages(_docs: string): string[] {
  const failureMessages: string[] = [];
  const documentsPrReviewAsSourceModel = _docs.includes(modelSplitStatements.prReviewAsSourceModel);
  const documentsProjectComplianceSourceModel = _docs.includes(modelSplitStatements.sourceModel);
  const hasComplianceGapOutput = _docs.includes(modelSplitStatements.complianceGapOutput);
  const hasPrProjection = _docs.includes(modelSplitStatements.prProjection);

  if (documentsPrReviewAsSourceModel) {
    failureMessages.push(modelSplitStatements.prReviewProjectionOnlyFailure);
  }

  if (documentsProjectComplianceSourceModel && hasComplianceGapOutput && !hasPrProjection) {
    failureMessages.push(modelSplitStatements.missingPrProjectionFailure);
  }

  return failureMessages;
}

function findingCategoryFailureMessages(_docs: string): string[] {
  return _docs
    .split(/\r?\n/)
    .filter((line) => complianceGapFindingCategoryMisuse.pattern.test(line))
    .map(() => complianceGapFindingCategoryMisuse.explanation);
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

function issueScopeDescriptions(_docs: string, _issueId: string): string[] {
  const issueScope = issueScopeExamples.find(({ issueId }) => issueId === _issueId);
  if (!issueScope) {
    return [];
  }

  const issueBlocks = issueScopeBlocks(_docs, _issueId);
  const issueFragments = issueBlocks.flatMap(issueScopeFragments);
  const descriptions: string[] = [];

  if (issueFragments.some((fragment) => describesScope(fragment, issueScope.requiredScope))) {
    descriptions.push(issueScope.requiredScope);
  }

  if (issueFragments.some((fragment) => describesScope(fragment, issueScope.forbiddenScope))) {
    descriptions.push(issueScope.forbiddenScope);
  }

  return descriptions;
}

function issueScopeBlocks(docs: string, issueId: string): string[] {
  const lines = docs.split(/\r?\n/);
  const blocks: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.includes(issueId)) {
      continue;
    }

    const lineIndent = indentationLength(line);
    const isListItem = line.trimStart().startsWith("-") || line.trimStart().startsWith("*");
    const blockLines = [line];
    for (const nextLine of lines.slice(index + 1)) {
      const nextLineIndent = indentationLength(nextLine);

      if (
        !isListItem ||
        nextLine.trim() === "" ||
        nextLine.trimStart().startsWith("#") ||
        nextLineIndent <= lineIndent
      ) {
        break;
      }

      blockLines.push(nextLine);
    }

    blocks.push(blockLines.join("\n"));
  }

  return blocks;
}

function indentationLength(line: string): number {
  return line.length - line.trimStart().length;
}

function issueReferenceBlocks(docs: string, issueId: string): string[] {
  return issueScopeBlocks(docs, issueId).map((block) =>
    block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" "),
  );
}

function issueScopeFragments(block: string): string[] {
  return block
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
}

function describesScope(line: string, scope: string): boolean {
  const normalizedLine = line.toLowerCase();
  const normalizedScope = scope.toLowerCase();

  return normalizedLine.includes(normalizedScope) && !negatesScope(normalizedLine, normalizedScope);
}

function negatesScope(normalizedLine: string, normalizedScope: string): boolean {
  const negationPatterns = [
    `not the ${normalizedScope}`,
    `not ${normalizedScope}`,
    `never the ${normalizedScope}`,
    `does not include ${normalizedScope}`,
    `excludes ${normalizedScope}`,
  ];

  return negationPatterns.some((pattern) => normalizedLine.includes(pattern));
}

function formatStaleSnapshotFailure(input: { sourcePath: string; snapshotPath: string }): string {
  return `${input.snapshotPath} is stale because ${input.sourcePath} changed without a matching snapshot change`;
}

function hasChangedPath(changedPaths: readonly string[], docPath: string): boolean {
  const resolvedDocPath = resolve(projectRoot, docPath);

  return changedPaths.some((changedPath) => resolve(projectRoot, changedPath) === resolvedDocPath);
}

function staleSnapshotFailureMessages(input: {
  changedPaths: readonly string[];
  sourcePath: string;
  snapshotPath: string;
}): string[] {
  const sourceChanged = hasChangedPath(input.changedPaths, input.sourcePath);
  const snapshotChanged = hasChangedPath(input.changedPaths, input.snapshotPath);

  return sourceChanged && !snapshotChanged ? [formatStaleSnapshotFailure(input)] : [];
}

function snapshotSyncFailureMessages(input: {
  changedPaths: readonly string[];
  sourcePath: string;
  snapshotPath: string;
  docsByPath: Readonly<Record<string, string>>;
}): string[] {
  const failureMessages = staleSnapshotFailureMessages(input);
  const sourceDocs = input.docsByPath[input.sourcePath] ?? "";
  const snapshotDocs = input.docsByPath[input.snapshotPath] ?? "";
  const vocabulary = snapshotVocabularyTerms();
  const sourceVocabulary = snapshotVocabularyTermSet(sourceDocs);
  const snapshotVocabularyInDocs = snapshotVocabularyTermSet(snapshotDocs);
  const missingVocabulary = vocabulary.filter(
    (term) => sourceVocabulary.has(term) && !snapshotVocabularyInDocs.has(term),
  );
  const extraVocabulary = vocabulary.filter(
    (term) => snapshotVocabularyInDocs.has(term) && !sourceVocabulary.has(term),
  );

  if (missingVocabulary.length > 0) {
    failureMessages.push(
      `${input.snapshotPath} is missing compliance pivot vocabulary from ${input.sourcePath}: ${missingVocabulary.join(", ")}`,
    );
  }

  if (extraVocabulary.length > 0) {
    failureMessages.push(
      `${input.snapshotPath} contains compliance pivot vocabulary absent from ${input.sourcePath}: ${extraVocabulary.join(", ")}`,
    );
  }

  return failureMessages;
}

function snapshotVocabularyTermSet(docs: string): ReadonlySet<string> {
  return new Set(snapshotVocabularyTerms().filter((term) => containsVocabularyTerm(docs, term)));
}

function containsVocabularyTerm(docs: string, term: string): boolean {
  const escapedTerm = escapeRegExp(term);
  const termPattern = new RegExp(`(?<![A-Za-z0-9])${escapedTerm}(?![A-Za-z0-9])`);

  return termPattern.test(docs);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncedSnapshotDocs(
  sourcePath: string,
  snapshotPath: string,
): Readonly<Record<string, string>> {
  const sourceDocs = readProjectDoc(sourcePath);

  return {
    [sourcePath]: sourceDocs,
    [snapshotPath]: readSnapshotDoc(snapshotPath, sourceDocs),
  };
}

function readSnapshotDoc(snapshotPath: string, sourceDocs: string): string {
  const absoluteSnapshotPath = join(projectRoot, snapshotPath);

  try {
    return readFileSync(absoluteSnapshotPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return snapshotVocabularyFixtureDoc(snapshotPath, sourceDocs);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read snapshot doc ${snapshotPath}: ${message}`, { cause: error });
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function snapshotVocabularyFixtureDoc(snapshotPath: string, sourceDocs: string): string {
  const heading = `# ${basename(snapshotPath)}`;
  const sourceVocabulary = snapshotVocabularyTermSet(sourceDocs);

  return [
    heading,
    ...snapshotVocabularyTerms()
      .filter((term) => sourceVocabulary.has(term))
      .map((term) => `- ${term}`),
  ].join("\n");
}

function adrIndexFailureMessages(_input: {
  indexMarkdown: string;
  adrPath: string;
  adrTitle: string;
}): string[] {
  const relativeAdrPath = `./${_input.adrPath.replace(/^docs\/adr\//, "")}`;
  const failureMessages: string[] = [];

  if (!_input.indexMarkdown.includes(relativeAdrPath)) {
    failureMessages.push(`${_input.adrPath} is unlisted`);
  }

  if (!_input.indexMarkdown.includes(_input.adrTitle)) {
    failureMessages.push(`${_input.adrPath} title is missing: ${_input.adrTitle}`);
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

    expect(
      modelSplitFailureMessages(docs),
      `${docPath} must not document PR review findings as the source compliance model`,
    ).toEqual([]);
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

  it("fails when PR review is documented as the core compliance domain model", () => {
    // Given "ARCHI.md" says "PR review findings are the source compliance model"
    const invalidDocs = ["# ARCHI.md", modelSplitStatements.prReviewAsSourceModel].join("\n");

    expect(invalidDocs, "fixture must describe PR review as the source compliance model").toContain(
      modelSplitStatements.prReviewAsSourceModel,
    );

    // And "ARCHI.md" omits "Framework -> Control -> Rule -> Evidence"
    expect(invalidDocs, "fixture must omit the project compliance source model").not.toContain(
      modelSplitStatements.sourceModel,
    );

    // When the compliance model documentation is reviewed
    const failureMessages = modelSplitFailureMessages(invalidDocs);

    // Then the model split check fails
    expect(failureMessages.length, "model split check must fail").toBeGreaterThan(0);

    // And the failure explains that PR review is only a projection
    expect(
      failureMessages.join("\n"),
      "model split check must explain PR review as a projection",
    ).toContain(modelSplitStatements.prReviewProjectionOnlyFailure);
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

  it.each(snapshotDocPairs)(
    "requires a matching snapshot change when %s changes",
    ({ sourcePath, snapshotPath }) => {
      // Given the compliance pivot change modifies "<source_path>"
      const changedPaths = [sourcePath, snapshotPath] as const;
      const docsByPath = syncedSnapshotDocs(sourcePath, snapshotPath);
      expect(
        docsByPath[snapshotPath],
        "fixture must not mirror source docs as snapshot docs",
      ).not.toBe(docsByPath[sourcePath]);

      // When the documentation sync is reviewed
      const failureMessages = snapshotSyncFailureMessages({
        changedPaths,
        sourcePath,
        snapshotPath,
        docsByPath,
      });

      // Then the change set also modifies "<snapshot_path>"
      expect(changedPaths, `${snapshotPath} must be part of the change set`).toContain(
        snapshotPath,
      );

      // And "<snapshot_path>" contains the same compliance pivot vocabulary as "<source_path>"
      expect(
        failureMessages,
        `${snapshotPath} must contain the source compliance vocabulary`,
      ).toEqual([]);
    },
  );

  it("fails when snapshot docs carry vocabulary absent from the changed source doc", () => {
    // Given the compliance pivot change modifies "PRD.md"
    const sourcePath = "PRD.md";
    const snapshotPath = "../sovri-docs/PRD.md";
    const changedPaths = [sourcePath, snapshotPath] as const;
    const docsByPath = {
      [sourcePath]: modelSplitStatements.sourceModel,
      [snapshotPath]: [
        modelSplitStatements.sourceModel,
        issueScopeStatements.mat112ReviewOutputContract,
      ].join("\n"),
    } as const;

    expect(
      docsByPath[sourcePath],
      "fixture source doc must omit the extra snapshot vocabulary",
    ).not.toContain(issueScopeStatements.mat112ReviewOutputContract);

    // When the documentation sync is reviewed
    const failureMessages = snapshotSyncFailureMessages({
      changedPaths,
      sourcePath,
      snapshotPath,
      docsByPath,
    });

    // Then the snapshot sync check fails
    expect(failureMessages.length, "snapshot sync check must fail").toBeGreaterThan(0);

    // And the failure identifies the extra snapshot vocabulary
    expect(
      failureMessages.join("\n"),
      "snapshot sync failure must identify extra snapshot vocabulary",
    ).toContain(issueScopeStatements.mat112ReviewOutputContract);
  });

  it("does not treat overlapping vocabulary substrings as synced terms", () => {
    // Given the source doc carries "Control"
    const sourcePath = "ARCHI.md";
    const snapshotPath = "../sovri-docs/ARCHI.md";
    const changedPaths = [sourcePath, snapshotPath] as const;
    const docsByPath = {
      [sourcePath]: "Control",
      [snapshotPath]: "ControlResult",
    } as const;

    expect(
      docsByPath[snapshotPath],
      "fixture snapshot must carry an overlapping vocabulary term",
    ).toContain("ControlResult");

    // When the documentation sync is reviewed
    const failureMessages = snapshotSyncFailureMessages({
      changedPaths,
      sourcePath,
      snapshotPath,
      docsByPath,
    });

    // Then "ControlResult" does not satisfy the missing "Control" term
    expect(
      failureMessages.join("\n"),
      "snapshot sync failure must not use substring matching for vocabulary terms",
    ).toContain("Control");
  });

  it.each(snapshotDocPairs)(
    "fails when %s changes without its matching snapshot",
    ({ sourcePath, snapshotPath }) => {
      // Given the compliance pivot change modifies "<source_path>"
      const changedPaths = [sourcePath] as const;

      // And the change set does not modify "<snapshot_path>"
      expect(changedPaths, "fixture must omit the matching snapshot path").not.toContain(
        snapshotPath,
      );

      // When the documentation sync is reviewed
      const failureMessages = staleSnapshotFailureMessages({
        changedPaths,
        sourcePath,
        snapshotPath,
      });

      // Then the snapshot sync check fails
      expect(failureMessages.length, "snapshot sync check must fail").toBeGreaterThan(0);

      // And the failure identifies "<snapshot_path>" as stale
      expect(
        failureMessages.join("\n"),
        "snapshot sync failure must identify the stale snapshot path",
      ).toContain(`${snapshotPath} is stale`);
    },
  );

  it("does not require snapshot churn when source docs are unchanged", () => {
    // Given the compliance pivot change modifies only "docs/adr/README.md"
    // And the change set does not modify "PRD.md"
    // And the change set does not modify "ARCHI.md"
    // And the change set does not modify "CONTEXT.md"
    const changedPaths = ["docs/adr/README.md"] as const;

    expect(changedPaths, "fixture must include docs/adr/README.md").toEqual(
      expect.arrayContaining(["docs/adr/README.md"]),
    );

    // When the documentation sync is reviewed
    const failureMessages = snapshotDocPairs.flatMap(({ sourcePath, snapshotPath }) =>
      staleSnapshotFailureMessages({
        changedPaths,
        sourcePath,
        snapshotPath,
      }),
    );

    // Then the snapshot sync check succeeds without modifying "../sovri-docs/PRD.md"
    // And the snapshot sync check succeeds without modifying "../sovri-docs/ARCHI.md"
    // And the snapshot sync check succeeds without modifying "../sovri-docs/glossary.md"
    expect(failureMessages, "snapshot sync check must succeed").toEqual([]);
  });

  it.each(adrIndexExamples)(
    "lists $changeType ADR $adrPath in the ADR index",
    ({ changeType, adrPath, adrTitle }) => {
      // Given the compliance pivot change <change_type> "<adr_path>"
      const changedAdr = { changeType, adrPath, adrTitle } as const;

      // When the ADR index is reviewed
      const failureMessages = adrIndexFailureMessages({
        indexMarkdown: readAdrIndex(),
        adrPath: changedAdr.adrPath,
        adrTitle: changedAdr.adrTitle,
      });

      // Then "docs/adr/README.md" lists "<adr_path>"
      // And "docs/adr/README.md" lists the ADR title "<adr_title>"
      expect(
        failureMessages,
        `ADR index must list ${changedAdr.adrPath} and ${changedAdr.adrTitle}`,
      ).toEqual([]);
    },
  );

  it("fails when a new ADR is absent from the ADR index", () => {
    // Given the compliance pivot change creates "docs/adr/022-project-level-compliance-pivot.md"
    const adrPath = "docs/adr/022-project-level-compliance-pivot.md";
    const adrTitle = "Project-level compliance pivot vocabulary";

    // And "docs/adr/README.md" does not list "docs/adr/022-project-level-compliance-pivot.md"
    const indexMarkdown = [
      "# ADRs",
      "| # | Title | Status | Date |",
      "| --- | --- | --- | --- |",
      `| [021](./021-compliance-only-review-taxonomy.md) | ${adrTitle} | Accepted | 2026-06-26 |`,
    ].join("\n");

    expect(indexMarkdown, "fixture must omit the new ADR path").not.toContain(
      "./022-project-level-compliance-pivot.md",
    );

    // When the ADR index is reviewed
    const failureMessages = adrIndexFailureMessages({
      indexMarkdown,
      adrPath,
      adrTitle,
    });

    // Then the ADR index check fails
    expect(failureMessages.length, "ADR index check must fail").toBeGreaterThan(0);

    // And the failure identifies "docs/adr/022-project-level-compliance-pivot.md" as unlisted
    expect(failureMessages, "ADR index check must identify the unlisted new ADR").toContain(
      `${adrPath} is unlisted`,
    );
  });

  it("fails when a revised ADR disappears from the ADR index", () => {
    // Given the compliance pivot change revises "docs/adr/020-deterministic-compliance-derivation.md"
    const adrPath = "docs/adr/020-deterministic-compliance-derivation.md";
    const adrTitle = "Deterministic compliance derivation";

    // And "docs/adr/README.md" no longer lists "docs/adr/020-deterministic-compliance-derivation.md"
    const indexMarkdown = [
      "# ADRs",
      "| # | Title | Status | Date |",
      "| --- | --- | --- | --- |",
      `| [019](./019-otel-milestone-v0-6.md) | ${adrTitle} | Accepted | 2026-06-19 |`,
    ].join("\n");

    expect(indexMarkdown, "fixture must omit the revised ADR path").not.toContain(
      "./020-deterministic-compliance-derivation.md",
    );

    // When the ADR index is reviewed
    const failureMessages = adrIndexFailureMessages({
      indexMarkdown,
      adrPath,
      adrTitle,
    });

    // Then the ADR index check fails
    expect(failureMessages.length, "ADR index check must fail").toBeGreaterThan(0);

    // And the failure identifies "docs/adr/020-deterministic-compliance-derivation.md" as unlisted
    expect(failureMessages, "ADR index check must identify the unlisted revised ADR").toContain(
      `${adrPath} is unlisted`,
    );
  });

  it("keeps MAT-113 as the core domain model implementation reference", () => {
    // When the compliance pivot issue map is reviewed
    const docs = readCompliancePivotDocs();
    const mat113IssueMap = issueReferenceBlocks(docs, issueModelStatements.mat113).join("\n");
    const mat112IssueMap = issueReferenceBlocks(docs, issueModelStatements.mat112).join("\n");

    // Then the docs identify "MAT-113" as the project compliance rules engine work
    expect(
      mat113IssueMap.toLowerCase(),
      "MAT-113 must be identified as project compliance rules engine work",
    ).toContain(issueModelStatements.mat113RulesEngineWork);

    // And the docs associate the core model with "Framework -> Control -> Rule -> Evidence"
    expect(mat113IssueMap, "MAT-113 must carry the core model reference").toContain(
      issueModelStatements.coreModel,
    );

    // And the docs keep "MAT-112" scoped to PR/review output
    expect(mat112IssueMap, "MAT-112 must stay scoped to PR/review output").toContain(
      issueModelStatements.prReviewOutput,
    );
    expect(mat112IssueMap, "MAT-112 must not carry the core model reference").not.toContain(
      issueModelStatements.coreModel,
    );
  });

  it("keeps nested issue-map details with their parent issue", () => {
    // Given the docs keep "MAT-112" scoped to PR/review output
    const docs = [
      `- ${issueModelStatements.mat112} is scoped to ${issueModelStatements.prReviewOutput}.`,
      `  - Nested detail mentions ${issueModelStatements.coreModel}.`,
    ].join("\n");

    // When the compliance pivot issue map is reviewed
    const mat112IssueMap = issueReferenceBlocks(docs, issueModelStatements.mat112).join("\n");

    // Then nested details remain associated with "MAT-112"
    expect(mat112IssueMap, "MAT-112 nested details must remain in the issue block").toContain(
      issueModelStatements.coreModel,
    );
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

  it("keeps issue scopes separated across the pivot docs", () => {
    const docs = readCompliancePivotDocs();

    for (const { issueId, requiredScope, forbiddenScope } of issueScopeExamples) {
      // Given the docs reference "<issue_id>"
      expect(docs, `compliance pivot docs must reference ${issueId}`).toContain(issueId);

      // When the compliance pivot issue map is reviewed
      const scopeDescriptions = issueScopeDescriptions(docs, issueId).join("\n");

      // Then the docs describe "<issue_id>" as "<required_scope>"
      expect(scopeDescriptions, `${issueId} must be described as ${requiredScope}`).toContain(
        requiredScope,
      );

      // And the docs do not describe "<issue_id>" as "<forbidden_scope>"
      expect(
        scopeDescriptions,
        `${issueId} must not be described as ${forbiddenScope}`,
      ).not.toContain(forbiddenScope);
    }
  });
});
