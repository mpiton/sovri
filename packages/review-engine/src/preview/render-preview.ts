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

type PreviewFixture = z.infer<typeof PreviewFixtureSchema>;

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

class UnexpectedInlinePreviewCountError extends Error {
  public override readonly name = "UnexpectedInlinePreviewCountError";

  public constructor(renderedCount: number) {
    super(`inline preview fixture must render exactly one comment, rendered ${renderedCount}`);
  }
}

/**
 * Render a source fixture through the matching review-comment markdown path.
 */
export function renderPreviewFixtureMarkdown(fixtureName: string): string {
  const fixture = loadPreviewFixture(fixtureName);

  return renderPreviewFixture(fixture);
}

export function renderPreviewFixtureMarkdownTwice(fixtureName: string): readonly [string, string] {
  const fixture = loadPreviewFixture(fixtureName);
  const firstMarkdown = renderPreviewFixture(fixture);
  const secondMarkdown = renderPreviewFixture(fixture);

  return [firstMarkdown, secondMarkdown];
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

export function validatePreviewThemeRoot(rootClasses: string): PreviewThemeRootValidationResult {
  const classNames = new Set(rootClasses.split(/\s+/u).filter((className) => className.length > 0));

  if (classNames.has("gh-light") && classNames.has("gh-dark")) {
    return {
      ok: false,
      error: 'theme root must not include both "gh-light" and "gh-dark"',
    };
  }

  return { ok: true };
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
  return PreviewFixtureSchema.parse(JSON.parse(loadTextFixture(fixtureName)));
}

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}
