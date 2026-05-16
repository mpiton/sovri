// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export {
  DiffParseError,
  parseReviewDiff,
  parseUnifiedDiff,
  ParsedReviewDiffSchema,
} from "./diff/index.js";
export type { ParsedReviewDiff, ParsedReviewDiffFile } from "./diff/index.js";

export { buildReviewPrompt, ReviewPromptInputSchema } from "./prompt/index.js";
export type { ReviewPrompt, ReviewPromptInput } from "./prompt/index.js";
export {
  buildSystemPrompt,
  buildUserPrompt,
  PromptTemplateSizeError,
  PullRequestPromptContextSchema,
  SYSTEM_PROMPT_MAX_BYTES,
  SystemPromptConfigSchema,
  validateSystemTemplateSize,
} from "./prompt/builder.js";
export type { PullRequestPromptContext, SystemPromptConfig } from "./prompt/builder.js";

export {
  parseLLMReviewResponse,
  parseProviderFindings,
  ProviderFindingSchema,
  ProviderReviewResponseSchema,
} from "./parsing/index.js";
export type { ProviderFinding, ProviderReviewResponse } from "./parsing/index.js";

export { composeWalkthrough, WalkthroughInputSchema } from "./walkthrough/index.js";
export type { WalkthroughInput } from "./walkthrough/index.js";

export { runReview } from "./orchestrator.js";
export type { ReviewEngineResult, RunReviewInput, RunReviewOptions } from "./orchestrator.js";

export type { Diff, Review } from "@sovri/core";
