// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { DiffSchema, z, type Diff, type FileChange, type FileChangeStatus } from "@sovri/core";
import parseDiff from "parse-diff";
import { splitFilePatches } from "./split-file-patches.js";

const UnknownFileSha = "0000000000000000000000000000000000000000";
const FullShaPattern = /^[a-f0-9]{40}$/;

const ParsedDiffChangeSchema = z
  .object({
    type: z.enum(["normal", "add", "del"]),
    content: z.string(),
  })
  .passthrough();

const ParsedDiffChunkSchema = z
  .object({
    content: z.string(),
    changes: z.array(ParsedDiffChangeSchema),
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
  })
  .passthrough();

const ParsedDiffFileSchema = z
  .object({
    chunks: z.array(ParsedDiffChunkSchema),
    deletions: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    from: z.string().optional(),
    to: z.string().optional(),
    index: z.array(z.string()).optional(),
    deleted: z.literal(true).optional(),
    new: z.literal(true).optional(),
    renamed: z.literal(true).optional(),
  })
  .passthrough();

export const ParsedReviewDiffSchema = z.array(ParsedDiffFileSchema);
export type ParsedReviewDiff = z.infer<typeof ParsedReviewDiffSchema>;
export type ParsedReviewDiffFile = z.infer<typeof ParsedDiffFileSchema>;

export class DiffParseError extends Error {
  public override readonly name = "DiffParseError";

  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

export function parseReviewDiff(unifiedDiff: string): ParsedReviewDiff {
  return parseParsedDiff(unifiedDiff);
}

export function parseUnifiedDiff(raw: string): Diff {
  if (raw.trim().length > 0 && !hasGitFileHeader(raw)) {
    throw new DiffParseError("Unable to parse unified diff: input is not a unified Git diff");
  }
  const parsedFiles = parseParsedDiff(raw);
  if (raw.trim().length > 0 && parsedFiles.length === 0) {
    throw new DiffParseError("Unable to parse unified diff: input is not a unified Git diff");
  }
  return mapParsedDiffFiles(parsedFiles, raw);
}

function hasGitFileHeader(raw: string): boolean {
  return /^diff --git /mu.test(raw);
}

export function mapParsedDiffFiles(parsedFiles: unknown, unifiedDiff: string): Diff {
  const parseResult = ParsedReviewDiffSchema.safeParse(parsedFiles);
  if (!parseResult.success) {
    throw new DiffParseError(
      "Unable to parse unified diff: parse-diff returned an unsupported shape",
      {
        cause: parseResult.error,
      },
    );
  }

  const filePatches = splitFilePatches(unifiedDiff);
  const files = parseResult.data.map((file, index) => mapParsedFile(file, filePatches[index]));
  const diffResult = DiffSchema.safeParse({ unified_diff: unifiedDiff, files });

  if (!diffResult.success) {
    throw new DiffParseError("Parsed unified diff does not satisfy DiffSchema", {
      cause: diffResult.error,
    });
  }

  return diffResult.data;
}

function parseParsedDiff(unifiedDiff: string): ParsedReviewDiff {
  try {
    return ParsedReviewDiffSchema.parse(parseDiff(unifiedDiff));
  } catch (error) {
    throw new DiffParseError("Unable to parse unified diff: parser output validation failed", {
      cause: error,
    });
  }
}

function mapParsedFile(file: ParsedReviewDiffFile, patch: string | undefined): FileChange {
  const fromPath = normalizeGitPath(file.from);
  const toPath = normalizeGitPath(file.to);
  const path = toPath ?? fromPath;

  if (path === undefined) {
    throw new DiffParseError("Unable to parse unified diff: file path could not be normalized");
  }

  const status = resolveStatus(file, fromPath, toPath);
  const previousPath = status === "renamed" ? fromPath : undefined;
  const isBinary = patch === undefined ? false : isBinaryPatch(patch);

  return {
    path,
    ...(previousPath === undefined ? {} : { previous_path: previousPath }),
    status,
    additions: file.additions,
    deletions: file.deletions,
    sha: resolveSha(file),
    patch: isBinary ? null : (patch ?? ""),
    hunks: file.chunks.map((chunk) => ({
      old_start: chunk.oldStart,
      old_lines: chunk.oldLines,
      new_start: chunk.newStart,
      new_lines: chunk.newLines,
      header: chunk.content,
      lines: chunk.changes.map((change) => change.content),
    })),
  };
}

function resolveStatus(
  file: ParsedReviewDiffFile,
  fromPath: string | undefined,
  toPath: string | undefined,
): FileChangeStatus {
  if (file.deleted === true || file.to === "/dev/null") {
    return "removed";
  }
  if (file.new === true || file.from === "/dev/null") {
    return "added";
  }
  if (
    file.renamed === true ||
    (fromPath !== undefined && toPath !== undefined && fromPath !== toPath)
  ) {
    return "renamed";
  }
  return "modified";
}

function resolveSha(file: ParsedReviewDiffFile): string {
  const indexRange = file.index?.[0];
  const newSha = indexRange?.split("..")[1];
  return newSha !== undefined && FullShaPattern.test(newSha) ? newSha : UnknownFileSha;
}

function normalizeGitPath(path: string | undefined): string | undefined {
  if (path === undefined || path === "/dev/null") {
    return undefined;
  }
  return path;
}

function isBinaryPatch(patch: string): boolean {
  return /^Binary files .+ differ$/mu.test(patch) || /^GIT binary patch$/mu.test(patch);
}
