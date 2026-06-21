// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import type { AuditTrailSink } from "@sovri/compliance";
import { SovriConfigValidationError, type SovriConfig } from "@sovri/config";
import { MissingApiKeyError } from "@sovri/llm-providers";
import {
  classifyResolvedComments,
  composeWalkthrough,
  computeFindingFingerprint,
  reconcileFindings,
  type Diff,
  type PostedComment,
  type Review,
  type ReviewPullRequestInput,
  type ReviewPullRequestOptions,
} from "@sovri/review-engine";
import type { CommentPosterOctokit } from "../github/comment-poster.js";
import type { DiffFetcherOctokit } from "../github/diff-fetcher.js";
import { DeploymentConfigError } from "../runtime-env.js";

export type PullRequestWebhookContext = {
  readonly id: string;
  readonly name: string;
  readonly octokit: PullRequestOctokit;
  readonly payload: {
    readonly action: string;
    readonly pull_request: PullRequestPayload;
    readonly repository: {
      readonly full_name?: string;
    };
  };
};

export type PullRequestOctokit = CommentPosterOctokit &
  DiffFetcherOctokit & {
    readonly graphql: (
      query: string,
      variables: Readonly<Record<string, unknown>>,
    ) => Promise<unknown>;
    readonly rest: {
      readonly checks?: {
        readonly create: (
          parameters: CheckRunCreateParameters,
        ) => Promise<{ readonly data: unknown }>;
      };
      readonly repos: {
        readonly getContent: (
          parameters: RepositoryContentParameters,
        ) => Promise<{ readonly data: unknown }>;
      };
    };
  };

type CheckRunCreateParameters = {
  readonly conclusion: "failure" | "neutral" | "success";
  readonly head_sha: string;
  readonly name: string;
  readonly output: {
    readonly summary: string;
    readonly title: string;
  };
  readonly owner: string;
  readonly repo: string;
  readonly status: "completed";
};

type RepositoryContentParameters = {
  readonly mediaType: {
    readonly format: "raw";
  };
  readonly owner: string;
  readonly path: ".sovri.yml";
  readonly ref: string;
  readonly repo: string;
};

export type ReviewCommentTarget = {
  readonly number: number;
  readonly repoFullName: string;
};

export type ReviewPostTarget = ReviewCommentTarget & {
  readonly baseSha: string;
  readonly commitSha: string;
};

export type PullRequestHandlerLogger = {
  error(message: string): void;
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
  info(message: string): void;
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

export type PostedFindingsState = {
  readonly fingerprints: ReadonlySet<string>;
  readonly comments: readonly PostedComment[];
};

export type PullRequestHandlerDependencies = {
  readonly fetchDiff: (target: ReviewPostTarget) => Promise<Diff>;
  readonly loadConfig: (target: ReviewPostTarget) => Promise<SovriConfig>;
  readonly logger: PullRequestHandlerLogger;
  readonly postErrorComment: (target: ReviewCommentTarget, message: string) => Promise<void>;
  readonly postReview: (
    target: ReviewPostTarget,
    review: Review,
    diff: Diff,
    checkSourceReview?: Review,
  ) => Promise<void>;
  readonly reviewPullRequest: (
    input: ReviewPullRequestInput,
    options: ReviewPullRequestOptions,
  ) => Promise<Review>;
  readonly buildReviewOptions?: (config: SovriConfig) => ReviewPullRequestOptions;
  readonly reviewOptions?: ReviewPullRequestOptions;
  // Opt-in audit trail (MAT-7): builds a per-review sink, or undefined when disabled. When present,
  // it is merged into the review options so the orchestrator records a signed trail to disk.
  readonly createAuditTrailSink?: (input: {
    readonly deliveryId: string;
    readonly target: ReviewPostTarget;
  }) => AuditTrailSink | undefined;
  // Reconciliation (issue #1965). Optional so the handler degrades to the
  // pre-reconciliation behaviour when an adapter does not supply them.
  readonly fetchPostedFindings?: (target: ReviewPostTarget) => Promise<PostedFindingsState>;
  readonly minimizeComments?: (
    target: ReviewPostTarget,
    nodeIds: readonly string[],
  ) => Promise<void>;
};

export type PullRequestFailureReporterDependencies = Pick<
  PullRequestHandlerDependencies,
  "logger" | "postErrorComment"
>;

type PullRequestPayload = {
  readonly additions?: number;
  readonly base?: {
    readonly ref?: string;
    readonly sha?: string;
  };
  readonly body?: string | null;
  readonly changed_files?: number;
  readonly deletions?: number;
  readonly draft?: boolean;
  readonly head?: {
    readonly ref?: string;
    readonly sha?: string;
  };
  readonly number?: number;
  readonly title?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
};

export type PullRequestReviewFailureStage =
  | "target_validation"
  | "config_load"
  | "diff_fetch"
  | "pull_request_input_validation"
  | "review_engine"
  | "review_result"
  | "review_post";

type FailedReviewDiagnostics = {
  readonly completion_tokens: number;
  readonly failure_reason: Review["failure_reason"];
  readonly finding_count: number;
  readonly llm_model: string;
  readonly llm_provider: string;
  readonly prompt_tokens: number;
  readonly review_id: string;
  readonly review_status: "failed";
  readonly token_usage_reported: boolean | undefined;
};

type PullRequestReviewRunState = {
  failureStage: PullRequestReviewFailureStage;
  target: ReviewPostTarget | undefined;
};

const MaxLoggedErrorMessageLength = 240;
const SecretLikeErrorFragmentPattern =
  /\b(?:gh[opsru]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|secret|token)[A-Za-z0-9_.:-]*)\b/giu;

