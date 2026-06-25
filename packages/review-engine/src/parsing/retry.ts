// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { FindingSchema, type Finding, type z } from "@sovri/core";
import type { LLMProvider } from "@sovri/llm-providers";
import { v4 as uuidv4 } from "uuid";

import { LLMResponseParseError, parseLLMResponse } from "./parser.js";
import { LLMResponseSchema } from "./schema.js";

const DEFAULT_RETRY_BUDGET = 1;
const FAILURE_BODY_MAX_LENGTH = 2_000;

export interface ParseWithRetryPrompts {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface ParseWithRetryOptions {
  readonly retryBudget?: number;
}

export class RetryBudgetValidationError extends Error {
  public override readonly name = "RetryBudgetValidationError";
}

export async function parseWithRetry(
  rawResponse: unknown,
  provider: LLMProvider,
  originalPrompts: ParseWithRetryPrompts,
  options: ParseWithRetryOptions = {},
): Promise<Finding[]> {
  const retryBudget = parseRetryBudget(options.retryBudget);
  return parseCandidate(rawResponse, provider, originalPrompts, retryBudget, 0);
}

async function parseCandidate(
  candidateResponse: unknown,
  provider: LLMProvider,
  originalPrompts: ParseWithRetryPrompts,
  retryBudget: number,
  attemptsUsed: number,
): Promise<Finding[]> {
  try {
    return parseLLMResponse(candidateResponse);
  } catch (error) {
    return retryAfterParseFailure(error, provider, originalPrompts, retryBudget, attemptsUsed);
  }
}

async function retryAfterParseFailure(
  failure: unknown,
  provider: LLMProvider,
  originalPrompts: ParseWithRetryPrompts,
  retryBudget: number,
  attemptsUsed: number,
): Promise<Finding[]> {
  if (attemptsUsed >= retryBudget) {
    return [buildSyntheticFailureFinding(failure, retryBudget)];
  }

  try {
    const retryResponse = await provider.generateStructured({
      systemPrompt: buildCorrectiveSystemPrompt(originalPrompts.systemPrompt, failure),
      userPrompt: originalPrompts.userPrompt,
      schema: LLMResponseSchema,
      maxTokens: provider.maxTokens,
    });
    return parseCandidate(retryResponse, provider, originalPrompts, retryBudget, attemptsUsed + 1);
  } catch (providerError) {
    const nextAttemptsUsed = attemptsUsed + 1;
    if (!isRetryableProviderParseFailure(providerError)) {
      return [buildSyntheticFailureFinding(providerError, retryBudget)];
    }

    return retryAfterParseFailure(
      providerError,
      provider,
      originalPrompts,
      retryBudget,
      nextAttemptsUsed,
    );
  }
}

function parseRetryBudget(value: number | undefined): number {
  const retryBudget = value ?? DEFAULT_RETRY_BUDGET;
  if (!Number.isInteger(retryBudget) || retryBudget < 0) {
    throw new RetryBudgetValidationError("retryBudget must be a nonnegative integer");
  }

  return retryBudget;
}

function buildCorrectiveSystemPrompt(originalSystemPrompt: string, failure: unknown): string {
  return [
    originalSystemPrompt,
    "",
    "Correct the previous LLM response.",
    "Return valid JSON matching LLMResponseSchema.",
    "Do not include Markdown fences or explanatory prose.",
    "",
    "Parse failure details:",
    formatFailureDetails(failure),
  ].join("\n");
}

function formatFailureDetails(failure: unknown): string {
  const issues = zodIssues(failure);
  if (issues !== undefined) {
    return issues.map(formatZodIssue).join("\n");
  }

  return [
    `JSON syntax error: ${errorMessage(rootCause(failure))}`,
    "no Zod issue list is available",
  ].join("\n");
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
  return `${path}: ${issue.message}`;
}

function buildSyntheticFailureFinding(failure: unknown, retryBudget: number): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    severity: "info",
    category: "bug",
    file: ".sovri/review-response.json",
    line_start: 1,
    line_end: 1,
    title: "review_failed",
    body: failureBody(failure, retryBudget),
    recommendation: "Re-run the review; if the failure recurs, check the provider configuration.",
    source: "llm",
    confidence: 1,
  });
}

function failureBody(failure: unknown, retryBudget: number): string {
  return truncateBody(
    [
      `Sovri could not parse the LLM response after retry budget ${retryBudget}.`,
      `Final failure: ${failureSummary(failure)}`,
    ].join(" "),
  );
}

function failureSummary(failure: unknown): string {
  const issues = zodIssues(failure);
  if (issues !== undefined) {
    return issues.map(formatZodIssue).join("; ");
  }

  return errorMessage(rootCause(failure));
}

function isRetryableProviderParseFailure(failure: unknown): boolean {
  return (
    failure instanceof Error &&
    (zodIssues(failure) !== undefined ||
      rootCause(failure) instanceof SyntaxError ||
      providerParseFailureMessage(failure.message))
  );
}

function providerParseFailureMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("schema validation") ||
    normalized.includes("not valid json") ||
    normalized.includes("did not contain text content") ||
    normalized.includes("did not contain a content array")
  );
}

function zodIssues(failure: unknown): ReadonlyArray<z.core.$ZodIssue> | undefined {
  if (failure instanceof LLMResponseParseError && failure.issues !== undefined) {
    return failure.issues;
  }

  if (hasZodIssueList(failure)) {
    return failure.issues;
  }

  return undefined;
}

function hasZodIssueList(
  value: unknown,
): value is { readonly issues: ReadonlyArray<z.core.$ZodIssue> } {
  return (
    typeof value === "object" && value !== null && "issues" in value && Array.isArray(value.issues)
  );
}

function rootCause(failure: unknown): unknown {
  return failure instanceof Error && failure.cause !== undefined ? failure.cause : failure;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown parse failure";
}

function truncateBody(value: string): string {
  return value.length <= FAILURE_BODY_MAX_LENGTH
    ? value
    : value.slice(0, FAILURE_BODY_MAX_LENGTH - 1);
}
