// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createHash } from "node:crypto";

import type { Diff, Finding } from "@sovri/core";

import { iterateRightSideLines } from "../diff/right-side-lines.js";

const FINGERPRINT_VERSION = "v1";
// Unit Separator (U+001F): joins the fingerprint components so a value that
// contains the delimiter character used between fields cannot forge a collision.
const UNIT_SEPARATOR = "\u001F";
const FINGERPRINT_LENGTH = 16;

/**
 * Compute a stable, content-derived fingerprint for a finding, used to
 * reconcile findings across review runs (deduplication and resolution).
 *
 * The fingerprint is independent of line numbers (it survives code shifts) and
 * of the LLM-generated title (it survives re-wording). Its anchor is, in order
 * of precedence: the finding's CWE id, else the targeted source text from the
 * diff, else the finding body — never the title.
 */
export function computeFindingFingerprint(finding: Finding, diff: Diff): string {
  const anchor = computeAnchor(finding, diff);
  const preimage = [FINGERPRINT_VERSION, finding.category, finding.file, anchor].join(
    UNIT_SEPARATOR,
  );
  return createHash("sha256").update(preimage).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

function computeAnchor(finding: Finding, diff: Diff): string {
  const source = normalizeCode(extractAnchorSource(finding, diff));
  const locator = source !== "" ? `code:${source}` : `body:${normalizeProse(finding.body)}`;

  // A CWE narrows the class of issue but does not identify the site, so the
  // targeted code (or body) is always part of the anchor: two CWE-89 sinks with
  // DIFFERENT code in the same file stay distinct. Byte-identical duplicated
  // code is the one case that intentionally shares an identity — a within-run
  // occurrence ordinal would distinguish them but flips when the model reorders
  // findings across runs, reintroducing the #1965 duplicate-on-re-review bug.
  if (finding.cwe !== undefined) {
    return `cwe:${finding.cwe}${UNIT_SEPARATOR}${locator}`;
  }

  return locator;
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

function extractAnchorSource(finding: Finding, diff: Diff): string {
  const file = diff.files.find((candidate) => candidate.path === finding.file);
  if (file === undefined) {
    return "";
  }

  const texts: string[] = [];
  for (const hunk of file.hunks) {
    for (const { lineNumber, text } of iterateRightSideLines(hunk)) {
      if (lineNumber >= finding.line_start && lineNumber <= finding.line_end) {
        texts.push(text);
      }
    }
  }

  return texts.join("\n");
}
