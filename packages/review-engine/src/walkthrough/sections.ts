// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { computeSeverityRank, type Finding, type Severity } from "@sovri/core";

import { formatTableCell } from "./markdown.js";
import { formatTable } from "./table.js";

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings.toSorted(compareFindings);
}

export function renderFindings(findings: readonly Finding[]): string[] {
  if (findings.length === 0) {
    return ["No findings."];
  }

  const sections: string[] = [];

  for (const group of groupBySeverity(findings)) {
    if (sections.length > 0) {
      sections.push("");
    }

    sections.push(
      `#### ${formatSeverity(group.severity)}`,
      "",
      ...formatFindingsTable(group.findings),
    );
  }

  return sections;
}

export function renderFiles(findings: readonly Finding[]): string[] {
  if (findings.length === 0) {
    return ["No changed files with findings."];
  }

  const sections: string[] = [];

  for (const group of groupByFile(findings)) {
    if (sections.length > 0) {
      sections.push("");
    }

    const countText =
      group.findings.length === 1 ? "1 finding" : `${group.findings.length} findings`;
    sections.push(`#### ${formatTableCell(group.file)}`, "", countText, "");
    sections.push(
      ...group.findings.map(
        (finding) => `- ${formatLocation(finding)} ${formatCell(finding.title)}`,
      ),
    );
  }

  return sections;
}

function formatFindingsTable(findings: readonly Finding[]): string[] {
  return formatTable(
    ["Severity", "Location", "Title", "Details"],
    findings.map((finding) => [
      formatSeverity(finding.severity),
      formatLocation(finding),
      formatCell(finding.title),
      formatCell(finding.body),
    ]),
  );
}

type SeverityGroup = {
  readonly severity: Severity;
  readonly findings: readonly Finding[];
};

function groupBySeverity(findings: readonly Finding[]): SeverityGroup[] {
  const groups = new Map<Severity, Finding[]>();

  for (const finding of findings) {
    const group = groups.get(finding.severity) ?? [];
    group.push(finding);
    groups.set(finding.severity, group);
  }

  return [...groups.entries()].map(([severity, groupFindings]) => ({
    severity,
    findings: groupFindings,
  }));
}

type FileGroup = {
  readonly file: string;
  readonly findings: readonly Finding[];
};

function groupByFile(findings: readonly Finding[]): FileGroup[] {
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const group = groups.get(finding.file) ?? [];
    group.push(finding);
    groups.set(finding.file, group);
  }

  return [...groups.entries()]
    .toSorted(([leftFile], [rightFile]) => compareCodePoints(leftFile, rightFile))
    .map(([file, groupFindings]) => ({
      file,
      findings: groupFindings.toSorted(compareFindingsWithinFile),
    }));
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    computeSeverityRank(right.severity) - computeSeverityRank(left.severity) ||
    compareFindingsWithinFile(left, right)
  );
}

function compareFindingsWithinFile(left: Finding, right: Finding): number {
  return (
    compareCodePoints(left.file, right.file) ||
    left.line_start - right.line_start ||
    left.line_end - right.line_end ||
    compareCodePoints(left.title, right.title) ||
    compareCodePoints(left.body, right.body) ||
    compareCodePoints(left.id, right.id)
  );
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function formatSeverity(severity: Severity): string {
  return `${severity[0]?.toUpperCase() ?? ""}${severity.slice(1)}`;
}

function formatLocation(finding: Finding): string {
  const line =
    finding.line_start === finding.line_end
      ? `${finding.line_start}`
      : `${finding.line_start}-${finding.line_end}`;

  return formatTableCell(`${finding.file}:${line}`);
}

function formatCell(value: string): string {
  return formatTableCell(value);
}
