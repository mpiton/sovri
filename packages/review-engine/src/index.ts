// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export {
  DiffParseError,
  filterDiffByIgnores,
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
  parseWithRetry,
  parseProviderFindings,
  ProviderFindingSchema,
  ProviderReviewResponseSchema,
  RetryBudgetValidationError,
} from "./parsing/index.js";
export type {
  ParseWithRetryOptions,
  ParseWithRetryPrompts,
  ProviderFinding,
  ProviderReviewResponse,
} from "./parsing/index.js";

export {
  buildInlineComments,
  composeWalkthrough,
  InlineCommentDraftSchema,
  WalkthroughInputSchema,
} from "./walkthrough/index.js";
export type { InlineCommentDraft, WalkthroughInput } from "./walkthrough/index.js";

export { reviewPullRequest, runReview } from "./orchestrator.js";
export type {
  ReviewEngineResult,
  ReviewPullRequestConfig,
  ReviewPullRequestConfigMode,
  ReviewPullRequestInput,
  ReviewPullRequestOptions,
  RunReviewInput,
  RunReviewOptions,
} from "./orchestrator.js";

export type { Diff, Review } from "@sovri/core";
