// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

import { DiffSchema, FindingSchema, ReviewSchema, z } from "@sovri/core";

import {
  buildInlineComments,
  composeWalkthrough,
  renderAssessmentBlock,
} from "../walkthrough/index.js";
import { renderComplianceSection } from "../walkthrough/compliance.js";

export {
  validatePreviewFixtureAnonymization,
  type PreviewFixtureAnonymizationValidationResult,
  type PreviewFixtureAnonymizationViolation,
} from "./anonymization.js";

const TokensUsedSchema = z
  .object({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
  })
  .strict();

const JsonReviewSchema = z
  .object({
    id: z.uuid(),
    pr_number: z.number().int().positive(),
    repo_full_name: z.string(),
    commit_sha: z.string(),
    started_at: z.iso.datetime(),
    completed_at: z.iso.datetime(),
    llm_provider: z.string(),
    llm_model: z.string(),
    tokens_used: TokensUsedSchema,
    token_usage_reported: z.boolean().optional(),
    summary: z.string(),
    findings: z.array(FindingSchema),
    walkthrough_markdown: z.string(),
    status: z.enum(["success", "partial", "failed"]),
    error: z.string().optional(),
  })
  .strict()
  .transform((review) =>
    ReviewSchema.parse({
      ...review,
      started_at: new Date(review.started_at),
      completed_at: new Date(review.completed_at),
    }),
  );

const PromptSha256Pattern = /^[a-f0-9]{64}$/u;

const PreviewComplianceProvenanceSchema = z
  .object({
    llmProvider: z.string().trim().min(1),
    llmModel: z.string().trim().min(1),
    providerKey: z.string().trim().min(1).optional(),
    promptSha256: z.string().regex(PromptSha256Pattern).optional(),
    hostingRegion: z.string().trim().min(1).optional(),
    dataResidency: z.string().trim().min(1).optional(),
    signedAuditEntry: z.string().trim().min(1).optional(),
  })
  .strict();

const PreviewFixtureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("summary"),
      review: JsonReviewSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("assessment"),
      findings: z.array(FindingSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("inline"),
      findings: z.array(FindingSchema),
      diff: DiffSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provenance"),
      findings: z.array(FindingSchema),
      provenance: PreviewComplianceProvenanceSchema,
    })
    .strict(),
]);

export type PreviewFixture = z.infer<typeof PreviewFixtureSchema>;

const PreviewFixtureCatalogEntrySchema = z
  .object({
    shape: z.string().trim().min(1),
    fixture: z.string().trim().min(1),
    golden: z.string().trim().min(1),
  })
  .strict();

const PreviewFixtureCatalogSchema = z.array(PreviewFixtureCatalogEntrySchema);
const AvailableGoldenFilesSchema = z.array(z.string().trim().min(1));
const AvailableFixtureFilesSchema = z.array(z.string().trim().min(1));

interface PreviewFixtureCatalogValidationResult {
  readonly ok: boolean;
  readonly missingGoldenFiles: readonly string[];
}

export type PreviewHtmlTheme = "light" | "dark";

export interface PreviewHtmlSection {
  readonly title: string;
  readonly markdown: string;
}

export interface RenderPreviewHtmlRequest {
  readonly sections: readonly PreviewHtmlSection[];
  readonly theme: PreviewHtmlTheme;
}

export interface PreviewThemeRootValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface PreviewMarkdownPayloadValidationResult {
  readonly ok: boolean;
  readonly forbiddenFragments: readonly string[];
}

export interface PreviewRenderedOutputValidationResult {
  readonly ok: boolean;
  readonly forbiddenFragments: readonly string[];
}

/**
 * Reports whether preview fixture markdown still matches its stored golden snapshots.
 *
 * For example, if `summary.review.json` renders bytes that differ from
 * `summary.golden.md`, `requiredSnapshotUpdates` contains `summary.golden.md`.
 *
 * `requiredSnapshotUpdates` contains golden fixture file names whose stored bytes differ.
 */
