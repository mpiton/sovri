// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// SARIF input bounds, enforced BEFORE any parsing work so a hostile artifact
// cannot exhaust memory or the JSON.parse call stack. The byte and nesting
// checks run on the raw string; the findings cap runs on already-mapped results.

const REPORT_MAX_BYTES = 10_485_760; // 10 MiB, inclusive
const MAX_NESTING_DEPTH = 64; // inclusive; guards a JSON.parse stack overflow
const MAX_SARIF_FINDINGS_PER_REVIEW = 1_000; // deterministic overflow drop

export type ReportBoundsViolation = {
  readonly reason: "report-too-large" | "nesting-too-deep";
  readonly observed: number;
  readonly limit: number;
};

export type FindingsCapResult<T> = {
  readonly kept: readonly T[];
  readonly dropped: number;
};

/**
 * Check one untrusted SARIF report string against the byte and nesting-depth
 * bounds, WITHOUT parsing it into objects. Returns the first violation found
 * (byte cap takes precedence over depth) or `null` when the report is within
 * bounds. The caller skips a violating report and proceeds with the LLM review.
 */
export function checkReportBounds(raw: string): ReportBoundsViolation | null {
  const observedBytes = new TextEncoder().encode(raw).byteLength;
  if (observedBytes > REPORT_MAX_BYTES) {
    return { reason: "report-too-large", observed: observedBytes, limit: REPORT_MAX_BYTES };
  }

  const observedDepth = maxNestingDepth(raw);
  if (observedDepth > MAX_NESTING_DEPTH) {
    return { reason: "nesting-too-deep", observed: observedDepth, limit: MAX_NESTING_DEPTH };
  }

  return null;
}

// Maximum `{`/`[` nesting depth of the raw string, scanned character by
// character without parsing. Braces inside JSON strings (and their escapes) are
// ignored, so a value like `"a{b"` does not inflate the depth. Linear, no
// backtracking — safe to run on a capped but still large untrusted input.
function maxNestingDepth(raw: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;

  for (const char of raw) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > max) {
        max = depth;
      }
    } else if ((char === "}" || char === "]") && depth > 0) {
      depth -= 1;
    }
  }

  return max;
}

/**
 * Cap the number of mapped SARIF findings for one review. Keeps the first 1000
 * items in order and reports how many were dropped; the drop is deterministic
 * (always the same tail) for reproducibility.
 */
export function capFindings<T>(items: readonly T[]): FindingsCapResult<T> {
  if (items.length <= MAX_SARIF_FINDINGS_PER_REVIEW) {
    return { kept: items, dropped: 0 };
  }

  return {
    kept: items.slice(0, MAX_SARIF_FINDINGS_PER_REVIEW),
    dropped: items.length - MAX_SARIF_FINDINGS_PER_REVIEW,
  };
}
