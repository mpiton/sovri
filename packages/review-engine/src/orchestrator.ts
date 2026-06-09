// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { posix } from "node:path";

import { enrichFindingCompliance, type AuditTrailSink } from "@sovri/compliance";
import {
  applyIgnoreRules,
  computeSeverityRank,
  DiffSchema,
  PullRequestSchema,
  ReviewSchema,
  SeveritySchema,
  z,
  type Diff,
  type Finding,
  type PullRequest,
  type Review,
  type Severity,
} from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { withSpan, type Logger, type SpanLike } from "@sovri/observability";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";

import { generateAuditReference } from "./audit-ref.js";
import {
  recordFinding,
  recordReviewDuration,
  recordReviewTotal,
  type ReviewStatus,
} from "./metrics.js";
import {
  computePromptSha256,
  emitAuditEvent,
  findingCreatedEvent,
  llmCalledEvent,
  reviewCompletedEvent,
  reviewFailedEvent,
  reviewStartedEvent,
} from "./audit-events.js";
import { attachCheckRunDescriptors, type ReviewWithCheckRunDescriptors } from "./checks/index.js";
import { filterDiffByIgnores, parseUnifiedDiff } from "./diff/index.js";
import {
  buildReviewPrompt,
  ReviewPromptInputSchema,
  type ReviewPromptMode,
} from "./prompt/index.js";
import {
  parseLLMReviewResponse,
  partitionActionableFindings,
  ProviderReviewResponseSchema,
  type ProviderFinding,
  type ProviderReviewResponse,
} from "./parsing/index.js";
import { shouldEnrichCompliance } from "./compliance-gate.js";
import { toFindingSuggestion } from "./parsing/suggestion.js";
import { renderComplianceSection } from "./walkthrough/compliance.js";
import { composeWalkthrough, type WalkthroughInput } from "./walkthrough/index.js";

const RunReviewInputSchema = ReviewPromptInputSchema;

const TokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

const ZeroTokenUsage = TokenUsageSchema.parse({ prompt: 0, completion: 0 });
const FindingBodyMaxLength = 2_000;
const NoFilesAfterIgnoreFiltersMessage = "No files to review after ignore filters applied";

const ReviewPullRequestConfigModeSchema = z.enum([
  "full",
  "bugs-only",
  "strict",
  "minimal",
]) satisfies z.ZodType<ReviewPromptMode>;

const ReviewPullRequestConfigSchema = z.object({
  review: z.object({
    mode: ReviewPullRequestConfigModeSchema.default("full"),
    severityThreshold: SeveritySchema,
  }),
  ignores: z.array(z.string()),
  limits: z.object({
    maxFilesPerReview: z.number().int().nonnegative(),
    maxLinesPerReview: z.number().int().nonnegative(),
  }),
});

const ReviewPullRequestInputSchema = z.object({
  pullRequest: PullRequestSchema,
  diff: DiffSchema,
  config: ReviewPullRequestConfigSchema,
});

type TokenUsage = z.infer<typeof TokenUsageSchema>;

interface StructuredGeneration<T> {
  readonly data: T;
  readonly tokenUsage: TokenUsage;
}

interface ReportedStructuredGeneration<T> extends StructuredGeneration<T> {
  readonly tokenUsageReported: boolean;
}

type ParsedReviewGeneration = SuccessfulReviewGeneration | FailedReviewGeneration;

interface SuccessfulReviewGeneration {
  readonly parsed: ProviderReviewResponse;
  readonly promptSha256: string;
  readonly tokenUsage: TokenUsage;
  readonly tokenUsageReported: boolean;
  // True once the provider returned a response on any attempt. Success always has one.
  readonly responseReturned: true;
  readonly status: "success" | "partial";
}

