// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { DiffSchema, FindingSchema, z, type Diff, type Finding } from "@sovri/core";

import { iterateRightSideLines } from "../diff/right-side-lines.js";
import { computeFindingFingerprint } from "../reconcile/fingerprint.js";
import { renderFindingMarker } from "../reconcile/marker.js";

const MinimumMarkdownFenceLength = 3;
const BacktickRunPattern = /`+/gu;

const InlineFindingSchema = FindingSchema.superRefine((finding, context) => {
  if (finding.line_start > finding.line_end) {
    context.addIssue({
      code: "custom",
      path: ["line_end"],
      message: "line_end must be greater than or equal to line_start",
    });
  }
});

export const InlineCommentDraftSchema = z
  .object({
    path: z.string().min(1),
    body: z.string().min(1),
    start_line: z.number().int().positive().optional(),
    start_side: z.literal("RIGHT").optional(),
    line: z.number().int().positive(),
    side: z.literal("RIGHT"),
  })
  .strict()
  .superRefine((draft, context) => {
    const hasStartLine = draft.start_line !== undefined;
    const hasStartSide = draft.start_side !== undefined;
    if (hasStartLine !== hasStartSide) {
      context.addIssue({
        code: "custom",
        path: [hasStartLine ? "start_side" : "start_line"],
        message: "start_line and start_side must both be provided or both omitted",
      });
    }
  });

export type InlineCommentDraft = z.infer<typeof InlineCommentDraftSchema>;

export class InlineSuggestionAnchorError extends Error {
  public override readonly name = "InlineSuggestionAnchorError";
}

export function buildInlineComments(
  findings: readonly Finding[],
  diff: Diff,
): InlineCommentDraft[] {
  const validFindings = z.array(InlineFindingSchema).parse(findings);
  const parsedDiff = DiffSchema.parse(diff);
  const rightSideLinesByPath = collectRightSideLines(parsedDiff);

  return validFindings
    .filter((finding) => isFindingAnchorable(finding, rightSideLinesByPath))
    .map((finding) => buildInlineCommentDraft(finding, parsedDiff));
}

function buildInlineCommentDraft(finding: Finding, diff: Diff): InlineCommentDraft {
  assertCommittableSuggestionAnchor(finding);

  const base = {
    path: finding.file,
    body: formatInlineBody(finding, computeFindingFingerprint(finding, diff)),
  };

  if (finding.line_start === finding.line_end) {
    return InlineCommentDraftSchema.parse({
      ...base,
      line: finding.line_start,
      side: "RIGHT",
    });
  }

  return InlineCommentDraftSchema.parse({
    ...base,
    start_line: finding.line_start,
    start_side: "RIGHT",
    line: finding.line_end,
    side: "RIGHT",
  });
}

function formatInlineBody(finding: Finding, fingerprint: string): string {
  const body = [`**${finding.title}**`, "", finding.body].join("\n");
  const auditLine = finding.audit_reference
    ? `\n\n🔍 Audit Reference: ${finding.audit_reference}`
    : "";
  const suggestionBlock = renderCommittableSuggestionBlock(finding);
  return `${body}${auditLine}${suggestionBlock}\n\n${renderFindingMarker(fingerprint)}`;
}

function assertCommittableSuggestionAnchor(finding: Finding): void {
  if (finding.suggestion?.committable === true && finding.line_start !== finding.line_end) {
    throw new InlineSuggestionAnchorError(
      "committable suggestion requires a single-line inline anchor",
    );
  }
}

function renderCommittableSuggestionBlock(finding: Finding): string {
  if (finding.suggestion?.committable !== true) {
    return "";
  }

  const fence = markdownFenceFor(finding.suggestion.code);
  return `\n\n${fence}suggestion\n${finding.suggestion.code}\n${fence}`;
}

function markdownFenceFor(code: string): string {
  const longestBacktickRun = Array.from(
    code.matchAll(BacktickRunPattern),
    (match) => match[0].length,
  ).reduce((longest, length) => Math.max(longest, length), 0);

  return "`".repeat(Math.max(MinimumMarkdownFenceLength, longestBacktickRun + 1));
}

function collectRightSideLines(diff: Diff): ReadonlyMap<string, ReadonlySet<number>> {
  const linesByPath = new Map<string, Set<number>>();

  for (const file of diff.files) {
    const rightSideLines = new Set<number>();
    for (const hunk of file.hunks) {
      addHunkRightSideLines(rightSideLines, hunk);
    }
    linesByPath.set(file.path, rightSideLines);
  }

  return linesByPath;
}

function addHunkRightSideLines(
  rightSideLines: Set<number>,
  hunk: Diff["files"][number]["hunks"][number],
): void {
  for (const { lineNumber } of iterateRightSideLines(hunk)) {
    rightSideLines.add(lineNumber);
  }
}

function isFindingAnchorable(
  finding: Finding,
  linesByPath: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  const rightSideLines = linesByPath.get(finding.file);
  if (rightSideLines === undefined) {
    return false;
  }

  for (let line = finding.line_start; line <= finding.line_end; line += 1) {
    if (!rightSideLines.has(line)) {
      return false;
    }
  }

  return true;
}
