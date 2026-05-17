// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { DiffSchema, FindingSchema, z, type Diff, type Finding } from "@sovri/core";

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
  .strict();

export type InlineCommentDraft = z.infer<typeof InlineCommentDraftSchema>;

export function buildInlineComments(
  findings: readonly Finding[],
  diff: Diff,
): InlineCommentDraft[] {
  const validFindings = z.array(InlineFindingSchema).parse(findings);
  const rightSideLinesByPath = collectRightSideLines(DiffSchema.parse(diff));

  return validFindings
    .filter((finding) => isFindingAnchorable(finding, rightSideLinesByPath))
    .map((finding) => buildInlineCommentDraft(finding));
}

function buildInlineCommentDraft(finding: Finding): InlineCommentDraft {
  const base = {
    path: finding.file,
    body: formatInlineBody(finding),
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

function formatInlineBody(finding: Finding): string {
  return [`**${finding.title}**`, "", finding.body].join("\n");
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
  let lineNumber = hunk.new_start;

  for (const line of hunk.lines) {
    if (line.startsWith("-") || line.startsWith("\\")) {
      continue;
    }

    rightSideLines.add(lineNumber);
    lineNumber += 1;
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
