// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { posix } from "node:path";

import { z } from "@sovri/core";

import type { SarifResult } from "./reader.js";

// Safe resolution of a SARIF result's physical location to a repo-relative file.
// A SARIF uri is untrusted contributor input: a non-relative scheme, an absolute
// path, or a traversal that escapes the repository is refused (the finding is
// dropped), never surfaced on a file the pull request never touched.

export type FileDropReason =
  | "no-physical-location"
  | "non-relative-uri"
  | "absolute-path"
  | "path-escape"
  | "unresolved-uri-base-id";

export type FileResolution = { readonly file: string } | { readonly dropped: FileDropReason };

/**
 * Resolve the repo-relative file for a SARIF result's primary physical location,
 * or return the reason it was dropped. The uri chain is
 * `artifactLocation.uri ?? run.artifacts[index].location.uri`, with `uriBaseId`
 * resolved against `run.originalUriBaseIds` or refused, percent-decoded, then
 * checked for scheme / absolute / traversal escapes before normalization.
 */
const ArtifactLocationSchema = z.looseObject({
  uri: z.string().optional(),
  uriBaseId: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
});

const ResultLocationSchema = z.looseObject({
  locations: z
    .array(
      z.looseObject({
        physicalLocation: z
          .looseObject({ artifactLocation: ArtifactLocationSchema.optional() })
          .optional(),
      }),
    )
    .optional(),
});

const RunContextSchema = z.looseObject({
  artifacts: z
    .array(z.looseObject({ location: z.looseObject({ uri: z.string().optional() }).optional() }))
    .optional(),
  originalUriBaseIds: z
    .record(z.string(), z.looseObject({ uri: z.string().optional() }))
    .optional(),
});

const UriSchemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

export function resolveSarifFile(
  result: SarifResult,
  run?: Record<string, unknown>,
): FileResolution {
  const view = ResultLocationSchema.safeParse(result);
  const artifactLocation = view.success
    ? view.data.locations?.[0]?.physicalLocation?.artifactLocation
    : undefined;
  if (artifactLocation === undefined) {
    return { dropped: "no-physical-location" };
  }

  const runData = parseRunContext(run);

  let uri = artifactLocation.uri;
  if (uri === undefined && artifactLocation.index !== undefined) {
    uri = runData?.artifacts?.[artifactLocation.index]?.location?.uri;
  }
  if (uri === undefined) {
    return { dropped: "no-physical-location" };
  }

  if (UriSchemePattern.test(uri)) {
    return { dropped: "non-relative-uri" };
  }

  if (artifactLocation.uriBaseId !== undefined) {
    const base = runData?.originalUriBaseIds?.[artifactLocation.uriBaseId]?.uri;
    if (base === undefined) {
      return { dropped: "unresolved-uri-base-id" };
    }
    uri = posix.join(base, uri);
  }

  const decoded = safeDecode(uri);
  if (decoded === undefined) {
    return { dropped: "non-relative-uri" };
  }
  if (decoded.startsWith("/")) {
    return { dropped: "absolute-path" };
  }

  const normalized = posix.normalize(decoded);
  if (normalized === ".." || normalized.startsWith("../")) {
    return { dropped: "path-escape" };
  }
  if (normalized.startsWith("/")) {
    return { dropped: "absolute-path" };
  }

  return { file: normalized.replace(/^\.\//u, "") };
}

function parseRunContext(
  run: Record<string, unknown> | undefined,
): z.infer<typeof RunContextSchema> | undefined {
  if (run === undefined) {
    return undefined;
  }
  const parsed = RunContextSchema.safeParse(run);
  return parsed.success ? parsed.data : undefined;
}

function safeDecode(uri: string): string | undefined {
  try {
    return decodeURIComponent(uri);
  } catch {
    return undefined;
  }
}
