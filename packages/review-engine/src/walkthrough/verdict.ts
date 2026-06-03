// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { computeSeverityRank, type Finding } from "@sovri/core";

// The verdict is the deterministic Approve / Request-changes outcome a maintainer reads at the top
// of the walkthrough. It is computed once here so the same outcome can be reused wherever it must
// appear (e.g. the `Sovri / review` check conclusion). GitHub strips CSS in PR comments (ADR-016),
// so the banner is an emoji heading — never a styled element.
export type Verdict =
  | { readonly kind: "approve"; readonly label: string }
  | { readonly kind: "request-changes"; readonly label: string };

// Request changes as soon as a single finding is ranked at or above `major`; otherwise approve
// (zero findings approve). `computeSeverityRank` from @sovri/core is the one rank source of truth.
const RequestChangesRank = computeSeverityRank("major");

export function computeVerdict(findings: readonly Finding[]): Verdict {
  const blocking = findings.some(
    (finding) => computeSeverityRank(finding.severity) >= RequestChangesRank,
  );

  return blocking
    ? { kind: "request-changes", label: "Request changes" }
    : { kind: "approve", label: "Approve" };
}

// @sovri/brand carries no verdict palette (it covers severity and category only), so these
// conventional glyphs live next to the verdict they render. Neither collides with the severity
// scale (⛔🔴🟡ℹ️💬).
const VerdictGlyph: Record<Verdict["kind"], string> = {
  approve: "✅",
  "request-changes": "❌",
};

// The verdict header: an H2 emoji banner heading and a one-line finding count. The count is the
// total only here; the per-severity breakdown is added where its rule requires it.
export function renderVerdictHeader(verdict: Verdict, findings: readonly Finding[]): string[] {
  const total = findings.length;
  const countLine = `${total} ${total === 1 ? "finding" : "findings"}`;

  return [`## ${VerdictGlyph[verdict.kind]} ${verdict.label}`, "", countLine];
}
