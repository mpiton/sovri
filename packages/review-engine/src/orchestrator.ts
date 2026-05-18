// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { posix } from "node:path";

import {
  applyIgnoreRules,
  computeSeverityRank,
  ReviewSchema,
  type Diff,
  type Finding,
  type PullRequest,
  type Review,
  type Severity,
} from "@sovri/core";
import type { LLMProvider } from "@sovri/llm-providers";
import type { Logger } from "@sovri/observability";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
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

  const response = await options.provider.generateStructured({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: ProviderReviewResponseSchema,
    maxTokens: options.provider.maxTokens,
  });
  const parsed = parseLLMReviewResponse(response, ProviderReviewResponseSchema);
  const findings = applyReviewFilters(
    parsed.findings.map(toFinding),
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
    tokens_used: { prompt: 0, completion: 0 },
    summary: parsed.summary,
    findings,
    walkthrough_markdown: parsed.walkthrough_markdown,
    status: "success",
  });
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
