// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "zod";

const TRIPLE_BACKTICK = "`".repeat(3);
export const SYSTEM_PROMPT_MAX_BYTES = 1024;

const FULL_REVIEW_SYSTEM_TEMPLATE = [
  "You are Sovri's review engine.",
  "Review only the supplied pull request metadata and unified diff.",
  "Return structured JSON findings that match the requested schema.",
].join(" ");

const BUGS_ONLY_REVIEW_SYSTEM_TEMPLATE = [
  "You are Sovri's review engine.",
  "Review only the supplied pull request metadata and unified diff.",
  "Focus on correctness bugs that can change runtime behavior.",
  "Ignore style-only findings and formatting nits.",
  "Ignore performance-only findings unless they cause incorrect behavior.",
  "Return structured JSON findings that match the requested schema.",
].join(" ");

const STRICT_REVIEW_SYSTEM_TEMPLATE = [
  "You are Sovri's review engine.",
  "Review only the supplied pull request metadata and unified diff.",
  "Hold the diff to a high bar.",
  "Report all valid blocker, major, and minor issues, including maintainability, style, readability, and test-quality concerns that justify at least minor severity.",
  "Return structured JSON findings that match the requested schema.",
].join(" ");

const MINIMAL_REVIEW_SYSTEM_TEMPLATE = [
  "You are Sovri's review engine.",
  "Review only the supplied pull request metadata and unified diff.",
  "Return at most 3 findings.",
  "Include only blocker or major severity findings.",
  "Suppress nits, style-only comments, and minor findings.",
  "Return structured JSON findings that match the requested schema.",
].join(" ");

export const ReviewPromptModeSchema = z.enum(["full", "bugs-only", "strict", "minimal"]);
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
  const parsedConfig = SystemPromptConfigSchema.parse(config);

  if (parsedConfig.mode === "bugs-only") {
    return validateSystemTemplateSize(BUGS_ONLY_REVIEW_SYSTEM_TEMPLATE);
  }

  if (parsedConfig.mode === "strict") {
    return validateSystemTemplateSize(STRICT_REVIEW_SYSTEM_TEMPLATE);
  }

  if (parsedConfig.mode === "minimal") {
    return validateSystemTemplateSize(MINIMAL_REVIEW_SYSTEM_TEMPLATE);
  }

  return validateSystemTemplateSize(FULL_REVIEW_SYSTEM_TEMPLATE);
}

export function buildUserPrompt(diff: string, prContext: PullRequestPromptContext): string {
  const context = PullRequestPromptContextSchema.parse(prContext);

  return [
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
