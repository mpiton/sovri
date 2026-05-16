// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "zod";

const TRIPLE_BACKTICK = "`".repeat(3);

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
