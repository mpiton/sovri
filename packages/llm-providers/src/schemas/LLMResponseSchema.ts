// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { CategorySchema, SeveritySchema, z } from "@sovri/core";

const CwePattern = /^CWE-\d{1,7}$/;

// Whitelist of safe characters in a relative repo file path: alphanumeric,
// dot, underscore, dash, slash, plus, at-sign. The whitelist naturally
// rejects NUL/CR/LF, spaces, backslashes (Windows separator), and colons
// (Windows drive letter), so we can keep the regex free of control-char
// escapes that oxlint flags.
const SafeFilePathChars = /^[A-Za-z0-9._\-/+@]+$/;

const MAX_LINE = 1_000_000;
const MAX_FILE_PATH = 1024;
const MAX_WALKTHROUGH = 50_000;
const MAX_FINDINGS_PER_RESPONSE = 100;

function isSafeRelativeFilePath(path: string): boolean {
  if (path.startsWith("/")) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const LLMFindingSchema = z
  .strictObject({
    severity: SeveritySchema,
    category: CategorySchema,
    file: z
      .string()
      .min(1)
      .max(MAX_FILE_PATH)
      .regex(SafeFilePathChars, "must contain only safe path characters")
      .refine(isSafeRelativeFilePath, "must be a relative repo path without traversal segments"),
    line_start: z.number().int().positive().max(MAX_LINE),
    line_end: z.number().int().positive().max(MAX_LINE),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    cwe: z.string().regex(CwePattern).optional(),
  })
  .superRefine((finding, ctx) => {
    if (finding.line_start > finding.line_end) {
      ctx.addIssue({
        code: "custom",
        path: ["line_end"],
        message: "line_end must be >= line_start",
      });
    }
  });
export type LLMFinding = z.infer<typeof LLMFindingSchema>;

// `LLMFindingSchema` deliberately omits `id`, `source`, `confidence`, and
// `suggestion` from `@sovri/core`'s `FindingSchema`: those fields are
// deterministic and are assigned by `@sovri/review-engine` after Zod-parsing
// the LLM payload. Passing an `LLMFinding` where a `Finding` is expected is
// a type error by design.
export const LLMResponseSchema = z.strictObject({
  summary: z.string().min(1).max(2000),
  findings: z.array(LLMFindingSchema).max(MAX_FINDINGS_PER_RESPONSE),
  walkthrough_markdown: z.string().min(1).max(MAX_WALKTHROUGH),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;
