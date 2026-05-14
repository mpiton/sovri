// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "zod";

export const SeveritySchema = z.enum(["blocker", "major", "minor", "info", "nitpick"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const CategorySchema = z.enum([
  "bug",
  "security",
  "performance",
  "maintainability",
  "style",
  "documentation",
  "test-coverage",
]);
export type Category = z.infer<typeof CategorySchema>;

const SuggestionSchema = z.object({
  code: z.string(),
  committable: z.boolean(),
});

const CwePattern = /^CWE-\d+$/;

export const FindingSchema = z.object({
  id: z.uuid(),
  severity: SeveritySchema,
  category: CategorySchema,
  file: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  suggestion: SuggestionSchema.optional(),
  source: z.enum(["llm", "sarif"]),
  confidence: z.number().min(0).max(1),
  cwe: z.string().regex(CwePattern).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;