const DefaultReviewOptions: ReviewPullRequestOptions = {
  provider: {
    maxTokens: 1,
    model: "unconfigured",
    name: "unconfigured",
    async generateStructured<T>(): Promise<T> {
      throw new PullRequestHandlerDependencyError("LLM provider is not configured");
    },
  },
};

class PullRequestHandlerDependencyError extends Error {
  public override readonly name = "PullRequestHandlerDependencyError";
}

// Failure reasons whose human-readable summary is built only from PR metadata and is therefore
// safe to surface to the PR author. Provider/parse failures may carry untrusted provider output,
// so they keep the generic message and never echo the review summary.
const SurfaceableFailureReasons: ReadonlySet<NonNullable<Review["failure_reason"]>> = new Set([
  "limit_exceeded",
]);

const GenericReviewFailureMessage = "review failed";

class PullRequestReviewFailedError extends Error {
  public override readonly name = "PullRequestReviewFailedError";

  public readonly diagnostics: FailedReviewDiagnostics;

  // Pre-computed at construction so the failure reporter posts the right body without re-deriving
  // the safe/unsafe decision: the actionable reason for a surfaceable failure, generic otherwise.
  public readonly commentMessage: string;

  public constructor(review: Review) {
    super("Review engine returned failed status");
    this.diagnostics = buildFailedReviewDiagnostics(review);
    this.commentMessage = failedReviewCommentMessage(review);
  }
}

function failedReviewCommentMessage(review: Review): string {
  if (review.failure_reason !== undefined && SurfaceableFailureReasons.has(review.failure_reason)) {
    return sanitizeErrorMessage(review.summary);
  }

  return GenericReviewFailureMessage;
}

export async function handlePullRequestOpened(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
): Promise<void> {
  await handlePullRequest(context, dependencies);
}

export async function handlePullRequestSynchronize(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
): Promise<void> {
  await handlePullRequest(context, dependencies);
}

async function handlePullRequest(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
): Promise<void> {
  const initialLogContext = buildInitialLogContext(context);
  const commentTarget = buildOptionalCommentTarget(context);
  const runState: PullRequestReviewRunState = {
    failureStage: "target_validation",
    target: undefined,
  };
  dependencies.logger.info(initialLogContext, "Pull request review started");

  try {
    await runPullRequestReview(context, dependencies, runState);
  } catch (error) {
    await reportReviewFailure({
      commentTarget: runState.target ?? commentTarget,
      dependencies,
      error,
      failureStage: runState.failureStage,
      logContext:
        runState.target === undefined
          ? initialLogContext
          : buildLogContext(context, runState.target),
    });
  }
}