interface FailedReviewGeneration {
  readonly error: string;
  readonly failureKind: "parse" | "provider";
  readonly promptSha256?: string;
  readonly tokenUsage: TokenUsage;
  readonly tokenUsageReported: boolean;
  // True if any attempt returned a response (even one that failed re-parse), so the
  // orchestrator can record llm.called even when the final outcome is a failure. This
  // is independent of failureKind: a malformed first response followed by a provider
  // error on retry fails as "provider" yet a response was received.
  readonly responseReturned: boolean;
  readonly status: "failed";
}

type ProviderReviewAttempt =
  | {
      readonly success: true;
      readonly parsed: ProviderReviewResponse;
      readonly tokenUsage: TokenUsage;
      readonly tokenUsageReported: boolean;
    }
  | {
      readonly success: false;
      readonly error: unknown;
      // True when the model responded but the output was unusable — a response that
      // failed re-parse, or a thrown error carrying token usage (charged tokens). False
      // only when the provider threw with no response (e.g. a transport error).
      readonly responseReturned: boolean;
      readonly tokenUsage: TokenUsage;
      readonly tokenUsageReported: boolean;
    };

interface UsageAwareProvider extends LLMProvider {
  generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>>;
}

class ProviderReviewSchemaError extends Error {
  override get name(): "ProviderReviewSchemaError" {
    return "ProviderReviewSchemaError";
  }

  constructor(cause: unknown) {
    super("Provider response failed schema validation", { cause });
  }
}

class ReviewPullRequestOptionsValidationError extends Error {
  public override readonly name = "ReviewPullRequestOptionsValidationError";
}

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

export type ReviewPullRequestConfigMode = z.input<typeof ReviewPullRequestConfigModeSchema>;

export interface ReviewPullRequestConfig {
  readonly review: {
    readonly mode?: ReviewPullRequestConfigMode;
    readonly severityThreshold: Severity;
  };
  readonly ignores: readonly string[];
  readonly limits: {
    readonly maxFilesPerReview: number;
    readonly maxLinesPerReview: number;
  };
}

export interface ReviewPullRequestInput {
  readonly pullRequest: PullRequest;
  readonly diff: Diff;
  readonly config: ReviewPullRequestConfig;
}

export interface ReviewPullRequestOptions {
  readonly provider: LLMProvider;
  readonly logger?: Logger;
  // Cloud-only port for the unsigned audit trail. When absent (the Community
  // path) the orchestrator emits nothing and behaves exactly as before.
  readonly auditTrailSink?: AuditTrailSink;
  // Accepted placeholder for Organisational Learning (v0.5+). No effect in v0.3.
  readonly strictAudit?: boolean;
}

interface ComposedWalkthroughProvenance {
  readonly promptSha256?: string;
}

type ReviewWithWalkthroughProvenance = Review & Pick<WalkthroughInput, "provenance">;

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

// Stamp the final findings count on the parent review span. Called at each terminal (non-throwing)
// return so the count reflects the descriptor actually returned; the throw path never reaches it,
// so the parent span carries no findings.count.
function stampFindingsCount(
  span: SpanLike,
  descriptor: ReviewWithCheckRunDescriptors,
): ReviewWithCheckRunDescriptors {
  span.setAttribute("findings.count", descriptor.findings.length);
  return descriptor;
}

