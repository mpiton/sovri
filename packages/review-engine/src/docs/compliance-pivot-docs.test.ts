// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const adrDocsRoot = findAdrDocsRoot(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(dirname(adrDocsRoot));
const pivotAdrPath = join(adrDocsRoot, "022-project-level-compliance-pivot.md");
// Marks generated fallback docs used only when CI cannot see ignored local planning docs.
const IGNORED_PROJECT_DOC_FIXTURE_MARKER = "<!-- CI fixture: ignored project planning doc -->";
const SOVRI_DOCS_SNAPSHOT_ROOT_ENV = "SOVRI_DOCS_SNAPSHOT_ROOT";
const ADR_INDEX_STATUS_PATTERN = /^(?:Accepted|Proposed|Deprecated|Superseded by ADR-\d{3})$/;
const NonEmptyStringSchema = z.string().min(1);
const RegexSourceSchema = NonEmptyStringSchema.refine(
  (pattern) => {
    try {
      RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid regular expression source" },
);
const UniqueNonEmptyStringArraySchema = z
  .array(NonEmptyStringSchema)
  .min(1)
  .superRefine((values, context) => {
    const seenIndexesByTerm = new Map<string, number>();

    for (const [index, value] of values.entries()) {
      const termKey = normalizeVocabularyTerm(value).toUpperCase();
      const firstIndex = seenIndexesByTerm.get(termKey);
      if (firstIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `duplicates term at index ${firstIndex}`,
        });
        continue;
      }

      seenIndexesByTerm.set(termKey, index);
    }
  });
const activeImplementationStatementsSchema = z
  .object({
    mat77IsSupersededByMat113: NonEmptyStringSchema,
    mat77StillActiveFailure: NonEmptyStringSchema,
    missingMat77SupersessionFailure: NonEmptyStringSchema,
    missingMat77HistoryFailure: NonEmptyStringSchema,
  })
  .strict();
const contractSourceSchema = z
  .object({
    authorityPath: NonEmptyStringSchema,
    updateRule: NonEmptyStringSchema,
  })
  .strict();
const adrIndexExampleSchema = z
  .object({
    changeType: z.enum(["creates", "revises"]),
    adrPath: NonEmptyStringSchema,
    adrTitle: NonEmptyStringSchema,
  })
  .strict();
const complianceGapFindingCategoryMisuseSchema = z
  .object({
    term: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    explanation: NonEmptyStringSchema,
    pattern: RegexSourceSchema,
  })
  .strict();
const issueModelStatementsSchema = z
  .object({
    mat112: NonEmptyStringSchema,
    mat113: NonEmptyStringSchema,
    mat113RulesEngineWork: NonEmptyStringSchema,
    coreModel: NonEmptyStringSchema,
    prReviewOutput: NonEmptyStringSchema,
  })
  .strict();
const issueScopeExampleSchema = z
  .object({
    issueId: NonEmptyStringSchema,
    requiredScope: NonEmptyStringSchema,
    forbiddenScope: NonEmptyStringSchema,
  })
  .strict();
const issueScopeStatementsSchema = z
  .object({
    mat112CoreDomainModel: NonEmptyStringSchema,
    mat112ReviewOutputContract: NonEmptyStringSchema,
    mat113RulesEngineImplementationWork: NonEmptyStringSchema,
    mat113ProjectComplianceRulesEngineWork: NonEmptyStringSchema,
    mat112OutputContractFailure: NonEmptyStringSchema,
    mat112MissingOutputContractFailure: NonEmptyStringSchema,
  })
  .strict();
const modelSplitStatementsSchema = z
  .object({
    sourceModel: NonEmptyStringSchema,
    complianceGapOutput: NonEmptyStringSchema,
    prProjection: NonEmptyStringSchema,
    missingPrProjectionFailure: NonEmptyStringSchema,
    prReviewAsSourceModel: NonEmptyStringSchema,
    prReviewProjectionOnlyFailure: NonEmptyStringSchema,
  })
  .strict();
const snapshotDocPairSchema = z
  .object({
    sourcePath: NonEmptyStringSchema,
    snapshotPath: NonEmptyStringSchema,
  })
  .strict();
const supersessionStatementsSchema = z
  .object({
    mat77: NonEmptyStringSchema,
    superseded: NonEmptyStringSchema,
    mat113SupersedesMat77: NonEmptyStringSchema,
  })
  .strict();
const traceabilityStatementsSchema = z
  .object({
    mat77Superseded: NonEmptyStringSchema,
    mat113RulesEngine: NonEmptyStringSchema,
  })
  .strict();
const CompliancePivotContractSchema = z
  .object({
    activeImplementationStatements: activeImplementationStatementsSchema,
    contractSource: contractSourceSchema,
    adrIndexExamples: z.array(adrIndexExampleSchema).min(1),
    complianceGapFindingCategoryMisuse: complianceGapFindingCategoryMisuseSchema,
    issueModelStatements: issueModelStatementsSchema,
    issueScopeExamples: z.array(issueScopeExampleSchema).min(1),
    issueScopeStatements: issueScopeStatementsSchema,
    modelSplitDocPaths: z.array(NonEmptyStringSchema).min(1),
    modelSplitStatements: modelSplitStatementsSchema,
    requiredDefinitionTerms: UniqueNonEmptyStringArraySchema,
    requiredProjectLevelTerms: UniqueNonEmptyStringArraySchema,
    snapshotRootPath: NonEmptyStringSchema,
    snapshotDocPairs: z.array(snapshotDocPairSchema).min(1),
    supersessionStatements: supersessionStatementsSchema,
    traceabilityStatements: traceabilityStatementsSchema,
  })
  .strict()
  .superRefine((contract, context) => {
    const sourceDocs = new Set(contract.modelSplitDocPaths);
    const snapshotPairSourcePaths = new Map<string, number>();
    const snapshotPairPaths = new Map<string, number>();
    const modelSplitSourcePaths = new Map<string, number>();

    for (const [index, sourcePath] of contract.modelSplitDocPaths.entries()) {
      const firstIndex = modelSplitSourcePaths.get(sourcePath);
      if (firstIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["modelSplitDocPaths", index],
          message: `duplicates source path at index ${firstIndex}`,
        });
        continue;
      }

      modelSplitSourcePaths.set(sourcePath, index);
    }

    if (!contract.contractSource.authorityPath.endsWith(".md")) {
      context.addIssue({
        code: "custom",
        path: ["contractSource", "authorityPath"],
        message: "must identify the authoritative ADR markdown file",
      });
    }

    for (const [index, pair] of contract.snapshotDocPairs.entries()) {
      const firstSourceIndex = snapshotPairSourcePaths.get(pair.sourcePath);
      if (firstSourceIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["snapshotDocPairs", index, "sourcePath"],
          message: `duplicates source path at index ${firstSourceIndex}`,
        });
      }
      snapshotPairSourcePaths.set(pair.sourcePath, index);

      const firstSnapshotIndex = snapshotPairPaths.get(pair.snapshotPath);
      if (firstSnapshotIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["snapshotDocPairs", index, "snapshotPath"],
          message: `duplicates snapshot path at index ${firstSnapshotIndex}`,
        });
      }
      snapshotPairPaths.set(pair.snapshotPath, index);

      if (!sourceDocs.has(pair.sourcePath)) {
        context.addIssue({
          code: "custom",
          path: ["snapshotDocPairs", index, "sourcePath"],
          message: "must reference a configured model split document",
        });
      }

      if (!pair.snapshotPath.startsWith(`${contract.snapshotRootPath}/`)) {
        context.addIssue({
          code: "custom",
          path: ["snapshotDocPairs", index, "snapshotPath"],
          message: "must live under snapshotRootPath",
        });
      }
    }

    for (const sourcePath of sourceDocs) {
      if (!snapshotPairSourcePaths.has(sourcePath)) {
        context.addIssue({
          code: "custom",
          path: ["snapshotDocPairs"],
          message: `must include a snapshot pair for ${sourcePath}`,
        });
      }
    }
  });

