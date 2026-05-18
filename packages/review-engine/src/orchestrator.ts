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
const FindingBodyMaxLength = 2_000;

type TokenUsage = z.infer<typeof TokenUsageSchema>;

interface StructuredGeneration<T> {
  readonly data: T;
  readonly tokenUsage: TokenUsage;
}

type ParsedReviewGeneration = SuccessfulReviewGeneration | FailedReviewGeneration;

interface SuccessfulReviewGeneration {
  readonly parsed: ProviderReviewResponse;
  readonly tokenUsage: TokenUsage;
  readonly status: "success" | "partial";
}

interface FailedReviewGeneration {
  readonly error: string;
  readonly tokenUsage: TokenUsage;
  readonly status: "failed";
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
  const provider = parseInjectedProvider(options.provider);
  const startedAt = new Date();
  const limitError = getLimitError(input.pullRequest, input.config);
  if (limitError !== undefined) {
    return buildFailedReview(input.pullRequest, provider, startedAt, limitError);
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
    { provider: provider.name, changed_files: input.diff.files.length },
    "Review engine request started",
  );

  const generation = await generateParsedProviderReview(provider, {
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: ProviderReviewResponseSchema,
    maxTokens: provider.maxTokens,
  });
  if (generation.status === "failed") {
    return buildFailedReview(input.pullRequest, provider, startedAt, generation.error, {
      findings: [buildReviewFailedFinding(input.diff, generation.error)],
      tokenUsage: generation.tokenUsage,
    });
  }

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
    llm_provider: provider.name,
    llm_model: provider.model,
    tokens_used: generation.tokenUsage,
    summary: generation.parsed.summary,
    findings,
    walkthrough_markdown: generation.parsed.walkthrough_markdown,
    status: generation.status,
  });
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
    if (!isRetryableSchemaFailure(retryAttempt.error)) {
      throw retryAttempt.error;
    }

    return {
      error: schemaFailureMessage(retryAttempt.error),
      tokenUsage: addTokenUsage(firstAttempt.tokenUsage, retryAttempt.tokenUsage),
      status: "failed",
    };
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

function schemaFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Provider response failed schema validation";
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
    readonly tokenUsage?: TokenUsage;
  } = {},
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
    tokens_used: options.tokenUsage ?? ZeroTokenUsage,
    summary: error,
    findings: options.findings ?? [],
    walkthrough_markdown: `## Sovri review\n\n${error}`,
    status: "failed",
    error,
  });
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
    source: "llm",
    confidence: 1,
  };
}

function buildReviewFailedFindingBody(error: string): string {
  const body = `Provider response could not be parsed after corrective retry: ${error}`;

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