export async function reviewPullRequest(
  input: ReviewPullRequestInput,
  options: ReviewPullRequestOptions,
): Promise<ReviewWithCheckRunDescriptors> {
  const reviewInput = ReviewPullRequestInputSchema.parse(input);
  const provider = parseInjectedProvider(options.provider);
  const startedAt = new Date();
  const sink = options.auditTrailSink;
  const logger = options.logger;

  await emitAuditEvent(sink, reviewStartedEvent(reviewInput.pullRequest, provider), logger);

  // Business span tree (docs/adr/019): review.pull_request wraps the whole review with the four
  // stage spans as children. Attributes are non-sensitive scalars only — never diff, prompt,
  // response, token, or key content. The span wrapper is the outermost layer; the existing
  // try/catch audit flow stays intact, so error propagation and audit events are unchanged.
  return withSpan(
    "review.pull_request",
    async (reviewSpan) => {
      // Business metrics (docs/adr/019, ARCHI §10.2.3): time the whole review and emit
      // sovri.reviews.total + sovri.reviews.duration_ms exactly once in finally — status "succeeded"
      // for a success/partial descriptor, "failed" for a failed descriptor or a thrown review.
      const reviewStartedAtMs = performance.now();
      let reviewStatus: ReviewStatus = "failed";
      try {
        const reviewDescriptor = await (async (): Promise<ReviewWithCheckRunDescriptors> => {
          const limitError = getLimitError(reviewInput.pullRequest, reviewInput.config);
          if (limitError !== undefined) {
            await emitAuditEvent(sink, reviewFailedEvent("limit_exceeded"), logger);

            const failedReview = buildFailedReview(
              reviewInput.pullRequest,
              provider,
              startedAt,
              limitError,
            );
            return stampFindingsCount(reviewSpan, attachCheckRunDescriptors(failedReview));
          }

          const filteredDiff = await withSpan("review.fetch_diff", async (diffSpan) => {
            const filtered = filterDiffByIgnores(reviewInput.diff, reviewInput.config.ignores);
            diffSpan.setAttribute("changed_files", reviewInput.diff.files.length);
            diffSpan.setAttribute("reviewable_files", filtered.files.length);
            return filtered;
          });
          logger?.info(
            {
              provider: provider.name,
              changed_files: reviewInput.diff.files.length,
              reviewable_files: filteredDiff.files.length,
              ignored_files: reviewInput.diff.files.length - filteredDiff.files.length,
            },
            "Review engine ignore filters applied",
          );

          if (filteredDiff.files.length === 0) {
            await emitAuditEvent(sink, reviewCompletedEvent(), logger);

            return stampFindingsCount(
              reviewSpan,
              attachCheckRunDescriptors(
                buildNoFilesReview(reviewInput.pullRequest, provider, startedAt),
              ),
            );
          }

          const prompt = await withSpan("review.build_prompt", async () =>
            buildReviewPrompt({
              unifiedDiff: filteredDiff.unified_diff,
              mode: reviewInput.config.review.mode,
              pullRequest: {
                number: reviewInput.pullRequest.number,
                repoFullName: reviewInput.pullRequest.repo_full_name,
                title: reviewInput.pullRequest.title,
                description: reviewInput.pullRequest.body ?? "",
              },
            }),
          );

          logger?.info(
            { provider: provider.name, changed_files: filteredDiff.files.length },
            "Review engine request started",
          );

          const generation = await withSpan(
            "review.llm_call",
            async () =>
              generateParsedProviderReview(provider, {
                systemPrompt: prompt.systemPrompt,
                userPrompt: prompt.userPrompt,
                schema: ProviderReviewResponseSchema,
                maxTokens: provider.maxTokens,
              }),
            { "llm.provider": provider.name, "provider.model": provider.model },
          );

          if (generation.responseReturned && generation.promptSha256 !== undefined) {
            await emitAuditEvent(
              sink,
              llmCalledEvent(
                generation.promptSha256,
                generation.tokenUsage.prompt,
                generation.tokenUsage.completion,
              ),
              logger,
            );
          }

          if (generation.status === "failed") {
            const errorCode = generation.failureKind === "parse" ? "parse_error" : "provider_error";
            await emitAuditEvent(sink, reviewFailedEvent(errorCode), logger);

            const findings =
              generation.failureKind === "parse"
                ? [buildReviewFailedFinding(filteredDiff, generation.error)]
                : [];

            // The parse-failure descriptor still surfaces a synthetic Finding, so count it like any
            // other emitted Finding — otherwise finding-mix dashboards undercount this branch (R-06).
            for (const finding of findings) {
              recordFinding({
                severity: finding.severity,
                category: finding.category,
                source: finding.source,
              });
            }

            const failedReview = buildFailedReview(
              reviewInput.pullRequest,
              provider,
              startedAt,
              generation.error,
              {
                findings,
                ...(generation.promptSha256 === undefined
                  ? {}
                  : { promptSha256: generation.promptSha256 }),
                tokenUsage: generation.tokenUsage,
                tokenUsageReported: generation.tokenUsageReported,
              },
            );
            return stampFindingsCount(reviewSpan, attachCheckRunDescriptors(failedReview));
          }

          const findings = await withSpan("review.parse_findings", async () => {
            // Deterministic backstop (issue #2450): drop narration the prompt and schema let through,
            // then map the survivors. Log the dropped count so the reduction is auditable, never silent.
            const { kept, droppedCount } = partitionActionableFindings(generation.parsed.findings);
            if (droppedCount > 0) {
              logger?.info(
                {
                  provider: provider.name,
                  dropped_narration: droppedCount,
                  kept_findings: kept.length,
                },
                "Review engine dropped non-actionable narration findings",
              );
            }

            return applyReviewFilters(
              kept.map((finding) => toFinding(finding, logger)),
              reviewInput.config.review.severityThreshold,
              reviewInput.config.ignores,
            );
          });

          // Append findings in order: a chaining sink (the Cloud file writer) links
          // entries by hash, so they must be awaited sequentially, never in parallel.
          await findings.reduce(async (previous, finding) => {
            await previous;
            // sovri.findings.total: one increment per emitted Finding, tagged from the Finding's own
            // validated enums (severity/category/source) — never re-derived (R-04, R-06).
            recordFinding({
              severity: finding.severity,
              category: finding.category,
              source: finding.source,
            });
            const event = findingCreatedEvent(finding);
            if (event !== undefined) {
              await emitAuditEvent(sink, event, logger);
            }
          }, Promise.resolve());

          await emitAuditEvent(sink, reviewCompletedEvent(), logger);

          const review = ReviewSchema.parse({
            id: uuidv7(),
            pr_number: reviewInput.pullRequest.number,
            repo_full_name: reviewInput.pullRequest.repo_full_name,
            commit_sha: reviewInput.pullRequest.head_sha,
            started_at: startedAt,
            completed_at: new Date(),
            llm_provider: provider.name,
            llm_model: provider.model,
            tokens_used: generation.tokenUsage,
            token_usage_reported: generation.tokenUsageReported,
            summary: generation.parsed.summary,
            findings,
            walkthrough_markdown: generation.parsed.walkthrough_markdown,
            status: generation.status,
          });

          return stampFindingsCount(
            reviewSpan,
            attachCheckRunDescriptors(
              withComposedWalkthrough(
                review,
                generation.promptSha256 === undefined
                  ? {}
                  : { promptSha256: generation.promptSha256 },
              ),
            ),
          );
        })();
        reviewStatus = reviewDescriptor.status === "failed" ? "failed" : "succeeded";
        return reviewDescriptor;
      } catch (error) {
        await emitAuditEvent(sink, reviewFailedEvent("unexpected_error"), logger);

        throw error;
      } finally {
        const reviewDurationMs = performance.now() - reviewStartedAtMs;
        recordReviewDuration({ llm_provider: provider.name }, reviewDurationMs);
        recordReviewTotal({ status: reviewStatus, llm_provider: provider.name });
      }
    },
    {
      "pr.number": reviewInput.pullRequest.number,
      "pr.repo": reviewInput.pullRequest.repo_full_name,
      "llm.provider": provider.name,
    },
  );
}

