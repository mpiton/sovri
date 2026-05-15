// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import parseDiff from "parse-diff";
import { z } from "zod";

const DiffChangeSchema = z
  .object({
    type: z.enum(["normal", "add", "del"]),
    content: z.string(),
  })
  .passthrough();

const DiffChunkSchema = z
  .object({
    content: z.string(),
    changes: z.array(DiffChangeSchema),
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
  })
  .passthrough();

const ParsedDiffFileSchema = z
  .object({
    chunks: z.array(DiffChunkSchema),
    deletions: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .passthrough();

export const ParsedReviewDiffSchema = z.array(ParsedDiffFileSchema);
export type ParsedReviewDiff = z.infer<typeof ParsedReviewDiffSchema>;
export type ParsedReviewDiffFile = z.infer<typeof ParsedDiffFileSchema>;

export function parseReviewDiff(unifiedDiff: string): ParsedReviewDiff {
  return ParsedReviewDiffSchema.parse(parseDiff(unifiedDiff));
}