export interface PreviewGoldenMarkdownValidationResult {
  readonly ok: boolean;
  readonly requiredSnapshotUpdates: readonly string[];
}

/**
 * Supplies rendered fixture markdown and stored golden bytes to snapshot validation.
 *
 * @example
 * const source: PreviewGoldenMarkdownSnapshotSource = {
 *   renderFixtureMarkdown: (fixtureName) => renderedFixtures.get(fixtureName) ?? "",
 *   loadGoldenMarkdown: (goldenName) => storedGoldens.get(goldenName) ?? "",
 * };
 */
export interface PreviewGoldenMarkdownSnapshotSource {
  readonly renderFixtureMarkdown: (fixtureName: string) => string;
  readonly loadGoldenMarkdown: (goldenName: string) => string;
}

export interface PreviewDeterminismValidationResult {
  readonly ok: boolean;
  readonly volatileFragments: readonly string[];
}

const HtmlEscapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const PreviewChromeStylesheet = [
  ".ghc { display: block; }",
  ".gh-light { color-scheme: light; }",
  ".gh-dark { color-scheme: dark; }",
].join("\n");

export const PreviewMarkdownForbiddenFragments: readonly string[] = [
  "class=",
  "style=",
  "<style>",
  ".ghc { display: block; }",
  ".gh-light { color-scheme: light; }",
  ".gh-dark { color-scheme: dark; }",
  "gh-chrome",
];

const PreviewVolatileFragments: readonly string[] = ["generated_at"];
const PreviewDevOnlyPublicExportName = "renderPreviewHtml";
const PreviewRenderedOutputForbiddenExpressions: readonly PreviewRenderedOutputForbiddenExpression[] =
  [
    {
      label: "ghp_",
      matches: (renderedPreview) => renderedPreview.includes("ghp_"),
    },
    {
      label: "gho_",
      matches: (renderedPreview) => renderedPreview.includes("gho_"),
    },
    {
      label: "ghu_",
      matches: (renderedPreview) => renderedPreview.includes("ghu_"),
    },
    {
      label: "ghs_",
      matches: (renderedPreview) => renderedPreview.includes("ghs_"),
    },
    {
      label: "ghr_",
      matches: (renderedPreview) => renderedPreview.includes("ghr_"),
    },
    {
      label: "github_pat_",
      matches: (renderedPreview) => renderedPreview.includes("github_pat_"),
    },
    {
      label: "sk-ant-",
      matches: (renderedPreview) => renderedPreview.includes("sk-ant-"),
    },
    {
      label: "x-hub-signature-256",
      matches: (renderedPreview) => renderedPreview.toLowerCase().includes("x-hub-signature-256"),
    },
    {
      label: "raw GitHub webhook payload body",
      matches: containsRawGitHubWebhookPayloadBody,
    },
  ];

interface PreviewRenderedOutputForbiddenExpression {
  readonly label: string;
  readonly matches: (renderedPreview: string) => boolean;
}

const RawGitHubWebhookPayloadSchema = z
  .object({
    action: z.unknown(),
    repository: z.unknown(),
    sender: z.unknown(),
  })
  .passthrough()
  // Recognize the webhook event shapes the bot subscribes to (pull_request and
  // issue_comment) by their event-specific payload keys, not pull_request alone.
  .refine((payload) => "pull_request" in payload || ("issue" in payload && "comment" in payload), {
    message: "missing recognized GitHub webhook event payload",
  });

class UnexpectedInlinePreviewCountError extends Error {
  public override readonly name = "UnexpectedInlinePreviewCountError";

  public constructor(renderedCount: number) {
    super(`inline preview fixture must render exactly one comment, rendered ${renderedCount}`);
  }
}

export class PreviewGoldenMarkdownSnapshotDriftError extends Error {
  public override readonly name = "PreviewGoldenMarkdownSnapshotDriftError";

  public constructor(requiredSnapshotUpdates: readonly string[]) {
    super(`preview golden markdown snapshots are outdated: ${requiredSnapshotUpdates.join(", ")}`);
  }
}