function buildNoFilesReview(
  pullRequest: PullRequest,
  provider: LLMProvider,
  startedAt: Date,
): Review {
  const review = ReviewSchema.parse({
    id: uuidv7(),
    pr_number: pullRequest.number,
    repo_full_name: pullRequest.repo_full_name,
    commit_sha: pullRequest.head_sha,
    started_at: startedAt,
    completed_at: new Date(),
    llm_provider: provider.name,
    llm_model: provider.model,
    tokens_used: ZeroTokenUsage,
    token_usage_reported: false,
    summary: NoFilesAfterIgnoreFiltersMessage,
    findings: [],
    walkthrough_markdown: `## Sovri review\n\n${NoFilesAfterIgnoreFiltersMessage}`,
    status: "success",
  });

  return withComposedWalkthrough(review);
}

function withComposedWalkthrough(
  review: Review,
  provenance: ComposedWalkthroughProvenance = {},
): Review {
  const input =
    provenance.promptSha256 === undefined
      ? review
      : withPromptProvenance(review, provenance.promptSha256);

  return {
    ...review,
    ...input,
    walkthrough_markdown: composeWalkthrough(input),
  };
}

function withPromptProvenance(
  review: Review,
  promptSha256: string,
): ReviewWithWalkthroughProvenance {
  return { ...review, provenance: { prompt_sha256: promptSha256 } };
}

