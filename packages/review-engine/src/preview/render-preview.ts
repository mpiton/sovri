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

function loadPreviewFixture(fixtureName: string): PreviewFixture {
  return PreviewFixtureSchema.parse(JSON.parse(loadTextFixture(fixtureName)));
}

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}