export class PreviewThemeRootDriftError extends Error {
  public override readonly name = "PreviewThemeRootDriftError";

  public constructor(theme: PreviewHtmlTheme, error: string) {
    super(`preview ${theme} theme root drift: ${error}`);
  }
}

export class PreviewDevOnlySurfaceError extends Error {
  public override readonly name = "PreviewDevOnlySurfaceError";

  public constructor(forbiddenExports: readonly string[]) {
    super(`preview dev-only exports must not be public: ${forbiddenExports.join(", ")}`);
  }
}

const PreviewGoldenMarkdownFileSource: PreviewGoldenMarkdownSnapshotSource = {
  renderFixtureMarkdown: renderPreviewFixtureMarkdown,
  loadGoldenMarkdown: loadTextFixture,
};

/**
 * Render a source fixture through the matching review-comment markdown path.
 */
export function renderPreviewFixtureMarkdown(fixtureName: string): string {
  const fixture = loadPreviewFixture(fixtureName);

  return ensureFinalNewline(renderPreviewFixture(fixture));
}

export function renderPreviewFixtureMarkdownTwice(fixtureName: string): readonly [string, string] {
  const fixture = loadPreviewFixture(fixtureName);
  const firstMarkdown = renderPreviewFixture(fixture);
  const secondMarkdown = renderPreviewFixture(fixture);

  return [firstMarkdown, secondMarkdown];
}

export function parsePreviewFixture(fixture: unknown): PreviewFixture {
  return PreviewFixtureSchema.parse(fixture);
}

export function parsePreviewFixtureJson(fixtureJson: string): PreviewFixture {
  const parsedFixture: unknown = JSON.parse(fixtureJson);

  return parsePreviewFixture(parsedFixture);
}

export function validatePreviewFixtureCatalog(
  catalog: readonly unknown[],
  availableGoldenFiles: readonly unknown[],
): PreviewFixtureCatalogValidationResult {
  const entries = PreviewFixtureCatalogSchema.parse(catalog);
  const available = new Set(AvailableGoldenFilesSchema.parse(availableGoldenFiles));
  const missingGoldenFiles = entries
    .map((entry) => entry.golden)
    .filter((golden) => !available.has(golden));

  return {
    ok: missingGoldenFiles.length === 0,
    missingGoldenFiles,
  };
}

/**
 * Validate that every preview catalog entry renders to the same bytes as its stored golden markdown.
 *
 * @param catalog - Preview fixture catalog entries to render and compare.
 * @returns A validation result containing golden file names that need snapshot updates.
 */
export function validatePreviewGoldenMarkdownSnapshots(
  catalog: readonly unknown[],
  snapshotSource: PreviewGoldenMarkdownSnapshotSource = PreviewGoldenMarkdownFileSource,
): PreviewGoldenMarkdownValidationResult {
  const requiredSnapshotUpdates = PreviewFixtureCatalogSchema.parse(catalog)
    .filter(
      (entry) =>
        !matchesPreviewGoldenSnapshotBytes(
          snapshotSource.renderFixtureMarkdown(entry.fixture),
          snapshotSource.loadGoldenMarkdown(entry.golden),
        ),
    )
    .map((entry) => entry.golden);

  return {
    ok: requiredSnapshotUpdates.length === 0,
    requiredSnapshotUpdates,
  };
}

/**
 * Throw when generated fixture markdown does not match stored golden markdown snapshots.
 */
export function assertPreviewGoldenMarkdownSnapshots(
  catalog: readonly unknown[],
  snapshotSource?: PreviewGoldenMarkdownSnapshotSource,
): void {
  const result = validatePreviewGoldenMarkdownSnapshots(catalog, snapshotSource);

  if (result.ok) {
    return;
  }

  throw new PreviewGoldenMarkdownSnapshotDriftError(result.requiredSnapshotUpdates);
}

export function matchesPreviewGoldenSnapshotBytes(
  renderedMarkdown: string,
  storedGoldenMarkdown: string,
): boolean {
  return renderedMarkdown === storedGoldenMarkdown;
}

