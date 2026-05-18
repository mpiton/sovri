// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { posix } from "node:path";

import {
  applyIgnoreRules,
  computeSeverityRank,
  ReviewSchema,
  z,
  type Diff,
  type Finding,
  type PullRequest,
  type Review,
  type Severity,
} from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import type { Logger } from "@sovri/observability";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";

import { parseUnifiedDiff } from "./diff/index.js";
import { buildReviewPrompt, ReviewPromptInputSchema } from "./prompt/index.js";
import {
  parseLLMReviewResponse,
  ProviderReviewResponseSchema,
  type ProviderFinding,
  type ProviderReviewResponse,
} from "./parsing/index.js";

export const RunReviewInputSchema = ReviewPromptInputSchema;

const TokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

const ZeroTokenUsage = TokenUsageSchema.parse({ prompt: 0, completion: 0 });

type TokenUsage = z.infer<typeof TokenUsageSchema>;

interface StructuredGeneration<T> {
  readonly data: T;
  readonly tokenUsage: TokenUsage;
}

interface ParsedReviewGeneration {
  readonly parsed: ProviderReviewResponse;
  readonly tokenUsage: TokenUsage;
  readonly status: Review["status"];
}

type ProviderReviewAttempt =
  | {
      readonly success: true;
      readonly parsed: ProviderReviewResponse;
      readonly tokenUsage: TokenUsage;
    }
  | {
      readonly success: false;
      readonly error: unknown;
      readonly tokenUsage: TokenUsage;
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

export interface ReviewPullRequestConfig {
  readonly review: {
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

export async function reviewPullRequest(
  input: ReviewPullRequestInput,
  options: ReviewPullRequestOptions,
): Promise<Review> {
  const startedAt = new Date();
  const limitError = getLimitError(input.pullRequest, input.config);
  if (limitError !== undefined) {
    return buildFailedReview(input.pullRequest, options.provider, startedAt, limitError);
  }

  const prompt = buildReviewPrompt({
    unifiedDiff: input.diff.unified_diff,
    pullRequest: {
      number: input.pullRequest.number,
      repoFullName: input.pullRequest.repo_full_name,
      title: input.pullRequest.title,
      description: input.pullRequest.body ?? "",
    },
  });

  options.logger?.info(
    { provider: options.provider.name, changed_files: input.diff.files.length },
    "Review engine request started",
  );

  const generation = await generateParsedProviderReview(options.provider, {
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: ProviderReviewResponseSchema,
    maxTokens: options.provider.maxTokens,
  });
  const findings = applyReviewFilters(
    generation.parsed.findings.map(toFinding),
    input.config.review.severityThreshold,
    input.config.ignores,
  );

  return ReviewSchema.parse({
    id: uuidv7(),
    pr_number: input.pullRequest.number,
    repo_full_name: input.pullRequest.repo_full_name,
    commit_sha: input.pullRequest.head_sha,
    started_at: startedAt,
    completed_at: new Date(),
    llm_provider: options.provider.name,
    llm_model: options.provider.model,
    tokens_used: generation.tokenUsage,
    summary: generation.parsed.summary,
    findings,
    walkthrough_markdown: generation.parsed.walkthrough_markdown,
    status: generation.status,
  });
}

async function generateParsedProviderReview(
  provider: LLMProvider,
  params: GenerateStructuredParams<ProviderReviewResponse>,
): Promise<ParsedReviewGeneration> {
  const firstAttempt = await generateProviderReviewAttempt(provider, params);
  if (firstAttempt.success) {
    return {
      parsed: firstAttempt.parsed,
      tokenUsage: firstAttempt.tokenUsage,
      status: "success",
    };
  }

  if (!isRetryableSchemaFailure(firstAttempt.error)) {
    throw firstAttempt.error;
  }

  const retryAttempt = await generateProviderReviewAttempt(provider, {
    ...params,
    systemPrompt: buildCorrectiveSystemPrompt(params.systemPrompt, firstAttempt.error),
  });

  if (!retryAttempt.success) {
    throw retryAttempt.error;
  }

  return {
    parsed: retryAttempt.parsed,
    tokenUsage: addTokenUsage(firstAttempt.tokenUsage, retryAttempt.tokenUsage),
    status: "partial",
  };
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
      };
    } catch (error) {
      return {
        success: false,
        error: new ProviderReviewSchemaError(error),
        tokenUsage: generation.tokenUsage,
      };
    }
  } catch (error) {
    return {
      success: false,
      error,
      tokenUsage: tokenUsageFromError(error),
    };
  }
}