function parseInjectedProvider(provider: unknown): LLMProvider {
  if (isInjectedProvider(provider)) {
    return provider;
  }

  throw new ReviewPullRequestOptionsValidationError(
    "reviewPullRequest requires an injected provider",
  );
}

function isInjectedProvider(provider: unknown): provider is LLMProvider {
  if (!isJsonObject(provider)) {
    return false;
  }

  const name = Reflect.get(provider, "name");
  const model = Reflect.get(provider, "model");
  const maxTokens = Reflect.get(provider, "maxTokens");
  const generateStructured = Reflect.get(provider, "generateStructured");

  return (
    typeof name === "string" &&
    typeof model === "string" &&
    typeof maxTokens === "number" &&
    Number.isInteger(maxTokens) &&
    maxTokens > 0 &&
    typeof generateStructured === "function"
  );
}

async function generateParsedProviderReview(
  provider: LLMProvider,
  params: GenerateStructuredParams<ProviderReviewResponse>,
): Promise<ParsedReviewGeneration> {
  const firstPromptSha256 = computePromptSha256(params.systemPrompt, params.userPrompt);
  const firstAttempt = await generateProviderReviewAttempt(provider, params);
  if (firstAttempt.success) {
    return {
      parsed: firstAttempt.parsed,
      promptSha256: firstPromptSha256,
      tokenUsage: firstAttempt.tokenUsage,
      tokenUsageReported: firstAttempt.tokenUsageReported,
      responseReturned: true,
      status: "success",
    };
  }

  if (!isRetryableSchemaFailure(firstAttempt.error)) {
    if (shouldPropagateProviderFailure(firstAttempt.error)) {
      throw firstAttempt.error;
    }

    return {
      error: providerFailureMessage(firstAttempt.error),
      failureKind: "provider",
      ...(firstAttempt.responseReturned ? { promptSha256: firstPromptSha256 } : {}),
      tokenUsage: firstAttempt.tokenUsage,
      tokenUsageReported: firstAttempt.tokenUsageReported,
      responseReturned: firstAttempt.responseReturned,
      status: "failed",
    };
  }

  const retryParams = {
    ...params,
    systemPrompt: buildCorrectiveSystemPrompt(params.systemPrompt, firstAttempt.error),
  };
  const retryPromptSha256 = computePromptSha256(retryParams.systemPrompt, retryParams.userPrompt);
  const retryAttempt = await generateProviderReviewAttempt(provider, retryParams);
  const retryResponseReturned = attemptReturnedResponse(retryAttempt);
  const responseReturned = firstAttempt.responseReturned || retryResponseReturned;
  const promptSha256 = selectReturnedPromptSha256({
    firstPromptSha256,
    firstResponseReturned: firstAttempt.responseReturned,
    retryPromptSha256,
    retryResponseReturned,
  });

  if (!retryAttempt.success) {
    if (!isRetryableSchemaFailure(retryAttempt.error)) {
      if (shouldPropagateProviderFailure(retryAttempt.error)) {
        throw retryAttempt.error;
      }

      return {
        error: providerFailureMessage(retryAttempt.error),
        failureKind: "provider",
        ...(promptSha256 === undefined ? {} : { promptSha256 }),
        tokenUsage: addTokenUsage(firstAttempt.tokenUsage, retryAttempt.tokenUsage),
        tokenUsageReported: hasReportedTokenUsage(firstAttempt, retryAttempt),
        responseReturned,
        status: "failed",
      };
    }

    return {
      error: schemaFailureMessage(retryAttempt.error),
      failureKind: "parse",
      ...(promptSha256 === undefined ? {} : { promptSha256 }),
      tokenUsage: addTokenUsage(firstAttempt.tokenUsage, retryAttempt.tokenUsage),
      tokenUsageReported: hasReportedTokenUsage(firstAttempt, retryAttempt),
      responseReturned,
      status: "failed",
    };
  }

  return {
    parsed: retryAttempt.parsed,
    promptSha256: retryPromptSha256,
    tokenUsage: addTokenUsage(firstAttempt.tokenUsage, retryAttempt.tokenUsage),
    tokenUsageReported: hasReportedTokenUsage(firstAttempt, retryAttempt),
    responseReturned: true,
    status: "partial",
  };
}

