// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// The hidden marker embedded in every inline finding comment so a later review
// run can recover the finding's stable identity from the GitHub API. The name
// matches the existing dismiss convention (`sovri-finding-id`), so embedding it
// also activates dismissal of inline comments by id.
const FINDING_MARKER_PREFIX = "<!-- sovri-finding-id:";

// Anchored to the end of the body: the marker is always rendered as the last
// line, so anchoring prevents a marker-like token elsewhere in the comment
// (e.g. inside a quoted code snippet) from being mis-extracted.
/** Pattern matching the embedded finding marker; capture group 1 is the 16-hex fingerprint. */
export const FINDING_MARKER_PATTERN = /<!--\s*sovri-finding-id:\s*([0-9a-f]{16})\s*-->\s*$/u;

/** Render the hidden marker line for a finding fingerprint. */
export function renderFindingMarker(fingerprint: string): string {
  return `${FINDING_MARKER_PREFIX} ${fingerprint} -->`;
}

/** Extract a finding fingerprint from a comment body, or `undefined` when absent. */
export function extractFindingFingerprint(body: string): string | undefined {
  return FINDING_MARKER_PATTERN.exec(body)?.[1];
}
