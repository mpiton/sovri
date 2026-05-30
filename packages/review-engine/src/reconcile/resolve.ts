// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * A finding comment the bot previously posted, as reconstructed from the GitHub
 * API. `fingerprint` is the value parsed from the `sovri-finding-id` marker, or
 * `undefined` when the comment carries no marker (e.g. the walkthrough summary).
 */
export type PostedComment = {
  readonly nodeId: string;
  readonly fingerprint?: string;
};

/**
 * Classify which previously-posted finding comments are now resolved: a comment
 * whose fingerprint the current review run no longer produces points at code
 * that is gone or fixed, so it is marked outdated. Returns the GraphQL node ids
 * to minimize.
 *
 * Identity is the line-independent fingerprint, not a line number: a finding
 * that merely moved is still produced this run (same fingerprint) and is NOT
 * resolved, and a deleted line whose number is reused by unrelated code does not
 * keep a stale comment alive. A finding the LLM transiently omits is minimized
 * here but re-posted on the next run it reappears (see R-05), so the action is
 * self-healing. Comments without a marker are never classified. Pure — the
 * caller performs the GitHub I/O.
 */
export function classifyResolvedComments(
  posted: readonly PostedComment[],
  currentFingerprints: ReadonlySet<string>,
): string[] {
  const resolved: string[] = [];
  for (const comment of posted) {
    if (comment.fingerprint === undefined) {
      continue;
    }
    if (!currentFingerprints.has(comment.fingerprint)) {
      resolved.push(comment.nodeId);
    }
  }
  return resolved;
}