function selectReturnedPromptSha256(params: {
  readonly firstPromptSha256: string;
  readonly firstResponseReturned: boolean;
  readonly retryPromptSha256: string;
  readonly retryResponseReturned: boolean;
}): string | undefined {
  if (params.retryResponseReturned) {
    return params.retryPromptSha256;
  }

  if (params.firstResponseReturned) {
    return params.firstPromptSha256;
  }

  return undefined;
}

// A successful attempt always carried a response; a failed one only if it failed
// re-parse (the provider threw with no response otherwise).
function attemptReturnedResponse(attempt: ProviderReviewAttempt): boolean {
  return attempt.success || attempt.responseReturned;
}

async function generateProviderReviewAttempt(
  provider: LLMProvider,
  params: GenerateStructuredParams<ProviderReviewResponse>,
): Promise<ProviderReviewAttempt> {
  try {
    const generation = await generateProviderReviewResponse(provider, params);

    try {
      return {
        success: true,
        parsed: parseLLMReviewResponse(generation.data, ProviderReviewResponseSchema),
        tokenUsage: generation.tokenUsage,
        tokenUsageReported: generation.tokenUsageReported,
      };
    } catch (error) {
      return {
        success: false,
        error: new ProviderReviewSchemaError(error),
        responseReturned: true,
        tokenUsage: generation.tokenUsage,
        tokenUsageReported: generation.tokenUsageReported,
      };
    }
  } catch (error) {
    const tokenUsage = tokenUsageFromError(error);

    return {
      success: false,
      error,
      // The provider threw. A thrown error that carries token usage means the model did
      // respond and was charged (e.g. a retryable schema-validation error after invalid
      // structured output), so it counts as a returned response; a usage-less transport
      // error does not.
      responseReturned: tokenUsage.reported,
      tokenUsage: tokenUsage.usage,
      tokenUsageReported: tokenUsage.reported,
    };
  }
}

async function generateProviderReviewResponse(
  provider: LLMProvider,
  params: GenerateStructuredParams<ProviderReviewResponse>,
): Promise<ReportedStructuredGeneration<ProviderReviewResponse>> {
  if (isUsageAwareProvider(provider)) {
    const generation = await provider.generateStructuredWithUsage(params);

    return {
      data: generation.data,
      tokenUsage: parseTokenUsage(generation.tokenUsage),
      tokenUsageReported: true,
    };
  }

  return {
    data: await provider.generateStructured(params),
    tokenUsage: ZeroTokenUsage,
    tokenUsageReported: false,
  };
}

