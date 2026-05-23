// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

// Bounds applied at the schema boundary so a hostile `.sovri.yml` cannot
// DoS the bot via oversized strings, oversized arrays, or runaway
// per-review LLM context. The numeric ceilings are an order of magnitude
// above the defaults (50 / 5000) and well below what any single LLM call
// can usefully consume.
const MAX_MODEL_LEN = 256;
const MAX_API_KEY_SECRET_LEN = 128;
const MAX_BASE_URL_LEN = 2048;
const MAX_IGNORE_PATTERN_LEN = 1024;
const MAX_IGNORE_PATTERNS = 1000;
const MAX_FILES_PER_REVIEW = 500;
const MAX_LINES_PER_REVIEW = 50_000;

// `apiKeySecret` is the *name* of the environment variable holding the
// real key, never the key itself. The regex matches UPPER_SNAKE_CASE
// identifiers so a real secret pasted by mistake (typically lowercase,
// containing hyphens, etc.) is rejected at the boundary before it can
// reach a logger, span, or error trace.
const EnvVarNamePattern = /^[A-Z_][A-Z0-9_]*$/;

// Model identifier is concatenated into LLM SDK requests verbatim.
// Restricting the character set blocks log/prompt injection via newlines,
// NUL bytes, control characters, and Unicode bidi overrides.
const ModelNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * Full list of providers Sovri intends to support eventually. The runtime
 * `.refine()` on `LlmSchema.provider` narrows acceptance to the v0.2
 * allow-list `{"anthropic", "mistral"}`; the enum itself stays wide so
 * the inferred TypeScript shape stays stable across releases and
 * downstream switch/case branches do not need to be re-typed when later
 * releases lift the refinement to cover `openai` / `openai-compatible`.
 */
export const ProviderSchema = z.enum(["anthropic", "mistral", "openai", "openai-compatible"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const ReviewModeSchema = z.enum(["full", "bugs-only", "strict", "minimal"]);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const SeverityThresholdSchema = z.enum(["blocker", "major", "minor"]);
export type SeverityThreshold = z.infer<typeof SeverityThresholdSchema>;

const LlmSchema = z.strictObject({
  provider: ProviderSchema.refine((value) => value === "anthropic" || value === "mistral", {
    message: "Only 'anthropic' and 'mistral' are enabled in this release.",
  }),
  model: z
    .string()
    .min(1)
    .max(MAX_MODEL_LEN)
    .regex(
      ModelNamePattern,
      "model must contain only letters, digits, dot, hyphen, underscore, or colon",
    ),
  baseUrl: z
    .url({ protocol: /^https$/ })
    .max(MAX_BASE_URL_LEN)
    .optional(),
  apiKeySecret: z
    .string()
    .min(1)
    .max(MAX_API_KEY_SECRET_LEN)
    .regex(
      EnvVarNamePattern,
      "apiKeySecret must be the *name* of an environment variable (UPPER_SNAKE_CASE), never the secret itself",
    ),
});

// `.prefault({})` (not `.default({})`): when the block is omitted, feed
// `{}` *into* the inner strictObject so the per-field `.default()`
// helpers fire. Zod 4's `.default(value)` instead requires `value` to
// already match the fully-populated output type, which would force us to
// duplicate every default literally on both sides of the schema.
const ReviewSchema = z
  .strictObject({
    mode: ReviewModeSchema.default("full"),
    autoReviewDrafts: z.boolean().default(false),
    severityThreshold: SeverityThresholdSchema.default("minor"),
  })
  .prefault({});

// See note on `ReviewSchema` above for the `.prefault({})` rationale.
const LimitsSchema = z
  .strictObject({
    maxFilesPerReview: z.number().int().positive().max(MAX_FILES_PER_REVIEW).default(50),
    maxLinesPerReview: z.number().int().positive().max(MAX_LINES_PER_REVIEW).default(5000),
  })
  .prefault({});

export const SovriConfigSchema = z.strictObject({
  llm: LlmSchema,
  review: ReviewSchema,
  ignores: z
    .array(z.string().min(1).max(MAX_IGNORE_PATTERN_LEN))
    .max(MAX_IGNORE_PATTERNS)
    .default([]),
  limits: LimitsSchema,
});

export type SovriConfig = z.infer<typeof SovriConfigSchema>;