async function runPullRequestReview(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
  state: PullRequestReviewRunState,
): Promise<void> {
  state.target = buildTarget(context);
  const target = state.target;
  const logContext = buildLogContext(context, target);
  state.failureStage = "config_load";
  const config = await dependencies.loadConfig(target);
  if (shouldSkipDraftReview(context, config)) {
    dependencies.logger.info({ ...logContext, draft: true }, "Pull request review skipped");
    return;
  }

  state.failureStage = "diff_fetch";
  const diff = await dependencies.fetchDiff(target);
  const reviewOptions = withAuditTrailSink(
    buildEffectiveReviewOptions(dependencies, config),
    dependencies.createAuditTrailSink?.({ deliveryId: context.id, target }),
  );
  state.failureStage = "pull_request_input_validation";
  const pullRequest = buildPullRequest(context);
  state.failureStage = "review_engine";
  const review = await dependencies.reviewPullRequest({ config, diff, pullRequest }, reviewOptions);
  state.failureStage = "review_result";
  requireSuccessfulReview(review);
  state.failureStage = "review_post";
  await postReconciledReview(dependencies, target, review, diff);
  dependencies.logger.info(
    { ...logContext, result: review.status },
    "Pull request review completed",
  );
}

function shouldSkipDraftReview(context: PullRequestWebhookContext, config: SovriConfig): boolean {
  return (context.payload.pull_request.draft ?? false) && !config.review.autoReviewDrafts;
}

function buildEffectiveReviewOptions(
  dependencies: PullRequestHandlerDependencies,
  config: SovriConfig,
): ReviewPullRequestOptions {
  return (
    dependencies.buildReviewOptions?.(config) ?? dependencies.reviewOptions ?? DefaultReviewOptions
  );
}

function withAuditTrailSink(
  options: ReviewPullRequestOptions,
  auditTrailSink: AuditTrailSink | undefined,
): ReviewPullRequestOptions {
  return auditTrailSink === undefined ? options : { ...options, auditTrailSink };
}

async function postReconciledReview(
  dependencies: PullRequestHandlerDependencies,
  target: ReviewPostTarget,
  review: Review,
  diff: Diff,
): Promise<void> {
  const fetchPostedFindings = dependencies.fetchPostedFindings;
  if (fetchPostedFindings === undefined) {
    await dependencies.postReview(target, review, diff);
    return;
  }

  let posted: PostedFindingsState;
  try {
    posted = await fetchPostedFindings(target);
  } catch (error) {
    // Fail-open: a transient API error must never hide a real finding (#1965),
    // so post everything rather than suppressing or failing the review.
    dependencies.logger.info(
      { error_message: errorMessageFrom(error) },
      "Posted findings fetch failed; posting all findings",
    );
    posted = { comments: [], fingerprints: new Set() };
  }

  const reconciledFindings = reconcileFindings(review.findings, diff, posted.fingerprints);
  const reconciledSummary = summarizeReconciledFindings(review, reconciledFindings);
  const reconciled: Review = {
    ...review,
    findings: reconciledFindings,
    summary: reconciledSummary,
    walkthrough_markdown: composeWalkthrough(
      {
        ...review,
        findings: reconciledFindings,
        summary: reconciledSummary,
      },
      { brandHeader: true, brandFooter: true },
    ),
  };
  await dependencies.postReview(target, reconciled, diff, review);
  await minimizeResolvedComments(dependencies, target, review, diff, posted.comments);
}

function summarizeReconciledFindings(
  review: Review,
  reconciledFindings: readonly Review["findings"][number][],
): string {
  if (reconciledFindings.length === review.findings.length) {
    return review.summary;
  }

  if (reconciledFindings.length === 0) {
    return "No findings remain after reconciling previously posted findings.";
  }

  const noun = reconciledFindings.length === 1 ? "finding remains" : "findings remain";
  return `${String(reconciledFindings.length)} ${noun} after reconciling previously posted findings.`;
}