function isUsageAwareProvider(provider: LLMProvider): provider is UsageAwareProvider {
  const candidate: unknown = Reflect.get(provider, "generateStructuredWithUsage");

  return typeof candidate === "function";
}

function isRetryableSchemaFailure(error: unknown): boolean {
  if (error instanceof ProviderReviewSchemaError) {
    return true;
  }

  if (!isJsonObject(error)) {
    return false;
  }

  return Reflect.get(error, "retryableWithCorrectivePrompt") === true;
}

function tokenUsageFromError(error: unknown): {
  readonly usage: TokenUsage;
  readonly reported: boolean;
} {
  if (!isJsonObject(error)) {
    return { usage: ZeroTokenUsage, reported: false };
  }

  const tokenUsage: unknown = Reflect.get(error, "tokenUsage");
  if (tokenUsage === undefined) {
    return { usage: ZeroTokenUsage, reported: false };
  }

  return { usage: parseTokenUsage(tokenUsage), reported: true };
}

function parseTokenUsage(tokenUsage: unknown): TokenUsage {
  return TokenUsageSchema.parse(tokenUsage);
}

function shouldPropagateProviderFailure(error: unknown): boolean {
  return error instanceof z.ZodError || hasProviderValidationIssues(error);
}

function hasProviderValidationIssues(error: unknown): boolean {
  if (!isJsonObject(error)) {
    return false;
  }

  const issues: unknown = Reflect.get(error, "issues");

  return Array.isArray(issues);
}

function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    prompt: left.prompt + right.prompt,
    completion: left.completion + right.completion,
  };
}

function hasReportedTokenUsage(
  firstAttempt: ProviderReviewAttempt,
  retryAttempt: ProviderReviewAttempt,
): boolean {
  return firstAttempt.tokenUsageReported || retryAttempt.tokenUsageReported;
}

function buildCorrectiveSystemPrompt(systemPrompt: string, failure: unknown): string {
  return [
    systemPrompt,
    "",
    "Correct the previous provider response.",
    "Return valid JSON matching the requested schema.",
    "Do not include Markdown fences or explanatory prose.",
    "",
    "Validation failure:",
    failure instanceof Error ? failure.message : "Provider response failed schema validation",
  ].join("\n");
}

function schemaFailureMessage(error: unknown): string {
  const reason =
    error instanceof Error ? error.message : "Provider response failed schema validation";

  return `Sovri could not parse provider response after corrective retry: ${reason}`;
}

function providerFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Provider call failed";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLimitError(
  pullRequest: PullRequest,
  config: ReviewPullRequestConfig,
): string | undefined {
  const changedLines = pullRequest.additions + pullRequest.deletions;

  if (pullRequest.changed_files > config.limits.maxFilesPerReview) {
    return `Pull request exceeds review limits: ${pullRequest.changed_files} files changed, max ${config.limits.maxFilesPerReview}.`;
  }

  if (changedLines > config.limits.maxLinesPerReview) {
    return `Pull request exceeds review limits: ${changedLines} changed lines, max ${config.limits.maxLinesPerReview}.`;
  }

  return undefined;
}

function buildFailedReview(
  pullRequest: PullRequest,
  provider: LLMProvider,
  startedAt: Date,
  error: string,
  options: {
    readonly findings?: readonly Finding[];
    readonly promptSha256?: string;
    readonly tokenUsage?: TokenUsage;
    readonly tokenUsageReported?: boolean;
  } = {},
): Review {
  const review = ReviewSchema.parse({
    id: uuidv7(),
    pr_number: pullRequest.number,
    repo_full_name: pullRequest.repo_full_name,
    commit_sha: pullRequest.head_sha,
    started_at: startedAt,
    completed_at: new Date(),
    llm_provider: provider.name,
    llm_model: provider.model,
    tokens_used: options.tokenUsage ?? ZeroTokenUsage,
    token_usage_reported: options.tokenUsageReported ?? false,
    summary: error,
    findings: options.findings ?? [],
    walkthrough_markdown: `## Sovri review\n\n${error}`,
    status: "failed",
    error,
  });

  if (options.promptSha256 === undefined) {
    return review;
  }

  return withFailedReviewProvenance(review, options.promptSha256);
}

