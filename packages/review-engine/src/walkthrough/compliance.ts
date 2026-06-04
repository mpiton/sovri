// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ComplianceFramework, ComplianceReference, Finding } from "@sovri/core";

import { formatMarkdownText } from "./markdown.js";

interface ComplianceProvenance {
  readonly llmProvider: string;
  readonly llmModel: string;
}

const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  CWE: "CWE",
  "OWASP-TOP10-2021": "OWASP Top 10",
  "ISO27001-2022": "ISO 27001:2022",
  GDPR: "GDPR",
  DORA: "DORA",
  NIS2: "NIS2",
  "AI-ACT": "AI Act",
  CRA: "CRA",
};

export function renderComplianceSection(
  findings: readonly Finding[],
  provenance?: ComplianceProvenance,
): string[] {
  if (findings.length === 0) {
    return [];
  }

  const lines: string[] = [
    "<details>",
    "<summary>Compliance &amp; provenance</summary>",
    "",
    "### Compliance & audit",
  ];

  if (provenance !== undefined) {
    lines.push(
      "",
      `Model: ${formatMarkdownText(provenance.llmProvider)} / ${formatMarkdownText(provenance.llmModel)}`,
    );
  }

  for (const finding of findings) {
    lines.push("", `#### ${formatMarkdownText(finding.title)} — ${formatLocation(finding)}`, "");

    if (finding.compliance_references.length > 0) {
      lines.push(
        "📋 Potential compliance references",
        ...finding.compliance_references.map(renderReferenceLine),
      );
    }

    lines.push(`🔍 Audit Reference: ${finding.audit_reference ?? "n/a"}`);
  }

  lines.push("", "</details>");

  return lines;
}

function renderReferenceLine(
  reference: ComplianceReference,
  index: number,
  references: readonly ComplianceReference[],
): string {
  const connector = index === references.length - 1 ? "└─" : "├─";
  const label = FRAMEWORK_LABELS[reference.framework];
  const headline = `${connector} ${label}: ${formatMarkdownText(reference.identifier)} — ${formatMarkdownText(reference.description)}`;

  if (reference.applicability === "applicable_if" && reference.condition !== undefined) {
    return `${headline} (applicable if: ${formatMarkdownText(reference.condition)})`;
  }

  return headline;
}

function formatLocation(finding: Finding): string {
  const line =
    finding.line_start === finding.line_end
      ? `${finding.line_start}`
      : `${finding.line_start}-${finding.line_end}`;

  return formatMarkdownText(`${finding.file}:${line}`);
}