export type ValidatePreviewGoldenMarkdownSnapshots = typeof validatePreviewGoldenMarkdownSnapshots;
export type AssertPreviewGoldenMarkdownSnapshots = typeof assertPreviewGoldenMarkdownSnapshots;
export type MatchesPreviewGoldenSnapshotBytes = typeof matchesPreviewGoldenSnapshotBytes;

export function buildPreviewFixtureSections(
  catalog: readonly unknown[],
  fixtureFileNames: readonly unknown[],
): readonly PreviewHtmlSection[] {
  const entries = PreviewFixtureCatalogSchema.parse(catalog);
  const availableFixtureFiles = new Set(AvailableFixtureFilesSchema.parse(fixtureFileNames));

  return entries
    .filter((entry) => availableFixtureFiles.has(entry.fixture))
    .map((entry) => ({
      title: entry.shape,
      markdown: renderPreviewFixtureMarkdown(entry.fixture),
    }));
}

export function renderPreviewHtml(request: RenderPreviewHtmlRequest): string {
  const themeClass = getPreviewThemeClass(request.theme);
  const sections = request.sections.map(renderPreviewHtmlSection).join("");

  return `<div class="ghc ${themeClass}">${renderPreviewStylesheet()}${sections}</div>`;
}

export function validatePreviewThemeRoot(
  rootClasses: string,
  expectedTheme?: PreviewHtmlTheme,
): PreviewThemeRootValidationResult {
  const classNames = new Set(rootClasses.split(/\s+/u).filter((className) => className.length > 0));

  if (expectedTheme !== undefined) {
    const expectedThemeClass = getPreviewThemeClass(expectedTheme);

    if (!classNames.has(expectedThemeClass)) {
      return {
        ok: false,
        error: `theme root for ${expectedTheme} preview must include "${expectedThemeClass}"`,
      };
    }
  }

  if (classNames.has("gh-light") && classNames.has("gh-dark")) {
    return {
      ok: false,
      error: 'theme root must not include both "gh-light" and "gh-dark"',
    };
  }

  return { ok: true };
}

export function assertPreviewThemeRoot(theme: PreviewHtmlTheme, rootClasses: string): void {
  const result = validatePreviewThemeRoot(rootClasses, theme);

  if (result.ok) {
    return;
  }

  throw new PreviewThemeRootDriftError(theme, result.error ?? "theme root is invalid");
}

export type AssertPreviewThemeRoot = typeof assertPreviewThemeRoot;

export function assertPreviewDevOnlySurface(publicExportNames: readonly string[]): void {
  const forbiddenExports = publicExportNames.filter(
    (exportName) => exportName === PreviewDevOnlyPublicExportName,
  );

  if (forbiddenExports.length === 0) {
    return;
  }

  throw new PreviewDevOnlySurfaceError(forbiddenExports);
}

export function validatePreviewDeterminism(
  renderedPreview: string,
): PreviewDeterminismValidationResult {
  const volatileFragments = PreviewVolatileFragments.filter((fragment) =>
    renderedPreview.includes(fragment),
  );

  return {
    ok: volatileFragments.length === 0,
    volatileFragments,
  };
}

/**
 * Validate posted preview markdown stays free of wrapper-only HTML/CSS fragments.
 */
export function validatePreviewMarkdownPayload(
  markdown: string,
): PreviewMarkdownPayloadValidationResult {
  const forbiddenFragments = PreviewMarkdownForbiddenFragments.filter((fragment) =>
    markdown.includes(fragment),
  );

  return {
    ok: forbiddenFragments.length === 0,
    forbiddenFragments,
  };
}

export function validatePreviewRenderedOutput(
  renderedPreview: string,
): PreviewRenderedOutputValidationResult {
  const forbiddenFragments = PreviewRenderedOutputForbiddenExpressions.flatMap(
    ({ label, matches }) => (matches(renderedPreview) ? [label] : []),
  );

  return {
    ok: forbiddenFragments.length === 0,
    forbiddenFragments,
  };
}