async function minimizeResolvedComments(
  dependencies: PullRequestHandlerDependencies,
  target: ReviewPostTarget,
  review: Review,
  diff: Diff,
  postedComments: readonly PostedComment[],
): Promise<void> {
  const minimizeComments = dependencies.minimizeComments;
  if (minimizeComments === undefined || postedComments.length === 0) {
    return;
  }

  const currentFingerprints = new Set(
    review.findings.map((finding) => computeFindingFingerprint(finding, diff)),
  );
  const resolved = classifyResolvedComments(postedComments, currentFingerprints);
  if (resolved.length === 0) {
    return;
  }

  try {
    // Best-effort: a failed minimize must not fail the review.
    await minimizeComments(target, resolved);
  } catch (error) {
    dependencies.logger.info(
      { error_message: errorMessageFrom(error) },
      "Minimizing resolved finding comments failed",
    );
  }
}

function buildTarget(context: PullRequestWebhookContext): ReviewPostTarget {
  const pullRequest = context.payload.pull_request;
  return {
    baseSha: requireString(pullRequest.base?.sha, "pull_request.base.sha"),
    commitSha: requireString(pullRequest.head?.sha, "pull_request.head.sha"),
    number: requireNumber(pullRequest.number, "pull_request.number"),
    repoFullName: requireString(context.payload.repository.full_name, "repository.full_name"),
  };
}

function buildPullRequest(
  context: PullRequestWebhookContext,
): ReviewPullRequestInput["pullRequest"] {
  const pullRequest = context.payload.pull_request;
  return {
    additions: requireNumber(pullRequest.additions, "pull_request.additions"),
    author: requireString(pullRequest.user?.login, "pull_request.user.login"),
    base_ref: requireString(pullRequest.base?.ref, "pull_request.base.ref"),
    base_sha: requireString(pullRequest.base?.sha, "pull_request.base.sha"),
    body: pullRequest.body ?? null,
    changed_files: requireNumber(pullRequest.changed_files, "pull_request.changed_files"),
    deletions: requireNumber(pullRequest.deletions, "pull_request.deletions"),
    draft: pullRequest.draft ?? false,
    head_ref: requireString(pullRequest.head?.ref, "pull_request.head.ref"),
    head_sha: requireString(pullRequest.head?.sha, "pull_request.head.sha"),
    number: requireNumber(pullRequest.number, "pull_request.number"),
    repo_full_name: requireString(context.payload.repository.full_name, "repository.full_name"),
    title: requireString(pullRequest.title, "pull_request.title"),
  };
}

function requireSuccessfulReview(review: Review): void {
  if (review.status !== "failed") {
    return;
  }

  throw new PullRequestReviewFailedError(review);
}

function buildFailedReviewDiagnostics(review: Review): FailedReviewDiagnostics {
  return {
    completion_tokens: review.tokens_used.completion,
    failure_reason: review.failure_reason,
    finding_count: review.findings.length,
    llm_model: review.llm_model,
    llm_provider: review.llm_provider,
    prompt_tokens: review.tokens_used.prompt,
    review_id: review.id,
    review_status: "failed",
    token_usage_reported: review.token_usage_reported,
  };
}

function buildInitialLogContext(
  context: PullRequestWebhookContext,
): Readonly<Record<string, unknown>> {
  return {
    delivery_id: context.id,
    event: context.name,
    pr_number: context.payload.pull_request.number,
    repo: context.payload.repository.full_name,
  };
}

function buildOptionalCommentTarget(
  context: PullRequestWebhookContext,
): ReviewCommentTarget | undefined {
  const number = context.payload.pull_request.number;
  const repoFullName = context.payload.repository.full_name;
  if (number === undefined || repoFullName === undefined || repoFullName.length === 0) {
    return undefined;
  }

  return {
    number,
    repoFullName,
  };
}

