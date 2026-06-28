// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "zod";

const TRIPLE_BACKTICK = "`".repeat(3);
export const SYSTEM_PROMPT_MAX_BYTES = 1024;

// Shared reviewer contract. The model reviews — it does not narrate. These lines (with the required
// `recommendation`) are the prompt half of issue #2450's defense in depth; the schema enforces the
// same field so the contract survives prompt decay across models.
// Sovri reviews for regulated compliance only. Every finding must be a security or correctness
// weakness that can anchor a CWE → framework reference; the prompt no longer solicits generic bug,
// style, performance, or maintainability review (the compliance pivot — ADR-021, MAT-76). There is a
// single compliance review behaviour (MAT-78); the legacy full/bugs-only/strict/minimal modes are
// removed.
const REVIEWER_DIRECTIVES = [
  "Never describe what the code does; a hunk with no issue yields no finding.",
  "Each finding states the problem and its impact in `body` and the concrete fix in `recommendation`.",
  "Write a neutral one-paragraph `summary` separately from the findings.",
  "Return structured JSON findings that match the requested schema.",
  "On every finding, set `cwe` to its CWE id (for example CWE-89) and `confidence` to a number between 0 and 1 reflecting your honest certainty. A resolved `cwe` maps the finding to GDPR, DORA, AI Act, and NIS2 references, so a missing one drops that compliance context.",
];

const COMPLIANCE_REVIEW_SYSTEM_TEMPLATE = [
  "You are Sovri's review engine.",
  "Review only the supplied pull request metadata and unified diff.",
  "Report only security and correctness weaknesses that map to a known CWE, such as injection, broken authentication or access control, secret and credential exposure, unsafe cryptography, and memory or resource safety.",
  ...REVIEWER_DIRECTIVES,
].join(" ");

export const ReviewPromptModeSchema = z.enum(["compliance"]);
export type ReviewPromptMode = z.infer<typeof ReviewPromptModeSchema>;

export const SystemPromptConfigSchema = z.strictObject({
  mode: ReviewPromptModeSchema,
});

export type SystemPromptConfig = z.input<typeof SystemPromptConfigSchema>;

export class PromptTemplateSizeError extends Error {
  readonly templateBytes: number;
  readonly maxBytes: number;

  constructor(templateBytes: number, maxBytes = SYSTEM_PROMPT_MAX_BYTES) {
    super(`System prompt template exceeds ${maxBytes} UTF-8 bytes`);
    this.name = "PromptTemplateSizeError";
    this.templateBytes = templateBytes;
    this.maxBytes = maxBytes;
  }
}

export const PullRequestPromptContextSchema = z.strictObject({
  number: z.number().int().positive(),
  repoFullName: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
});

export type PullRequestPromptContext = z.infer<typeof PullRequestPromptContextSchema>;

function escapeUserPromptContent(content: string): string {
  return content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(TRIPLE_BACKTICK, "``\u{200B}`");
}

function fencedUserData(language: string, content: string): string {
  return `${TRIPLE_BACKTICK}${language}\n${escapeUserPromptContent(content)}\n${TRIPLE_BACKTICK}`;
}

function formatDescription(description: string | null): string {
  return description === null || description.length === 0 ? "(none)" : description;
}

function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function validateSystemTemplateSize(template: string): string {
  const templateBytes = utf8ByteLength(template);

  if (templateBytes > SYSTEM_PROMPT_MAX_BYTES) {
    throw new PromptTemplateSizeError(templateBytes);
  }

  return template;
}

export function buildSystemPrompt(config: unknown): string {
  // Validates `mode === "compliance"` via the schema (any other value is a Zod
  // error) and returns the single compliance template. No per-mode branching
  // survives the compliance pivot (MAT-78).
  SystemPromptConfigSchema.parse(config);

  return validateSystemTemplateSize(COMPLIANCE_REVIEW_SYSTEM_TEMPLATE);
}

// Few-shot lives here, not in the system prompt, because the system template is capped at 1024 bytes
// (issue #2450). One worked finding and one forbidden narration teach the problem/fix shape concretely.
const FEW_SHOT_PREAMBLE = [
  "Findings flag a problem and its fix — they never narrate the change.",
  "Good finding:",
  "  title: SQL injection in user lookup",
  "  body: The handler concatenates req.query.email into the SQL string, so a crafted value runs arbitrary SQL.",
  "  recommendation: Use a parameterized query instead of string concatenation.",
  "  cwe: CWE-89",
  "  confidence: 0.9",
  "Forbidden narration (emit nothing instead):",
  "  title: Added generateAuthContent function",
  "  body: A new function was added to generate crawler-friendly content for auth routes.",
];

export function buildUserPrompt(diff: string, prContext: PullRequestPromptContext): string {
  const context = PullRequestPromptContextSchema.parse(prContext);

  return [
    ...FEW_SHOT_PREAMBLE,
    "",
    "Review this pull request.",
    "Repository:",
    fencedUserData("text", context.repoFullName),
    `Pull request: #${context.number}`,
    "Title:",
    fencedUserData("text", context.title),
    "Description:",
    fencedUserData("text", formatDescription(context.description)),
    "",
    "Diff:",
    fencedUserData("diff", diff),
  ].join("\n");
}
