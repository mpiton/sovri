// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";
import type { LLMProvider } from "@sovri/llm-providers";
import type { Logger } from "@sovri/observability";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";

import { parseUnifiedDiff } from "./diff/index.js";
import { buildReviewPrompt, ReviewPromptInputSchema } from "./prompt/index.js";
import {
  parseLLMReviewResponse,
  ProviderReviewResponseSchema,
  type ProviderFinding,
} from "./parsing/index.js";

export const RunReviewInputSchema = ReviewPromptInputSchema;

export type RunReviewInput = z.input<typeof RunReviewInputSchema>;

export interface RunReviewOptions {
  readonly provider: LLMProvider;
  readonly logger?: Logger;
}

export interface ReviewEngineResult {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly diff: Diff;
  readonly summary: string;
  readonly findings: ProviderFinding[];
  readonly walkthroughMarkdown: string;
}

export async function runReview(
  input: RunReviewInput,
  options: RunReviewOptions,
): Promise<ReviewEngineResult> {
  const reviewInput = RunReviewInputSchema.parse(input);
  const diff = parseUnifiedDiff(reviewInput.unifiedDiff);
  const prompt = buildReviewPrompt(reviewInput);

  options.logger?.info(
    { provider: options.provider.name, changed_files: diff.files.length },
    "Review engine request started",
  );

  const response = await options.provider.generateStructured({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: ProviderReviewResponseSchema,
    maxTokens: options.provider.maxTokens,
  });
  const parsed = parseLLMReviewResponse(response, ProviderReviewResponseSchema);

  return {
    id: uuidv7(),
    provider: options.provider.name,
    model: options.provider.model,
    diff,
    summary: parsed.summary,
    findings: parsed.findings,
    walkthroughMarkdown: parsed.walkthrough_markdown,
  };
}
