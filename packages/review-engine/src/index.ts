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
  attachCheckRunDescriptors,
  buildReviewCheckDescriptors,
  mapChecks,
  MapChecksInputSchema,
} from "./checks/index.js";
export type {
  CheckRunConclusion,
  CheckRunDescriptor,
  CheckRunDescriptorOptions,
  CheckRunName,
  CheckRunStatus,
  MapChecksInput,
  ReviewWithCheckRunDescriptors,
} from "./checks/index.js";

export { capFindings, checkReportBounds } from "./sarif/caps.js";
export { extractCwe } from "./sarif/cwe.js";
export { collectSarifFindings } from "./sarif/ingest.js";
export type { SarifFindingsResult, SarifIngestionSummary } from "./sarif/ingest.js";
export { resolveSarifFile } from "./sarif/location.js";
export type { FileResolution } from "./sarif/location.js";
export { ingestReport, mapSarifResult } from "./sarif/mapper.js";
export type { IngestionSummary, ReportIngestion } from "./sarif/mapper.js";
export { mergeSarifFindings } from "./sarif/merge.js";
export { parseSarifReport, SarifParseError } from "./sarif/reader.js";
export type { SarifLog, SarifResult } from "./sarif/reader.js";

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
  categoryBadge,
  composeWalkthrough,
  computeEffortScore,
  computeVerdict,
  estimateCostUsd,
  InlineCommentDraftSchema,
  PROVIDER_PRICING,
  renderAssessmentBlock,
  renderAuditReference,
  renderCostFooter,
  renderEffortMeter,
  renderMetricChips,
  renderSeverityDistribution,
  renderVerdictHeader,
  severityBadge,
  WalkthroughInputSchema,
} from "./walkthrough/index.js";
export type {
  EffortScore,
  InlineCommentDraft,
  ModelPricing,
  PricingProvider,
  Verdict,
  WalkthroughInput,
} from "./walkthrough/index.js";

export { generateAuditReference } from "./audit-ref.js";

export {
  classifyResolvedComments,
  computeFindingFingerprint,
  extractFindingFingerprint,
  FINDING_MARKER_PATTERN,
  reconcileFindings,
  renderFindingMarker,
} from "./reconcile/index.js";
export type { PostedComment } from "./reconcile/index.js";

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
