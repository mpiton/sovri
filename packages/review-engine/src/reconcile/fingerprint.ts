// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { createHash } from "node:crypto";

import type { Diff, Finding } from "@sovri/core";

import { iterateRightSideLines } from "../diff/right-side-lines.js";

const FINGERPRINT_VERSION = "v1";
// Unit Separator (U+001F): joins the fingerprint components so a value that
// contains the delimiter character used between fields cannot forge a collision.
const UNIT_SEPARATOR = "\u001F";
const FINGERPRINT_LENGTH = 16;

type ExtractedAnchor =
  | { kind: "source"; text: string }
  | { kind: "blank-source"; lineStart: number; lineEnd: number }
  | { kind: "missing" };

/**
 * Compute a stable, content-derived fingerprint for a finding, used to
 * reconcile findings across review runs (deduplication and resolution).
 *
 * The fingerprint is independent of line numbers (it survives code shifts) and
 * of LLM-generated metadata such as title, category, or CWE. Its anchor is the
 * targeted source text from the diff, else the finding body — never the title.
 */
export function computeFindingFingerprint(finding: Finding, diff: Diff): string {
  const anchor = computeAnchor(finding, diff);
  const preimage = [FINGERPRINT_VERSION, finding.file, anchor].join(UNIT_SEPARATOR);
  return createHash("sha256").update(preimage).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

function computeAnchor(finding: Finding, diff: Diff): string {
  const anchor = extractAnchorSource(finding, diff);
  if (anchor.kind === "source") {
    return `code:${normalizeCode(anchor.text)}`;
  }
  if (anchor.kind === "blank-source") {
    return `blank:${anchor.lineStart}:${anchor.lineEnd}`;
  }
  return `body:${normalizeProse(finding.body)}`;
}

// Source code is case- and character-sensitive: canonical-normalize (NFC) and
// collapse only insignificant whitespace. Do NOT lowercase or apply
// compatibility (NFKC) folding — that would merge genuinely different code
// (e.g. `Query` vs `query`) into one identity and hide a real change.
function normalizeCode(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

// The body is natural-language prose: fold case and compatibility forms so
// trivial re-wording of the same explanation keeps the same identity.
function normalizeProse(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function extractAnchorSource(finding: Finding, diff: Diff): ExtractedAnchor {
  const file = diff.files.find((candidate) => candidate.path === finding.file);
  if (file === undefined) {
    return { kind: "missing" };
  }

  let sawCandidate = false;
  for (const hunk of file.hunks) {
    for (const { lineNumber, text } of iterateRightSideLines(hunk)) {
      if (lineNumber >= finding.line_start && lineNumber <= finding.line_end) {
        sawCandidate = true;
        if (text.trim() !== "") {
          return { kind: "source", text };
        }
      }
    }
  }

  if (sawCandidate) {
    return {
      kind: "blank-source",
      lineStart: finding.line_start,
      lineEnd: finding.line_end,
    };
  }

  return { kind: "missing" };
}