function buildLogContext(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
): Readonly<Record<string, unknown>> {
  return {
    delivery_id: context.id,
    event: context.name,
    pr_number: target.number,
    repo: target.repoFullName,
  };
}

async function reportReviewFailure(values: {
  readonly commentTarget: ReviewCommentTarget | undefined;
  readonly dependencies: PullRequestFailureReporterDependencies;
  readonly error: unknown;
  readonly failureStage: PullRequestReviewFailureStage;
  readonly logContext: Readonly<Record<string, unknown>>;
}): Promise<void> {
  const failure = describeReviewFailure(values.error);
  const commentErrorMessage =
    values.commentTarget === undefined
      ? "review comment target is unavailable"
      : await tryPostFailureComment(
          values.dependencies,
          values.commentTarget,
          failure.commentMessage,
        );

  values.dependencies.logger.error(
    {
      ...values.logContext,
      comment_error_message: commentErrorMessage,
      failure_stage: values.failureStage,
      ...failure.logFields,
    },
    "Pull request review failed",
  );
}

export async function reportPullRequestReviewFailure(values: {
  readonly commentTarget: ReviewCommentTarget | undefined;
  readonly dependencies: PullRequestFailureReporterDependencies;
  readonly error: unknown;
  readonly failureStage: PullRequestReviewFailureStage;
  readonly logContext: Readonly<Record<string, unknown>>;
}): Promise<void> {
  await reportReviewFailure(values);
}

async function tryPostFailureComment(
  dependencies: PullRequestFailureReporterDependencies,
  target: ReviewCommentTarget,
  message: string,
): Promise<string | undefined> {
  try {
    await dependencies.postErrorComment(target, message);
    return undefined;
  } catch (error) {
    return errorMessageFrom(error);
  }
}

function describeReviewFailure(error: unknown): {
  readonly commentMessage: string;
  readonly logFields: Readonly<Record<string, unknown>>;
} {
  if (error instanceof MissingApiKeyError) {
    return {
      commentMessage: `Configuration error: env var ${error.apiKeySecret} is required`,
      logFields: {
        api_key_secret: error.apiKeySecret,
        error_message: error.message,
        error_type: error.name,
      },
    };
  }

  if (error instanceof DeploymentConfigError) {
    // The message is operator-facing guidance built from validated env-var
    // names only — it never contains a secret value — so it is safe to post.
    return {
      commentMessage: error.message,
      logFields: {
        error_message: error.message,
        error_type: error.name,
      },
    };
  }

  if (error instanceof PullRequestReviewFailedError) {
    return {
      commentMessage: error.commentMessage,
      logFields: {
        error_type: error.name,
        ...error.diagnostics,
      },
    };
  }

  if (error instanceof SovriConfigValidationError) {
    // filePath is the trusted literal ".sovri.yml"; issues carry Zod field paths
    // and static schema messages only — never untrusted file content — so the
    // offending fields are safe to name in the PR comment instead of "review failed".
    const details = error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      commentMessage: `Config error in ${error.filePath}: ${details}`,
      logFields: {
        error_message: error.message,
        error_type: error.name,
      },
    };
  }

  return {
    commentMessage: "review failed",
    logFields: {
      error_message: safeErrorMessageFrom(error),
      error_type: errorTypeFrom(error),
    },
  };
}

function safeErrorMessageFrom(error: unknown): string {
  return sanitizeErrorMessage(errorMessageFrom(error));
}

function sanitizeErrorMessage(message: string): string {
  const redacted = message.replace(SecretLikeErrorFragmentPattern, "[Redacted]");
  if (redacted.length <= MaxLoggedErrorMessageLength) {
    return redacted;
  }

  return `${redacted.slice(0, MaxLoggedErrorMessageLength)}...`;
}

function errorTypeFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "NonErrorThrow";
}

function errorMessageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown review failure";
}

function requireString(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0) {
    throw new PullRequestHandlerDependencyError(`${field} is required`);
  }

  return value;
}

function requireNumber(value: number | undefined, field: string): number {
  if (value === undefined) {
    throw new PullRequestHandlerDependencyError(`${field} is required`);
  }

  return value;
}
