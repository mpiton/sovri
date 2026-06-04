// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema, z, type Review } from "@sovri/core";

import { renderAssessmentBlock } from "./assessment.js";
import { renderComplianceSection } from "./compliance.js";
import { renderCostFooter } from "./cost.js";
import { renderPipelineFlow } from "./flow.js";
import { formatMarkdownText } from "./markdown.js";
import { renderFiles, renderFindings, sortFindings } from "./sections.js";
import { computeVerdict, renderVerdictHeader } from "./verdict.js";

const ZeroTokenUsage = { prompt: 0, completion: 0 };

const PromptSha256Pattern = /^[a-f0-9]{64}$/u;

export const WalkthroughProvenanceSchema = z
  .object({
    prompt_sha256: z.string().regex(PromptSha256Pattern).optional(),
    hosting_region: z.string().min(1).optional(),
    data_residency: z.string().min(1).optional(),
    signed_audit_entry: z.string().min(1).optional(),
  })
  .strict();

type WalkthroughProvenance = z.infer<typeof WalkthroughProvenanceSchema>;

interface ParsedProvenanceResult {
  readonly ok: boolean;
  readonly provenance?: WalkthroughProvenance;
}

export const WalkthroughInputSchema = z.unknown().transform((input, context) => {
  if (!isJsonRecord(input)) {
    context.addIssue({
      code: "custom",
      message: "walkthrough input must be a review object",
    });
    return z.NEVER;
  }

  const parsedProvenance = parseWalkthroughProvenance(input, context);
  if (!parsedProvenance.ok) {
    return z.NEVER;
  }

  if (Reflect.get(input, "tokens_used") === undefined) {
    return parseWalkthroughInputWithoutUsage(input, parsedProvenance.provenance, context);
  }

  return parseWalkthroughInputWithUsage(input, parsedProvenance.provenance, context);
});

function parseWalkthroughInputWithoutUsage(
  input: Record<string, unknown>,
  provenance: WalkthroughProvenance | undefined,
  context: z.RefinementCtx,
): WithWalkthroughProvenance<WalkthroughInputWithoutUsage> {
  if (Reflect.get(input, "token_usage_reported") === true) {
    context.addIssue({
      code: "custom",
      message: "walkthrough input cannot report token usage without token counts",
    });
    return z.NEVER;
  }

  const parsed = ReviewSchema.safeParse({ ...input, tokens_used: ZeroTokenUsage });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: parsed.error.message });
    return z.NEVER;
  }

  const { tokens_used: _tokensUsed, ...reviewWithoutUsage } = parsed.data;
  if (provenance !== undefined) {
    return { ...reviewWithoutUsage, provenance };
  }

  return reviewWithoutUsage;
}

function parseWalkthroughInputWithUsage(
  input: Record<string, unknown>,
  provenance: WalkthroughProvenance | undefined,
  context: z.RefinementCtx,
): WithWalkthroughProvenance<Review> {
  const parsed = ReviewSchema.safeParse(input);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: parsed.error.message });
    return z.NEVER;
  }

  if (provenance !== undefined) {
    return { ...parsed.data, provenance };
  }

  return parsed.data;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type WalkthroughInputWithoutUsage = Omit<Review, "tokens_used"> & {
  readonly tokens_used?: undefined;
};

type WithWalkthroughProvenance<T> = T & {
  readonly provenance?: WalkthroughProvenance;
};

export type WalkthroughInput =
  | WithWalkthroughProvenance<Review>
  | WithWalkthroughProvenance<WalkthroughInputWithoutUsage>;

export { categoryBadge, renderAuditReference, severityBadge } from "./badge.js";
export { computeVerdict, renderVerdictHeader } from "./verdict.js";
export type { Verdict } from "./verdict.js";
export { buildInlineComments, InlineCommentDraftSchema } from "./inline.js";
export type { InlineCommentDraft } from "./inline.js";
export { estimateCostUsd, PROVIDER_PRICING, renderCostFooter } from "./cost.js";
export type { ModelPricing, PricingProvider } from "./cost.js";
export {
  computeEffortScore,
  renderAssessmentBlock,
  renderEffortMeter,
  renderMetricChips,
  renderSeverityDistribution,
} from "./assessment.js";
export type { EffortScore } from "./assessment.js";

export function composeWalkthrough(
  input: unknown,
  options: { readonly pipelineFlow?: boolean } = {},
): string {
  const review: WalkthroughInput = WalkthroughInputSchema.parse(input);
  const findings = sortFindings(review.findings);
  const summary = review.summary.trim();
  const tokenUsage =
    "tokens_used" in review && Reflect.get(review, "token_usage_reported") === true
      ? review.tokens_used
      : undefined;
  const costFooter = renderCostFooter(tokenUsage, review.llm_provider, review.llm_model);

  const verdict = computeVerdict(findings);

  const sections = [...renderVerdictHeader(verdict, findings)];

  sections.push("", "### Review assessment", "", ...renderAssessmentBlock(findings));

  if (options.pipelineFlow === true) {
    sections.push("", ...renderPipelineFlow());
  }

  sections.push(
    "",
    "### TL;DR",
    "",
    formatMarkdownText(summary.length > 0 ? summary : "No summary provided."),
    "",
    "### Findings",
    "",
    ...renderFindings(findings),
    "",
    "### File-by-file",
    "",
    ...renderFiles(findings),
  );

  const complianceProvenance = {
    llmProvider: review.llm_provider,
    llmModel: review.llm_model,
    ...(review.provenance?.prompt_sha256 === undefined
      ? {}
      : { promptSha256: review.provenance.prompt_sha256 }),
    ...(review.provenance?.hosting_region === undefined
      ? {}
      : { hostingRegion: review.provenance.hosting_region }),
    ...(review.provenance?.data_residency === undefined
      ? {}
      : { dataResidency: review.provenance.data_residency }),
    ...(review.provenance?.signed_audit_entry === undefined
      ? {}
      : { signedAuditEntry: review.provenance.signed_audit_entry }),
  };
  const complianceSection = renderComplianceSection(findings, complianceProvenance);
  if (complianceSection.length > 0) {
    sections.push("", ...complianceSection);
  }

  if (costFooter.length > 0) {
    sections.push("", "---", "", costFooter);
  }

  return sections.join("\n");
}

function parseWalkthroughProvenance(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
): ParsedProvenanceResult {
  const rawProvenance = Reflect.get(input, "provenance");
  if (rawProvenance === undefined) {
    return { ok: true };
  }

  const parsed = WalkthroughProvenanceSchema.safeParse(rawProvenance);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        path: ["provenance", ...issue.path],
        message: issue.message,
      });
    }

    return { ok: false };
  }

  return { ok: true, provenance: parsed.data };
}
