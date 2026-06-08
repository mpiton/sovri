// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, type Category, type Severity } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { expect } from "vitest";

import type { ParseWithRetryPrompts } from "./retry.js";

type RawFindingFixture = {
  severity: Severity;
  category: Category;
  file: string;
  line_start: number;
  line_end: number;
  title: string;
  body: string;
  recommendation: string;
  suggested_code: string | null;
  confidence: number;
};

type ProviderCall = {
  systemPrompt: string;
  userPrompt: string;
};

class MockProviderResponseQueueError extends Error {
  constructor() {
    super("Test provider response queue is exhausted");
    this.name = "MockProviderResponseQueueError";
  }
}

export const retryPrompts: ParseWithRetryPrompts = {
  systemPrompt: "Review the pull request and return JSON",
  userPrompt: "Review src/retry.ts",
};

export function buildRawFinding(overrides: Partial<RawFindingFixture> = {}): RawFindingFixture {
  return {
    severity: "major",
    category: "bug",
    file: "src/retry.ts",
    line_start: 30,
    line_end: 30,
    title: "Retry fixed response",
    body: "The retry response is valid.",
    recommendation: "Fix the retry logic so that the response is always valid on retry.",
    suggested_code: null,
    confidence: 0.88,
    ...overrides,
  };
}

export function buildResponse(
  findings: ReadonlyArray<RawFindingFixture> = [buildRawFinding()],
): unknown {
  return {
    summary: findings.length === 0 ? "No findings found" : "Review completed",
    findings,
  };
}

export function malformedJson(): string {
  return '{"summary":"Broken response","findings":[';
}

export function schemaInvalidResponse(): unknown {
  return {
    summary: "Broken response",
    findings: [buildRawFinding({ line_start: 30, line_end: 28 })],
  };
}

export function invalidSeverityResponse(): unknown {
  return {
    summary: "Still broken",
    findings: [
      {
        ...buildRawFinding(),
        severity: "critical",
      },
    ],
  };
}

export function createProvider(
  responses: ReadonlyArray<unknown>,
): LLMProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  const queue = [...responses];

  return {
    name: "test-provider",
    model: "test-model",
    maxTokens: 2048,
    calls,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      calls.push({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
      });

      if (queue.length === 0) {
        throw new MockProviderResponseQueueError();
      }

      const response = queue.shift();
      if (response instanceof Error) {
        throw response;
      }

      // The fake provider deliberately returns untrusted values so retry parsing
      // can exercise malformed provider payloads after the corrective call.
      return response as T;
    },
  };
}

export function expectSyntheticFailure(finding: unknown): void {
  expect(FindingSchema.parse(finding)).toEqual(finding);
  expect(finding).toMatchObject({
    severity: "info",
    category: "documentation",
    source: "llm",
    confidence: 1,
    file: ".sovri/review-response.json",
    line_start: 1,
    line_end: 1,
    title: "review_failed",
  });
  expect(finding).toHaveProperty("recommendation");
  expect(finding).not.toHaveProperty("suggestion");
  expect(finding).not.toHaveProperty("cwe");
}