async function generateProviderReviewResponse(
  provider: LLMProvider,
  params: GenerateStructuredParams<ProviderReviewResponse>,
): Promise<StructuredGeneration<ProviderReviewResponse>> {
  if (isUsageAwareProvider(provider)) {
    const generation = await provider.generateStructuredWithUsage(params);

    return {
      data: generation.data,
      tokenUsage: parseTokenUsage(generation.tokenUsage),
    };
  }

  return {
    data: await provider.generateStructured(params),
    tokenUsage: ZeroTokenUsage,
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

function tokenUsageFromError(error: unknown): TokenUsage {
  if (!isJsonObject(error)) {
    return ZeroTokenUsage;
  }

  const tokenUsage: unknown = Reflect.get(error, "tokenUsage");
  if (tokenUsage === undefined) {
    return ZeroTokenUsage;
  }

  return parseTokenUsage(tokenUsage);
}

function parseTokenUsage(tokenUsage: unknown): TokenUsage {
  return TokenUsageSchema.parse(tokenUsage);
}

function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    prompt: left.prompt + right.prompt,
    completion: left.completion + right.completion,
  };
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
): Review {
  return ReviewSchema.parse({
    id: uuidv7(),
    pr_number: pullRequest.number,
    repo_full_name: pullRequest.repo_full_name,
    commit_sha: pullRequest.head_sha,
    started_at: startedAt,
    completed_at: new Date(),
    llm_provider: provider.name,
    llm_model: provider.model,
    tokens_used: { prompt: 0, completion: 0 },
    summary: error,
    findings: [],
    walkthrough_markdown: `## Sovri review\n\n${error}`,
    status: "failed",
    error,
  });
}

function applyReviewFilters(
  findings: readonly Finding[],
  severityThreshold: Severity,
  ignores: readonly string[],
): readonly Finding[] {
  const thresholdRank = computeSeverityRank(severityThreshold);
  const normalizedFindings = findings.map((finding) => ({
    ...finding,
    file: normalizeFindingPath(finding.file, ignores),
  }));
  const bySeverity = normalizedFindings.filter(
    (finding) => computeSeverityRank(finding.severity) >= thresholdRank,
  );

  return applyIgnoreRules(bySeverity, ignores);
}

function toFinding(finding: ProviderFinding): Finding {
  return {
    id: uuidv4(),
    severity: finding.severity,
    category: finding.category,
    file: finding.file,
    line_start: finding.line_start,
    line_end: finding.line_end,
    title: finding.title,
    body: finding.body,
    source: "llm",
    confidence: finding.confidence,
  };
}

function normalizeFindingPath(file: string, ignores: readonly string[]): string {
  const withoutDrivePrefix = file.replaceAll("\\", "/").replace(/^[A-Za-z]:\//u, "/");
  const normalized = posix.normalize(withoutDrivePrefix);
  const repositoryPath = normalized.replace(/^(?:\/|\.\.\/|\.\/)+/u, "");
  const nonEmptyPath = repositoryPath.length > 0 ? repositoryPath : normalized;

  return findIgnoredSuffix(nonEmptyPath, ignores) ?? nonEmptyPath;
}

function findIgnoredSuffix(file: string, ignores: readonly string[]): string | undefined {
  for (const ignore of ignores) {
    const prefix = ignore.split(/[*?[{]/u)[0];
    if (prefix === undefined || prefix.length === 0) continue;

    const index = file.indexOf(prefix);
    if (index > 0) return file.slice(index);
  }

  return undefined;
}