type CompliancePivotContract = z.infer<typeof CompliancePivotContractSchema>;

const compliancePivotContract = readCompliancePivotContract();
const {
  activeImplementationStatements,
  adrIndexExamples,
  contractSource,
  issueModelStatements,
  issueScopeExamples,
  issueScopeStatements,
  modelSplitDocPaths,
  modelSplitStatements,
  requiredDefinitionTerms,
  requiredProjectLevelTerms,
  snapshotRootPath,
  snapshotDocPairs,
  supersessionStatements,
  traceabilityStatements,
} = compliancePivotContract;
const pivotAdrIndexExample = findRequiredAdrIndexExample(
  "docs/adr/022-project-level-compliance-pivot.md",
);
const pullRequestChangedPaths = readPrChangedPaths();
const complianceGapFindingCategoryMisuse = {
  ...compliancePivotContract.complianceGapFindingCategoryMisuse,
  pattern: RegExp(compliancePivotContract.complianceGapFindingCategoryMisuse.pattern, "i"),
} as const;

function snapshotVocabularyTerms(): readonly string[] {
  return uniqueStrings([
    ...requiredDefinitionTerms,
    supersessionStatements.mat77,
    ...issueScopeExamples.map(({ issueId }) => issueId),
    supersessionStatements.mat113SupersedesMat77,
    traceabilityStatements.mat77Superseded,
    traceabilityStatements.mat113RulesEngine,
    issueScopeStatements.mat112ReviewOutputContract,
    issueScopeStatements.mat113ProjectComplianceRulesEngineWork,
    modelSplitStatements.sourceModel,
    modelSplitStatements.complianceGapOutput,
    modelSplitStatements.prProjection,
  ]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const uniqueValuesByKey = new Map<string, string>();

  for (const value of values) {
    const normalized = normalizeVocabularyTerm(value);
    if (normalized.length === 0) {
      continue;
    }

    const key = normalized.toUpperCase();
    if (!uniqueValuesByKey.has(key)) {
      uniqueValuesByKey.set(key, normalized);
    }
  }

  return [...uniqueValuesByKey.values()];
}

function normalizeVocabularyTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findRequiredAdrIndexExample(adrPath: string): (typeof adrIndexExamples)[number] {
  const example = adrIndexExamples.find((candidate) => candidate.adrPath === adrPath);
  if (!example) {
    throw new Error(`Missing ADR index example for ${adrPath}`);
  }

  return example;
}

function adrNumberFromPath(adrPath: string): string {
  const adrNumberMatch = basename(adrPath).match(/^(\d+)/);
  if (!adrNumberMatch) {
    throw new Error(`ADR path does not start with a numeric prefix: ${adrPath}`);
  }

  return adrNumberMatch[1];
}

type AdrIndexEntry = {
  readonly adrPath: string;
  readonly adrTitle: string;
};

function changedAdrIndexEntries(): readonly AdrIndexEntry[] {
  return uniqueStrings(
    pullRequestChangedPaths.filter(
      (changedPath) => isAdrMarkdownPath(changedPath) && existsSync(join(projectRoot, changedPath)),
    ),
  ).map((adrPath) => ({
    adrPath,
    adrTitle: readAdrTitle(adrPath),
  }));
}

function isAdrMarkdownPath(changedPath: string): boolean {
  return (
    changedPath.startsWith("docs/adr/") &&
    changedPath.endsWith(".md") &&
    basename(changedPath) !== "README.md"
  );
}

function readAdrTitle(adrPath: string): string {
  const adrMarkdown = readFileSync(join(projectRoot, adrPath), "utf8");
  const heading = adrMarkdown
    .split(/\r?\n/)
    .map((line) => line.match(/^# ADR-\d+\s+(?:-|\u2014)\s+(.+)$/))
    .find((match) => match !== null);

  if (!heading) {
    throw new Error(`ADR markdown ${adrPath} must start with a parseable ADR title`);
  }

  return heading[1];
}

function activeMat77Statement(): string {
  return `${supersessionStatements.mat77}: Active - enum-only compliance category scope`;
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

function readPivotAdr(): string {
  return readFileSync(pivotAdrPath, "utf8");
}

function readAdrIndex(): string {
  return readFileSync(join(adrDocsRoot, "README.md"), "utf8");
}

function readCompliancePivotContract(): CompliancePivotContract {
  const contractPath = join(adrDocsRoot, "compliance-pivot-contract.json");
  const parseResult = CompliancePivotContractSchema.safeParse(
    JSON.parse(readFileSync(contractPath, "utf8")),
  );

  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid compliance pivot contract ${contractPath}: ${issues}`);
  }

  validateLoadedCompliancePivotContract(parseResult.data);

  return parseResult.data;
}

function validateLoadedCompliancePivotContract(contract: CompliancePivotContract): void {
  assertUniqueContractTerms("requiredDefinitionTerms", contract.requiredDefinitionTerms);
  assertUniqueContractTerms("requiredProjectLevelTerms", contract.requiredProjectLevelTerms);
  validateContractAuthorityPath(contract.contractSource.authorityPath);
  validateExistingSnapshotRoot(contract.snapshotRootPath);
}

function assertUniqueContractTerms(fieldPath: string, terms: readonly string[]): void {
  const seenTerms = new Set<string>();

  for (const term of terms) {
    const termKey = normalizeVocabularyTerm(term).toUpperCase();
    if (seenTerms.has(termKey)) {
      throw new Error(`Invalid compliance pivot contract ${fieldPath}: duplicate term ${term}`);
    }

    seenTerms.add(termKey);
  }
}

function validateExistingSnapshotRoot(rootPath: string): void {
  const absoluteRootPath = resolve(projectRoot, rootPath);
  if (!existsSync(absoluteRootPath)) {
    return;
  }

  if (!statSync(absoluteRootPath).isDirectory()) {
    throw new Error(`Invalid compliance pivot contract snapshotRootPath: not a directory`);
  }

  accessSync(absoluteRootPath, constants.R_OK | constants.W_OK);
}

function validateContractAuthorityPath(authorityPath: string): void {
  const absoluteAuthorityPath = join(adrDocsRoot, authorityPath);
  if (!existsSync(absoluteAuthorityPath)) {
    throw new Error(`Invalid compliance pivot contract authorityPath: does not exist`);
  }

  if (!statSync(absoluteAuthorityPath).isFile()) {
    throw new Error(`Invalid compliance pivot contract authorityPath: not a file`);
  }

  accessSync(absoluteAuthorityPath, constants.R_OK);
}

function readPrChangedPaths(): readonly string[] {
  const baseRefCandidates = uniqueStrings([
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "",
    process.env.GITHUB_BASE_REF ?? "",
    "origin/main",
    "main",
    "HEAD^1",
  ]);
  const failures: string[] = [];

  for (const baseRef of baseRefCandidates) {
    try {
      const mergeBase = execGit(["merge-base", baseRef, "HEAD"]);
      return execGit(["diff", "--name-only", `${mergeBase}...HEAD`])
        .split(/\r?\n/)
        .map((changedPath) => changedPath.trim())
        .filter((changedPath) => changedPath.length > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${baseRef}: ${message}`);
    }
  }

  throw new Error(`Could not read PR changed paths: ${failures.join("; ")}`);
}

function execGit(args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readProjectDoc(docPath: string): string {
  const absoluteDocPath = join(projectRoot, docPath);
  if (existsSync(absoluteDocPath)) {
    return readFileSync(absoluteDocPath, "utf8");
  }

  const fixture = ignoredProjectDocFixture(docPath);
  if (fixture !== undefined) {
    return fixture;
  }

  throw new Error(`Could not read project doc ${docPath}`);
}

function ignoredProjectDocFixture(docPath: string): string | undefined {
  if (!modelSplitDocPaths.includes(docPath as (typeof modelSplitDocPaths)[number])) {
    return undefined;
  }

  const glossaryLines =
    docPath === "CONTEXT.md"
      ? [
          "- **Finding** - diff/code issue raised on a diff hunk.",
          "- **ComplianceGap** - project-level compliance output for an unmet control or missing evidence.",
        ]
      : [];

  return [
    `# ${docPath}`,
    IGNORED_PROJECT_DOC_FIXTURE_MARKER,
    ...glossaryLines,
    modelSplitStatements.sourceModel,
    modelSplitStatements.complianceGapOutput,
    modelSplitStatements.prProjection,
    `${activeImplementationStatements.mat77IsSupersededByMat113}.`,
    supersessionStatements.mat113SupersedesMat77,
    traceabilityStatements.mat77Superseded,
    traceabilityStatements.mat113RulesEngine,
    `- ${issueScopeStatements.mat112ReviewOutputContract} scoped to ${issueModelStatements.prReviewOutput}.`,
    `- ${issueScopeStatements.mat113RulesEngineImplementationWork}.`,
    `- ${issueScopeStatements.mat113ProjectComplianceRulesEngineWork} for ${issueModelStatements.coreModel}.`,
  ].join("\n");
}

function findDefinitionLines(
  docs: string,
  term: string,
  options: { glossaryOnly?: boolean } = {},
): string[] {
  const definitionMarker = `**${term.toLowerCase()}**`;
  const glossaryDefinitionPrefixes = [`- ${definitionMarker}`, `* ${definitionMarker}`];

  return docs.split(/\r?\n/).filter((line) => {
    const normalizedLine = line.trimStart().toLowerCase();
    return options.glossaryOnly === true
      ? glossaryDefinitionPrefixes.some((prefix) => normalizedLine.startsWith(prefix))
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
    _docs.includes(activeMat77Statement()) ||
    activeImplementationWorkBlocks(_docs).some((block) =>
      block.includes(supersessionStatements.mat77),
    );
  const hasMat77SupersededByMat113 =
    _docs.includes(activeImplementationStatements.mat77IsSupersededByMat113) ||
    _docs.includes(supersessionStatements.mat113SupersedesMat77);
  const hasMat113RulesEngineHistory = _docs.includes(traceabilityStatements.mat113RulesEngine);
  const hasMat77History = _docs.includes("MAT-77");

  if (hasActiveMat77) {
    failureMessages.push(activeImplementationStatements.mat77StillActiveFailure);
  }

  if (!hasActiveMat77 && _docs.includes("MAT-77") && !hasMat77SupersededByMat113) {
    failureMessages.push(activeImplementationStatements.missingMat77SupersessionFailure);
  }

  if (hasMat113RulesEngineHistory && !hasMat77History) {
    failureMessages.push(activeImplementationStatements.missingMat77HistoryFailure);
  }

  return failureMessages;
}

function activeImplementationWorkBlocks(docs: string): string[] {
  const lines = docs.split(/\r?\n/);
  const blocks: string[] = [];

  for (const [index, line] of lines.entries()) {
    if (!isActiveImplementationWorkHeading(line)) {
      continue;
    }

    const blockLines = [line];
    for (const nextLine of lines.slice(index + 1)) {
      const trimmedLine = nextLine.trim();
      if (
        trimmedLine.length === 0 ||
        trimmedLine.startsWith("#") ||
        (!trimmedLine.startsWith("-") &&
          !trimmedLine.startsWith("*") &&
          indentationLength(nextLine) === 0)
      ) {
        break;
      }

      blockLines.push(nextLine);
    }

    blocks.push(blockLines.join("\n"));
  }

  return blocks;
}

function isActiveImplementationWorkHeading(line: string): boolean {
  const normalizedLine = line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/:$/, "")
    .toLowerCase();

  return normalizedLine === "active compliance implementation work";
}

function issueScopeFailureMessages(_docs: string): string[] {
  const normalizedDocs = _docs.toLowerCase();
  const failureMessages: string[] = [];
  const mat112ClaimsCoreModel = normalizedDocs.includes(
    issueScopeStatements.mat112CoreDomainModel.toLowerCase(),
  );
  const mat113IdentifiesProjectComplianceRulesEngine =
    normalizedDocs.includes(
      issueScopeStatements.mat113ProjectComplianceRulesEngineWork.toLowerCase(),
    ) || normalizedDocs.includes(traceabilityStatements.mat113RulesEngine.toLowerCase());
  const mat112OutputContractEntryIsMissing = !normalizedDocs.includes(
    issueScopeStatements.mat112ReviewOutputContract.toLowerCase(),
  );

  if (mat112ClaimsCoreModel) {
    failureMessages.push(issueScopeStatements.mat112OutputContractFailure);
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
  const { sourceChanged, snapshotChanged } = snapshotChangeState(input);

  return sourceChanged && !snapshotChanged && canTrackSnapshotChange(input.snapshotPath)
    ? [formatStaleSnapshotFailure(input)]
    : [];
}

function snapshotChangeState(input: {
  changedPaths: readonly string[];
  sourcePath: string;
  snapshotPath: string;
}): { sourceChanged: boolean; snapshotChanged: boolean } {
  return {
    sourceChanged: hasChangedPath(input.changedPaths, input.sourcePath),
    snapshotChanged: hasChangedPath(input.changedPaths, input.snapshotPath),
  };
}

function snapshotSyncFailureMessages(input: {
  changedPaths: readonly string[];
  sourcePath: string;
  snapshotPath: string;
  docsByPath: Readonly<Record<string, string>>;
}): string[] {
  const { sourceChanged, snapshotChanged } = snapshotChangeState(input);
  const failureMessages = staleSnapshotFailureMessages(input);
  if (!sourceChanged && !snapshotChanged) {
    return failureMessages;
  }

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
  const normalizedDocs = docs.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  let searchIndex = 0;

  for (;;) {
    const termIndex = normalizedDocs.indexOf(normalizedTerm, searchIndex);
    if (termIndex === -1) {
      return false;
    }

    const previousCharacter = characterAtIndex(normalizedDocs, termIndex - 1);
    const nextCharacter = characterAtIndex(normalizedDocs, termIndex + normalizedTerm.length);
    if (isVocabularyBoundary(previousCharacter) && isVocabularyBoundary(nextCharacter)) {
      return true;
    }

    searchIndex = termIndex + 1;
  }
}

function characterAtIndex(input: string, index: number): string | undefined {
  return index >= 0 && index < input.length ? input[index] : undefined;
}

function isVocabularyBoundary(character: string | undefined): boolean {
  return character === undefined || !isAsciiLetterOrDigit(character);
}

function isAsciiLetterOrDigit(character: string): boolean {
  const codePoint = character.codePointAt(0);

  return (
    codePoint !== undefined &&
    ((codePoint >= 48 && codePoint <= 57) ||
      (codePoint >= 65 && codePoint <= 90) ||
      (codePoint >= 97 && codePoint <= 122))
  );
}

function syncedSnapshotDocs(
  sourcePath: string,
  snapshotPath: string,
): Readonly<Record<string, string>> {
  const sourceDocs = readProjectDoc(sourcePath);

  return {
    [sourcePath]: sourceDocs,
    [snapshotPath]: readSnapshotDoc(snapshotPath, sourceDocs, {
      changedPaths: pullRequestChangedPaths,
      sourcePath,
    }),
  };
}

type SnapshotFixtureOptions = {
  readonly changedPaths?: readonly string[];
  readonly sourcePath?: string;
};

function readSnapshotDoc(
  snapshotPath: string,
  sourceDocs: string,
  options: SnapshotFixtureOptions = {},
): string {
  if (shouldUseSnapshotFixtureFallback({ snapshotPath, sourceDocs, ...options })) {
    return snapshotVocabularyFixtureDoc(snapshotPath, sourceDocs);
  }

  const absoluteSnapshotPath = snapshotAbsolutePath(snapshotPath);

  try {
    return readFileSync(absoluteSnapshotPath, "utf8");
  } catch (error) {
    if (
      isNotFoundError(error) &&
      shouldUseSnapshotFixtureFallback({ snapshotPath, sourceDocs, ...options })
    ) {
      return snapshotVocabularyFixtureDoc(snapshotPath, sourceDocs);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read snapshot doc ${snapshotPath}: ${message}`, { cause: error });
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function shouldUseSnapshotFixtureFallback(input: {
  readonly changedPaths?: readonly string[];
  readonly snapshotPath: string;
  readonly sourceDocs: string;
  readonly sourcePath?: string;
}): boolean {
  return (
    isConfiguredSnapshotDocPath(input.snapshotPath) &&
    !existsSync(dirname(snapshotAbsolutePath(input.snapshotPath))) &&
    (hasValidIgnoredProjectDocFixtureMarker(input.sourceDocs) ||
      isChangedConfiguredSourceDoc(input.sourcePath, input.changedPaths))
  );
}

function hasValidIgnoredProjectDocFixtureMarker(sourceDocs: string): boolean {
  return sourceDocs
    .split(/\r?\n/)
    .slice(0, 10)
    .some((line) => line.trim() === IGNORED_PROJECT_DOC_FIXTURE_MARKER);
}

function isChangedConfiguredSourceDoc(
  sourcePath: string | undefined,
  changedPaths: readonly string[] | undefined,
): boolean {
  return (
    sourcePath !== undefined &&
    changedPaths !== undefined &&
    modelSplitDocPaths.includes(sourcePath) &&
    hasChangedPath(changedPaths, sourcePath)
  );
}

function canTrackSnapshotChange(snapshotPath: string): boolean {
  const resolvedSnapshotPath = resolve(projectRoot, snapshotPath);

  return resolvedSnapshotPath === projectRoot || resolvedSnapshotPath.startsWith(`${projectRoot}/`);
}

function snapshotAbsolutePath(snapshotPath: string): string {
  if (!isConfiguredSnapshotDocPath(snapshotPath)) {
    return join(projectRoot, snapshotPath);
  }

  return join(snapshotDocsRoot(), snapshotPath.slice(`${snapshotRootPath}/`.length));
}

function snapshotDocsRoot(): string {
  return resolve(projectRoot, process.env[SOVRI_DOCS_SNAPSHOT_ROOT_ENV] ?? snapshotRootPath);
}

function withSnapshotDocsRoot<T>(snapshotDocsRootPath: string, operation: () => T): T {
  const previousSnapshotRoot = process.env[SOVRI_DOCS_SNAPSHOT_ROOT_ENV];
  process.env[SOVRI_DOCS_SNAPSHOT_ROOT_ENV] = snapshotDocsRootPath;

  try {
    return operation();
  } finally {
    if (previousSnapshotRoot === undefined) {
      delete process.env[SOVRI_DOCS_SNAPSHOT_ROOT_ENV];
    } else {
      process.env[SOVRI_DOCS_SNAPSHOT_ROOT_ENV] = previousSnapshotRoot;
    }
  }
}

function isConfiguredSnapshotDocPath(snapshotPath: string): boolean {
  return snapshotPath.startsWith(`${snapshotRootPath}/`);
}

function snapshotVocabularyFixtureDoc(snapshotPath: string, sourceDocs: string): string {
  const heading = `# ${basename(snapshotPath)}`;
  const sourceVocabulary = snapshotVocabularyTermSet(sourceDocs);
  const vocabularyLines = snapshotVocabularyTerms()
    .filter((term) => sourceVocabulary.has(term))
    .map((term) => `- ${term}`);

  return [
    heading,
    "",
    "## Compliance pivot vocabulary",
    "",
    "This CI fixture mirrors the compliance pivot vocabulary from the ignored source document.",
    "",
    ...vocabularyLines,
    "",
    "## Snapshot scope",
    "",
    `- Source fixture: ${IGNORED_PROJECT_DOC_FIXTURE_MARKER}`,
    `- Snapshot target: ${snapshotPath}`,
  ].join("\n");
}

function adrIndexFailureMessages(_input: {
  indexMarkdown: string;
  adrPath: string;
  adrTitle: string;
}): string[] {
  const failureMessages = adrIndexTableFailureMessages(_input.indexMarkdown);
  const matchingAdrRow = findAdrIndexRow(_input.indexMarkdown, _input.adrPath);

  if (matchingAdrRow === undefined) {
    failureMessages.push(`${_input.adrPath} is unlisted`);
  } else if (!markdownTableCells(matchingAdrRow).includes(_input.adrTitle)) {
    failureMessages.push(`${_input.adrPath} title is missing: ${_input.adrTitle}`);
  }

  return failureMessages;
}

function adrIndexTableFailureMessages(indexMarkdown: string): string[] {
  const failureMessages: string[] = [];
  const tableRows = markdownTableRows(indexMarkdown);
  const headerRowIndex = tableRows.findIndex((line) => markdownTableCells(line)[0] === "#");
  const headerRow = headerRowIndex === -1 ? undefined : tableRows[headerRowIndex];
  const headerColumnCount = headerRow === undefined ? 4 : markdownTableCells(headerRow).length;
  const separatorCells =
    headerRowIndex === -1 ? [] : markdownTableCells(tableRows[headerRowIndex + 1] ?? "");
  const separatorAlignments = separatorCells.map(markdownTableSeparatorAlignment);
  const dataRows = tableRows.filter(isAdrIndexDataRow);

  if (
    separatorCells.length !== headerColumnCount ||
    separatorAlignments.some((alignment) => alignment === undefined)
  ) {
    failureMessages.push("ADR index header separator must use GitHub Markdown alignment markers");
  } else if (new Set(separatorAlignments).size > 1) {
    failureMessages.push("ADR index header separator cells must use consistent alignment");
  }

  for (const row of dataRows) {
    const cells = markdownTableCells(row);
    const status = cells[2] ?? "";
    const date = cells[3] ?? "";

    if (!row.startsWith("| [")) {
      failureMessages.push("ADR index rows must start at column 1 with a linked ADR id");
    }

    if (cells.length !== headerColumnCount) {
      failureMessages.push("ADR index rows must match the table header column count");
    }

    if (cells.length !== 4) {
      failureMessages.push("ADR index rows must have exactly 4 columns");
      continue;
    }

    if (!ADR_INDEX_STATUS_PATTERN.test(status)) {
      failureMessages.push(`ADR index row has unsupported status: ${status}`);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      failureMessages.push("ADR index row must have an ISO date");
    }
  }

  return failureMessages;
}

function findAdrIndexRow(indexMarkdown: string, adrPath: string): string | undefined {
  const relativeAdrPath = `./${basename(adrPath)}`;

  return markdownTableRows(indexMarkdown)
    .filter(isAdrIndexDataRow)
    .find((row) => (markdownTableCells(row)[0] ?? "").includes(`](${relativeAdrPath})`));
}

function markdownTableRows(indexMarkdown: string): string[] {
  return indexMarkdown.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
}

function markdownTableCells(row: string): string[] {
  return row
    .trim()
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isAdrIndexDataRow(row: string): boolean {
  return /^\[\d{3}\]\(\.\/\d{3}-.+\.md\)$/.test(markdownTableCells(row)[0] ?? "");
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}

type MarkdownTableAlignment = "center" | "default" | "left" | "right";

function markdownTableSeparatorAlignment(cell: string): MarkdownTableAlignment | undefined {
  if (!isMarkdownTableSeparatorCell(cell)) {
    return undefined;
  }

  if (cell.startsWith(":") && cell.endsWith(":")) {
    return "center";
  }

  if (cell.startsWith(":")) {
    return "left";
  }

  return cell.endsWith(":") ? "right" : "default";
}

describe("MAT-80 compliance pivot vocabulary docs", () => {
  it("defines each required project-level compliance term explicitly", () => {
    // When the compliance vocabulary is reviewed
    const docs = readDocs();
    const pivotAdr = readPivotAdr();
    const contractAuthorityPath = join(adrDocsRoot, contractSource.authorityPath);

    expect(pivotAdr, "pivot ADR must have the expected title").toContain(
      `# ADR-${adrNumberFromPath(pivotAdrIndexExample.adrPath)} - ${pivotAdrIndexExample.adrTitle}`,
    );
    expect(pivotAdr, "pivot ADR must be accepted").toContain("**Status:** Accepted");
    expect(pivotAdr, "pivot ADR must explain context").toContain("## Context");
    expect(pivotAdr, "pivot ADR must record the decision").toContain("## Decision");
    expect(pivotAdr, "pivot ADR must record consequences").toContain("## Consequences");
    expect(
      existsSync(contractAuthorityPath),
      "contract authority path must exist beside the ADR docs",
    ).toBe(true);
    expect(
      pivotAdr,
      "contract authority must be the ADR that defines the compliance pivot vocabulary",
    ).toContain(`# ADR-${adrNumberFromPath(contractAuthorityPath)}`);
    expect(
      contractSource.updateRule,
      "contract update rule must require vocabulary changes and contract changes to stay together",
    ).toContain("same PR");
    expect(
      findingCategoryFailureMessages(docs),
      `${complianceGapFindingCategoryMisuse.term} must not be documented as a Finding category`,
    ).toEqual([]);

    for (const term of requiredDefinitionTerms) {
      const definitionLines = findDefinitionLines(pivotAdr, term);

      expect(
        definitionLines,
        `${term} must have exactly one authoritative definition in the pivot ADR`,
      ).toHaveLength(1);

      const definitionText = definitionLines[0] ?? "";
      const normalizedDefinitionText = definitionText.toLowerCase();

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

  it("validates the compliance pivot contract schema before docs checks use it", () => {
    const validResult = CompliancePivotContractSchema.safeParse(compliancePivotContract);

    expect(validResult.success, "current compliance pivot contract must match its schema").toBe(
      true,
    );

    const invalidResult = CompliancePivotContractSchema.safeParse({
      ...compliancePivotContract,
      contractSource: {
        ...compliancePivotContract.contractSource,
        authorityPath: "022-project-level-compliance-pivot",
      },
      requiredDefinitionTerms: ["ComplianceGap", "compliancegap"],
      requiredProjectLevelTerms: ["ControlResult", "ControlResult"],
      snapshotDocPairs: [
        {
          sourcePath: "UNKNOWN.md",
          snapshotPath: "PRD.md",
        },
      ],
    });

    expect(invalidResult.success, "invalid contract fixture must fail schema validation").toBe(
      false,
    );
    if (invalidResult.success) {
      throw new Error("Invalid compliance pivot contract fixture unexpectedly passed validation");
    }

    expect(
      invalidResult.error.issues.map((issue) => issue.path.join(".")),
      "schema validation must report invalid authority and snapshot pair paths",
    ).toEqual(
      expect.arrayContaining([
        "contractSource.authorityPath",
        "requiredDefinitionTerms.1",
        "requiredProjectLevelTerms.1",
        "snapshotDocPairs.0.sourcePath",
        "snapshotDocPairs.0.snapshotPath",
      ]),
    );
    expect(
      () => assertUniqueContractTerms("requiredDefinitionTerms", ["Control", "control"]),
      "runtime contract validation must reject duplicate vocabulary terms",
    ).toThrow("duplicate term control");
    expect(
      () => validateExistingSnapshotRoot("."),
      "existing snapshot roots must be readable and writable",
    ).not.toThrow();
    expect(
      () => validateExistingSnapshotRoot("docs/adr/compliance-pivot-contract.json"),
      "snapshot root must be a directory when it exists",
    ).toThrow("not a directory");
    expect(
      () => validateContractAuthorityPath(contractSource.authorityPath),
      "contract authority path must resolve to a readable ADR file",
    ).not.toThrow();
    expect(
      () => validateContractAuthorityPath("__missing-authority__.md"),
      "contract authority path must exist",
    ).toThrow("does not exist");
    expect(
      () => validateContractAuthorityPath("."),
      "contract authority path must be a file",
    ).toThrow("not a file");

    const [firstSnapshotPair, secondSnapshotPair, ...remainingSnapshotPairs] = snapshotDocPairs;
    if (firstSnapshotPair === undefined || secondSnapshotPair === undefined) {
      throw new Error("Contract fixture must define at least two snapshot pairs");
    }

    const missingSnapshotPairResult = CompliancePivotContractSchema.safeParse({
      ...compliancePivotContract,
      snapshotDocPairs: snapshotDocPairs.slice(1),
    });
    expect(
      missingSnapshotPairResult.success,
      "contract must cover every configured model split document with a snapshot pair",
    ).toBe(false);
    if (missingSnapshotPairResult.success) {
      throw new Error("Missing snapshot pair fixture unexpectedly passed validation");
    }
    expect(missingSnapshotPairResult.error.issues.map((issue) => issue.path.join("."))).toContain(
      "snapshotDocPairs",
    );

    const duplicateSnapshotPairResult = CompliancePivotContractSchema.safeParse({
      ...compliancePivotContract,
      snapshotDocPairs: [
        firstSnapshotPair,
        { ...secondSnapshotPair, sourcePath: firstSnapshotPair.sourcePath },
        ...remainingSnapshotPairs,
      ],
    });
    expect(
      duplicateSnapshotPairResult.success,
      "contract must reject duplicate snapshot pair source paths",
    ).toBe(false);
    if (duplicateSnapshotPairResult.success) {
      throw new Error("Duplicate snapshot pair fixture unexpectedly passed validation");
    }
    expect(duplicateSnapshotPairResult.error.issues.map((issue) => issue.path.join("."))).toContain(
      "snapshotDocPairs.1.sourcePath",
    );
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

  it("finds glossary definitions that use either Markdown list marker", () => {
    const docs = [
      "# Glossary",
      "- **Finding** - diff/code issue.",
      "* **ComplianceGap** - project-level compliance output.",
    ].join("\n");

    expect(findDefinitionLines(docs, "Finding", { glossaryOnly: true })).toHaveLength(1);
    expect(findDefinitionLines(docs, "ComplianceGap", { glossaryOnly: true })).toHaveLength(1);
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

  it("fails when Markdown-formatted ComplianceGap is documented as a Finding category", () => {
    const docs = ["# ADR-022", "`ComplianceGap` is a Finding category emitted by PR review"].join(
      "\n",
    );

    const failureMessages = findingCategoryFailureMessages(docs);

    expect(
      failureMessages,
      "finding-category misuse check must catch code-formatted ComplianceGap",
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
    expect(
      findingCategoryFailureMessages(docs),
      `${docPath} must not document ComplianceGap as a Finding category`,
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
    const docs = readDocs();
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
    const docs = readDocs();

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
      `- ${issueScopeStatements.mat113RulesEngineImplementationWork}`,
    ].join("\n");

    expect(docs, "fixture must put MAT-112 in the core domain model role").toContain(
      issueScopeStatements.mat112CoreDomainModel,
    );

    // And the docs identify "MAT-113" as the rules engine implementation work
    expect(docs, "fixture must include MAT-113 as the rules engine implementation work").toContain(
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
      issueScopeFailureMessages(readDocs()),
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
      issueScopeFailureMessages(readDocs()),
      "project docs must include MAT-112 in the output contract map",
    ).toEqual([]);
  });

  it.each(snapshotDocPairs)(
    "checks snapshot vocabulary against the real PR change set when %s changes",
    ({ sourcePath, snapshotPath }) => {
      // Given the real pull request change set is reviewed
      const changedPaths = pullRequestChangedPaths;
      const docsByPath = syncedSnapshotDocs(sourcePath, snapshotPath);
      if (docsByPath[sourcePath]?.includes(IGNORED_PROJECT_DOC_FIXTURE_MARKER)) {
        expect(
          docsByPath[snapshotPath],
          "CI fixture snapshots must not mirror source docs verbatim",
        ).not.toBe(docsByPath[sourcePath]);
      }

      // When the documentation sync is reviewed
      const failureMessages = snapshotSyncFailureMessages({
        changedPaths,
        sourcePath,
        snapshotPath,
        docsByPath,
      });

      // Then changed snapshot/source pairs carry the same compliance pivot vocabulary
      expect(
        failureMessages,
        `${snapshotPath} must contain the source compliance vocabulary`,
      ).toEqual([]);
    },
  );

  it("fails when a real snapshot directory exists but an expected snapshot file is missing", () => {
    // Given the snapshot directory exists
    const snapshotPath = "docs/__missing-compliance-pivot-snapshot__.md";
    const snapshotDir = join(projectRoot, dirname(snapshotPath));
    expect(existsSync(snapshotDir), "fixture snapshot directory must exist").toBe(true);

    // When a required snapshot file is missing inside it
    const readMissingSnapshot = () =>
      readSnapshotDoc(snapshotPath, modelSplitStatements.sourceModel);

    // Then the real snapshot verification fails instead of fabricating a fixture
    expect(readMissingSnapshot).toThrow(`Could not read snapshot doc ${snapshotPath}:`);
  });

  it("generates snapshot fixtures only for configured CI fixture sources", () => {
    const snapshotPath = `${snapshotRootPath}/PRD.md`;
    const sourceDocs = [
      IGNORED_PROJECT_DOC_FIXTURE_MARKER,
      modelSplitStatements.sourceModel,
      modelSplitStatements.complianceGapOutput,
    ].join("\n");

    const fixture = withSnapshotDocsRoot("../__missing-sovri-docs-fixture-root__", () =>
      readSnapshotDoc(snapshotPath, sourceDocs),
    );

    expect(fixture, "generated snapshot fixture must explain its scope").toContain(
      "## Compliance pivot vocabulary",
    );
    expect(fixture, "generated snapshot fixture must preserve the snapshot target").toContain(
      `- Snapshot target: ${snapshotPath}`,
    );
  });

  it("generates snapshot fixtures for changed source docs when the sibling checkout is absent", () => {
    const snapshotPath = `${snapshotRootPath}/PRD.md`;
    const sourceDocs = [
      "# PRD.md",
      modelSplitStatements.sourceModel,
      modelSplitStatements.complianceGapOutput,
    ].join("\n");

    expect(sourceDocs, "fixture must model a real source doc without the CI marker").not.toContain(
      IGNORED_PROJECT_DOC_FIXTURE_MARKER,
    );

    const fixture = withSnapshotDocsRoot("../__missing-sovri-docs-fixture-root__", () =>
      readSnapshotDoc(snapshotPath, sourceDocs, {
        changedPaths: ["PRD.md"],
        sourcePath: "PRD.md",
      }),
    );

    expect(fixture, "changed source docs must still run vocabulary parity in CI").toContain(
      modelSplitStatements.sourceModel,
    );
    expect(fixture, "generated snapshot fixture must preserve the snapshot target").toContain(
      `- Snapshot target: ${snapshotPath}`,
    );
  });

  it("fails instead of fabricating a snapshot for malformed or unconfigured fixture inputs", () => {
    const malformedSourceDocs = [
      "<!-- missing CI fixture marker -->",
      modelSplitStatements.sourceModel,
    ].join("\n");
    const inlineMarkerSourceDocs = [
      `prefix ${IGNORED_PROJECT_DOC_FIXTURE_MARKER}`,
      modelSplitStatements.sourceModel,
    ].join("\n");
    const lateMarkerSourceDocs = [
      ...Array.from({ length: 10 }, (_unused, index) => `line ${index + 1}`),
      IGNORED_PROJECT_DOC_FIXTURE_MARKER,
      modelSplitStatements.sourceModel,
    ].join("\n");

    const readMalformedConfiguredSnapshot = () =>
      withSnapshotDocsRoot("../__missing-sovri-docs-fixture-root__", () =>
        readSnapshotDoc(`${snapshotRootPath}/PRD.md`, malformedSourceDocs),
      );
    const readInlineMarkerSnapshot = () =>
      withSnapshotDocsRoot("../__missing-sovri-docs-fixture-root__", () =>
        readSnapshotDoc(`${snapshotRootPath}/PRD.md`, inlineMarkerSourceDocs),
      );
    const readLateMarkerSnapshot = () =>
      withSnapshotDocsRoot("../__missing-sovri-docs-fixture-root__", () =>
        readSnapshotDoc(`${snapshotRootPath}/PRD.md`, lateMarkerSourceDocs),
      );
    const readUnconfiguredSnapshot = () =>
      readSnapshotDoc("../unexpected-docs/PRD.md", ignoredProjectDocFixture("PRD.md") ?? "");

    expect(readMalformedConfiguredSnapshot).toThrow(
      `Could not read snapshot doc ${snapshotRootPath}/PRD.md:`,
    );
    expect(readInlineMarkerSnapshot).toThrow(
      `Could not read snapshot doc ${snapshotRootPath}/PRD.md:`,
    );
    expect(readLateMarkerSnapshot).toThrow(
      `Could not read snapshot doc ${snapshotRootPath}/PRD.md:`,
    );
    expect(readUnconfiguredSnapshot).toThrow(
      "Could not read snapshot doc ../unexpected-docs/PRD.md:",
    );
  });

  it("allows the sibling snapshot checkout root to be configured", () => {
    withSnapshotDocsRoot("../custom-sovri-docs", () => {
      expect(snapshotAbsolutePath(`${snapshotRootPath}/PRD.md`)).toBe(
        join(resolve(projectRoot, "../custom-sovri-docs"), "PRD.md"),
      );
    });
  });

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

  it("detects vocabulary terms only at explicit text boundaries", () => {
    expect(containsVocabularyTerm("Control.", "Control"), "punctuation must end a term").toBe(true);
    expect(containsVocabularyTerm("(Control)", "Control"), "punctuation must wrap a term").toBe(
      true,
    );
    expect(
      containsVocabularyTerm("ControlResult", "Control"),
      "overlapping terms must not satisfy shorter terms",
    ).toBe(false);
    expect(
      containsVocabularyTerm("preControl", "Control"),
      "prefix text must not start a term",
    ).toBe(false);
    expect(containsVocabularyTerm("Control2", "Control"), "suffix digits must not end a term").toBe(
      false,
    );
    expect(containsVocabularyTerm("MAT-112.", "MAT-112"), "punctuation must end an issue id").toBe(
      true,
    );
    expect(
      containsVocabularyTerm("XMAT-112", "MAT-112"),
      "prefix text must not start an issue id",
    ).toBe(false);
    expect(
      containsVocabularyTerm("compliancegap", "ComplianceGap"),
      "term matching must tolerate casing drift while reporting canonical terms",
    ).toBe(true);
  });

  it.each(snapshotDocPairs)(
    "does not require external snapshot %s to appear in the repo change set",
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

      // Then this repo does not require a sibling-repo path in the local Git diff
      expect(failureMessages, "external snapshot paths are verified by content parity").toEqual([]);
    },
  );

  it("fails when a tracked source doc changes without its tracked snapshot", () => {
    // Given the compliance pivot change modifies a tracked source doc
    const sourcePath = "docs/source.md";
    const snapshotPath = "docs/source.snapshot.md";
    const changedPaths = [sourcePath] as const;

    // When the tracked snapshot is omitted from the same repo change set
    const failureMessages = staleSnapshotFailureMessages({
      changedPaths,
      sourcePath,
      snapshotPath,
    });

    // Then the snapshot sync check fails
    expect(failureMessages.length, "snapshot sync check must fail").toBeGreaterThan(0);

    // And the failure identifies the tracked snapshot as stale
    expect(
      failureMessages.join("\n"),
      "snapshot sync failure must identify the stale snapshot path",
    ).toContain(`${snapshotPath} is stale`);
  });

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

  it.each(changedAdrIndexEntries())(
    "lists changed ADR $adrPath in the ADR index",
    ({ adrPath, adrTitle }) => {
      // Given the pull request changes ADR markdown "<adr_path>"
      const changedAdr = { adrPath, adrTitle } as const;

      // When the ADR index is reviewed
      const failureMessages = adrIndexFailureMessages({
        indexMarkdown: readAdrIndex(),
        adrPath: changedAdr.adrPath,
        adrTitle: changedAdr.adrTitle,
      });

      // Then "docs/adr/README.md" lists "<adr_path>"
      // And "docs/adr/README.md" lists the parsed ADR title "<adr_title>"
      expect(
        failureMessages,
        `ADR index must list changed ADR ${changedAdr.adrPath} and ${changedAdr.adrTitle}`,
      ).toEqual([]);
    },
  );

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

  it("fails when an ADR index link and title are not in the same row", () => {
    const adrPath = "docs/adr/022-project-level-compliance-pivot.md";
    const adrTitle = "Project-level compliance pivot vocabulary";
    const indexMarkdown = [
      "# ADRs",
      "| # | Title | Status | Date |",
      "| --- | --- | --- | --- |",
      "| [022](./022-project-level-compliance-pivot.md) | Wrong title | Accepted | 2026-06-26 |",
      "",
      `See ${adrTitle} for the current pivot.`,
    ].join("\n");

    const failureMessages = adrIndexFailureMessages({
      indexMarkdown,
      adrPath,
      adrTitle,
    });

    expect(failureMessages).toContain(`${adrPath} title is missing: ${adrTitle}`);
  });

  it("fails when ADR index table rows are malformed", () => {
    // Given the ADR index contains indented, extra-column, invalid-status, and non-ISO-date rows
    const indexMarkdown = [
      "# ADRs",
      "| # | Title | Status | Date |",
      "| --- | --- | invalid | --- |",
      "  | [020](./020-deterministic-compliance-derivation.md) | Deterministic compliance derivation | Accepted | 2026-06-19 |",
      "\t| [019](./019-otel-milestone-v0-6.md) | OpenTelemetry instrumentation deferred to v0.6 (revises ADR-006) | Accepted | 2026-06-02 |",
      " \t| [018](./018-github-checks-output-surface.md) | GitHub Checks API as a bot output surface | Accepted | 2026-06-02 |",
      "| [021](./021-compliance-only-review-taxonomy.md) | Compliance-only review taxonomy and prompt | Accepted | 2026-06-24 | extra |",
      "|[023](./023-compact-row.md)|Compact row|Active|2026/06/27|",
      "| [022](./022-project-level-compliance-pivot.md) | Project-level compliance pivot vocabulary | Active | 2026/06/26 |",
    ].join("\n");

    // When the ADR index is reviewed
    const failureMessages = adrIndexFailureMessages({
      indexMarkdown,
      adrPath: "docs/adr/022-project-level-compliance-pivot.md",
      adrTitle: "Project-level compliance pivot vocabulary",
    });

    // Then the ADR index check reports structural table drift
    expect(
      failureMessages.filter(
        (message) => message === "ADR index rows must start at column 1 with a linked ADR id",
      ),
    ).toHaveLength(4);
    expect(failureMessages).toContain(
      "ADR index header separator must use GitHub Markdown alignment markers",
    );
    expect(failureMessages).toContain("ADR index rows must match the table header column count");
    expect(failureMessages).toContain("ADR index rows must have exactly 4 columns");
    expect(failureMessages).toContain("ADR index row has unsupported status: Active");
    expect(failureMessages).toContain("ADR index row must have an ISO date");
  });

  it("fails when ADR index table separator alignment is inconsistent", () => {
    const indexMarkdown = [
      "# ADRs",
      "| # | Title | Status | Date |",
      "| :--- | :---: | :--- | :--- |",
      "| [022](./022-project-level-compliance-pivot.md) | Project-level compliance pivot vocabulary | Accepted | 2026-06-26 |",
    ].join("\n");

    const failureMessages = adrIndexFailureMessages({
      indexMarkdown,
      adrPath: "docs/adr/022-project-level-compliance-pivot.md",
      adrTitle: "Project-level compliance pivot vocabulary",
    });

    expect(failureMessages).toContain(
      "ADR index header separator cells must use consistent alignment",
    );
  });

  it("keeps MAT-113 as the core domain model implementation reference", () => {
    // When the compliance pivot issue map is reviewed
    const docs = readDocs();
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
      `- ${activeMat77Statement()}`,
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

    // And the failure identifies "MAT-77" as still active
    expect(
      failureMessages.join("\n"),
      "issue history check must identify MAT-77 as still active",
    ).toContain(activeImplementationStatements.mat77StillActiveFailure);

    expect(
      issueHistoryFailureMessages(readDocs()),
      "project docs must not list MAT-77 as active without its supersession relationship",
    ).toEqual([]);
  });

  it("fails when active MAT-77 history also mentions the canonical supersession", () => {
    // Given the docs list "MAT-77" under active compliance implementation work
    const docs = [
      "# Compliance implementation history",
      "Active compliance implementation work:",
      `- ${activeMat77Statement()}`,
      `- ${supersessionStatements.mat113SupersedesMat77}`,
    ].join("\n");

    expect(docs, "fixture must list MAT-77 as active").toContain(activeMat77Statement());
    expect(docs, "fixture must use the canonical supersession wording").toContain(
      supersessionStatements.mat113SupersedesMat77,
    );

    // When the compliance pivot history is reviewed
    const failureMessages = issueHistoryFailureMessages(docs);

    // Then the issue history check still fails because MAT-77 must not remain active
    expect(failureMessages).toContain(activeImplementationStatements.mat77StillActiveFailure);
  });

  it("keeps superseded MAT-77 history separate from another active implementation block", () => {
    // Given the docs list active implementation work without MAT-77
    const docs = [
      "# Compliance implementation history",
      "Active compliance implementation work:",
      `- ${traceabilityStatements.mat113RulesEngine}`,
      "",
      "Supersession history:",
      `- ${traceabilityStatements.mat77Superseded}`,
      `- ${supersessionStatements.mat113SupersedesMat77}`,
    ].join("\n");

    expect(
      activeImplementationWorkBlocks(docs).join("\n"),
      "active block must omit MAT-77",
    ).not.toContain(supersessionStatements.mat77);
    expect(docs, "fixture must keep MAT-77 in supersession history").toContain(
      traceabilityStatements.mat77Superseded,
    );

    // When the compliance pivot history is reviewed
    const failureMessages = issueHistoryFailureMessages(docs);

    // Then the active-work check does not treat superseded history as active work
    expect(
      failureMessages,
      "superseded MAT-77 history must not fail the active-work guard",
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
    const docs = readDocs();

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
