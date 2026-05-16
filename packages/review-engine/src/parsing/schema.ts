// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { CategorySchema, SeveritySchema, z } from "@sovri/core";

const CwePattern = /^CWE-\d+$/;

export const LLMRawFindingSchema = z
  .strictObject({
    severity: SeveritySchema,
    category: CategorySchema,
    file: z.string().min(1),
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive(),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    suggested_code: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).default(1),
    cwe: z.string().regex(CwePattern).optional(),
  })
  .refine(({ line_start, line_end }) => line_end >= line_start, {
    path: ["line_end"],
    message: "line_end must be greater than or equal to line_start",
  });

export type LLMRawFinding = z.infer<typeof LLMRawFindingSchema>;

export const LLMResponseSchema = z.strictObject({
  summary: z.string().min(1).max(2000),
  findings: z.array(LLMRawFindingSchema).max(100),
  walkthrough_markdown: z.string().optional(),
});
