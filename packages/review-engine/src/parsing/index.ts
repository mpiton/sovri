// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { CategorySchema, type Severity } from "@sovri/core";
import { z } from "zod";

export const ProviderFindingSchema = z
  .strictObject({
    severity: z.enum(["blocker", "major", "minor", "info", "nitpick"]),
    category: CategorySchema.default("maintainability"),
    file: z.string().min(1),
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive(),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    suggested_code: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).default(1),
    cwe: z
      .string()
      .regex(/^CWE-\d+$/)
      .optional(),
  })
  .refine(({ line_start, line_end }) => line_end >= line_start, {
    path: ["line_end"],
    message: "line_end must be greater than or equal to line_start",
  });

export const ProviderReviewResponseSchema = z.strictObject({
  summary: z.string().min(1),
  findings: z.array(ProviderFindingSchema),
  walkthrough_markdown: z.string().min(1),
});

export type ProviderFinding = z.infer<typeof ProviderFindingSchema> & {
  readonly severity: Severity;
};
export type ProviderReviewResponse = z.infer<typeof ProviderReviewResponseSchema>;

export function parseLLMReviewResponse<T>(response: unknown, schema: z.ZodType<T>): T {
  return schema.parse(response);
}

export function parseProviderFindings(response: unknown): ProviderFinding[] {
  return z.array(ProviderFindingSchema).parse(response);
}

export {
  parseWithRetry,
  RetryBudgetValidationError,
  type ParseWithRetryOptions,
  type ParseWithRetryPrompts,
} from "./retry.js";