function withFailedReviewProvenance(review: Review, promptSha256: string): Review {
  if (review.findings.length > 0) {
    return withComposedWalkthrough(review, { promptSha256 });
  }

  const reviewWithProvenance = withPromptProvenance(review, promptSha256);
  const complianceSection = renderComplianceSection([], {
    llmProvider: review.llm_provider,
    llmModel: review.llm_model,
    promptSha256,
  });

  return {
    ...reviewWithProvenance,
    walkthrough_markdown: [review.walkthrough_markdown, "", ...complianceSection].join("\n"),
  };
}

function buildReviewFailedFinding(diff: Diff, error: string): Finding {
  const fallbackLocation = getFallbackFindingLocation(diff);

  return {
    id: uuidv4(),
    severity: "major",
    category: "maintainability",
    file: fallbackLocation.file,
    line_start: fallbackLocation.line,
    line_end: fallbackLocation.line,
    title: "review_failed",
    body: buildReviewFailedFindingBody(error),
    recommendation: "Re-run the review; if the failure recurs, check the provider configuration.",
    source: "llm",
    confidence: 1,
    compliance_references: [],
  };
}

function buildReviewFailedFindingBody(error: string): string {
  const body = error;

  return body.length <= FindingBodyMaxLength ? body : body.slice(0, FindingBodyMaxLength);
}

function getFallbackFindingLocation(diff: Diff): { readonly file: string; readonly line: number } {
  const firstFile = diff.files.at(0);
  const firstHunk = firstFile?.hunks.at(0);

  return {
    file: firstFile?.path ?? "unknown",
    line: Math.max(firstHunk?.new_start ?? firstHunk?.old_start ?? 1, 1),
  };
}

function applyReviewFilters(
  findings: readonly Finding[],
  severityThreshold: Severity,
  ignores: readonly string[],
): readonly Finding[] {
  const thresholdRank = computeSeverityRank(severityThreshold);
  const normalizedFindings = findings.map((finding) => ({
    ...finding,
    file: normalizeFindingPath(finding.file),
  }));
  const bySeverity = normalizedFindings.filter(
    (finding) => computeSeverityRank(finding.severity) >= thresholdRank,
  );

  return applyIgnoreRules(bySeverity, ignores);
}

function toFinding(finding: ProviderFinding, logger?: Logger): Finding {
  const suggestion = toFindingSuggestion(finding);
  const base: Finding = {
    id: uuidv4(),
    severity: finding.severity,
    category: finding.category,
    file: finding.file,
    line_start: finding.line_start,
    line_end: finding.line_end,
    title: finding.title,
    body: finding.body,
    recommendation: finding.recommendation,
    source: "llm",
    confidence: finding.confidence,
    audit_reference: generateAuditReference(finding.category),
    compliance_references: [],
    ...(suggestion === undefined ? {} : { suggestion }),
    ...(finding.cwe === undefined ? {} : { cwe: finding.cwe }),
  };

  if (!shouldEnrichCompliance(finding)) {
    return base;
  }

  try {
    return enrichFindingCompliance(base);
  } catch (error) {
    logger?.error(
      { err: error, audit_reference: base.audit_reference },
      "Compliance enrichment failed; keeping finding without references",
    );

    return base;
  }
}

function normalizeFindingPath(file: string): string {
  const withoutDrivePrefix = file.replaceAll("\\", "/").replace(/^[A-Za-z]:\//u, "/");
  const normalized = posix.normalize(withoutDrivePrefix);
  const repositoryPath = normalized.replace(/^(?:\/|\.\.\/|\.\/)+/u, "");

  return repositoryPath.length > 0 ? repositoryPath : normalized;
}