function containsRawGitHubWebhookPayloadBody(renderedPreview: string): boolean {
  const decoded = normalizePreviewJsonEntities(renderedPreview);

  return collectJsonObjectCandidates(decoded).some(isRawGitHubWebhookPayloadBody);
}

function collectJsonObjectCandidates(value: string): readonly string[] {
  const candidates: string[] = [];

  // Extract a balanced object independently from every `{`, so a malformed
  // prefix (such as an unclosed string) cannot desync the scan and hide a
  // later or nested webhook payload object.
  for (let index = 0; index < value.length; index += 1) {
    if (value.charAt(index) !== "{") {
      continue;
    }

    const candidate = extractBalancedJsonObject(value, index);

    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function extractBalancedJsonObject(value: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value.charAt(index);

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function isRawGitHubWebhookPayloadBody(value: string): boolean {
  try {
    const parsedCandidate: unknown = JSON.parse(value);

    return RawGitHubWebhookPayloadSchema.safeParse(parsedCandidate).success;
  } catch {
    return false;
  }
}

function normalizePreviewJsonEntities(value: string): string {
  return (
    value
      .replace(/&amp;quot;|&amp;#34;|&amp;#x22;|&quot;|&#34;|&#x22;/giu, '"')
      // Unescape backslash-escaped quotes so a webhook body serialized as a JSON
      // string value (the common logged form) still parses as a candidate object.
      .replace(/\\"/gu, '"')
  );
}

function renderPreviewFixture(fixture: PreviewFixture): string {
  switch (fixture.kind) {
    case "summary":
      return composeWalkthrough(fixture.review);
    case "assessment":
      return ["### Review assessment", "", ...renderAssessmentBlock(fixture.findings)].join("\n");
    case "inline":
      return renderInlinePreview(fixture);
    case "provenance":
      return renderProvenancePreview(fixture);
  }
}

/**
 * Match stored markdown snapshot files' final newline convention before raw-byte comparison.
 */
function ensureFinalNewline(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function renderPreviewStylesheet(): string {
  return `<style>${PreviewChromeStylesheet}</style>`;
}

function renderInlinePreview(
  fixture: Extract<PreviewFixture, { readonly kind: "inline" }>,
): string {
  const comments = buildInlineComments(fixture.findings, fixture.diff);
  const [comment] = comments;

  if (comment === undefined || comments.length !== 1) {
    throw new UnexpectedInlinePreviewCountError(comments.length);
  }

  return comment.body;
}

function renderProvenancePreview(
  fixture: Extract<PreviewFixture, { readonly kind: "provenance" }>,
): string {
  const provenance = {
    llmProvider: fixture.provenance.llmProvider,
    llmModel: fixture.provenance.llmModel,
    ...(fixture.provenance.promptSha256 === undefined
      ? {}
      : { promptSha256: fixture.provenance.promptSha256 }),
    ...(fixture.provenance.hostingRegion === undefined
      ? {}
      : { hostingRegion: fixture.provenance.hostingRegion }),
    ...(fixture.provenance.dataResidency === undefined
      ? {}
      : { dataResidency: fixture.provenance.dataResidency }),
    ...(fixture.provenance.signedAuditEntry === undefined
      ? {}
      : { signedAuditEntry: fixture.provenance.signedAuditEntry }),
  };

  return renderComplianceSection(fixture.findings, provenance).join("\n");
}

function getPreviewThemeClass(theme: PreviewHtmlTheme): "gh-light" | "gh-dark" {
  return theme === "light" ? "gh-light" : "gh-dark";
}

function renderPreviewHtmlSection(section: PreviewHtmlSection): string {
  const title = escapeHtml(section.title);
  const markdown = escapeHtml(section.markdown);

  return `<section><h2>${title}</h2><pre>${markdown}</pre></section>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => HtmlEscapes[character] ?? character);
}

function loadPreviewFixture(fixtureName: string): PreviewFixture {
  return parsePreviewFixtureJson(loadTextFixture(fixtureName));
}

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}
