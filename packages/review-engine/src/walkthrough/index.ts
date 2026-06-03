// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema, z, type Review } from "@sovri/core";

import { renderComplianceSection } from "./compliance.js";
import { renderCostFooter } from "./cost.js";
import { formatMarkdownText } from "./markdown.js";
import { renderFiles, renderFindings, sortFindings } from "./sections.js";

const ZeroTokenUsage = { prompt: 0, completion: 0 };

const WalkthroughInputWithoutUsageSchema = z.unknown().transform((input, context) => {
  if (!isJsonRecord(input) || Reflect.get(input, "tokens_used") !== undefined) {
    context.addIssue({
      code: "custom",
      message: "walkthrough input must be a review with valid or omitted token usage",
    });
    return z.NEVER;
  }

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
  return reviewWithoutUsage;
});

export const WalkthroughInputSchema = z.union([ReviewSchema, WalkthroughInputWithoutUsageSchema]);

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type WalkthroughInputWithoutUsage = Omit<Review, "tokens_used"> & {
  readonly tokens_used?: undefined;
};

export type WalkthroughInput = Review | WalkthroughInputWithoutUsage;

export { categoryBadge, renderAuditReference, severityBadge } from "./badge.js";
export { buildInlineComments, InlineCommentDraftSchema } from "./inline.js";
export type { InlineCommentDraft } from "./inline.js";
export { estimateCostUsd, PROVIDER_PRICING, renderCostFooter } from "./cost.js";
export type { ModelPricing, PricingProvider } from "./cost.js";

export function composeWalkthrough(input: unknown): string {
  const review = WalkthroughInputSchema.parse(input);
  const findings = sortFindings(review.findings);
  const summary = review.summary.trim();
  const tokenUsage =
    "tokens_used" in review && Reflect.get(review, "token_usage_reported") === true
      ? review.tokens_used
      : undefined;
  const costFooter = renderCostFooter(tokenUsage, review.llm_provider, review.llm_model);

  const sections = [
    "## Sovri review",
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
  ];

  const complianceSection = renderComplianceSection(findings);
  if (complianceSection.length > 0) {
    sections.push("", ...complianceSection);
  }

  if (costFooter.length > 0) {
    sections.push("", "---", "", costFooter);
  }

  return sections.join("\n");
}
