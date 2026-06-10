// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { v4 as uuidv4 } from "uuid";

import { z, type Category, type Finding, type Severity } from "@sovri/core";

import { generateAuditReference } from "../audit-ref.js";
import { parseSarifReport, type SarifResult } from "./reader.js";

// Probe for a primary physical location without committing to the full SARIF
// location shape (R-05 resolves the uri itself). A result that cannot anchor a
// file/line is off-spec for a Finding and is dropped with a counted reason.
const LocationProbeSchema = z.looseObject({
  locations: z.array(z.looseObject({ physicalLocation: z.looseObject({}).optional() })).optional(),
});

// Per-report ingestion outcome: the results that survived per-result validation
// and a summary counting what was seen, mapped, and skipped (by reason). One
// off-spec result is dropped with a counted reason; it never discards siblings.

export type IngestionSummary = {
  readonly seen: number;
  readonly mapped: number;
  readonly skipped: number;
  readonly skippedReasons: Readonly<Record<string, number>>;
};

export type ReportIngestion = {
  readonly results: readonly SarifResult[];
  readonly summary: IngestionSummary;
};

/**
 * Ingest one untrusted SARIF report string: parse it (a whole-report failure
 * throws {@link SarifParseError}), then walk each result, dropping an off-spec
 * one with a counted reason while its siblings still ingest. Returns the
 * surviving results and an ingestion summary.
 */
export function ingestReport(raw: string): ReportIngestion {
  const log = parseSarifReport(raw);
  const seenResults = log.runs.flatMap((run) => run.results ?? []);

  const surviving: SarifResult[] = [];
  const skippedReasons: Record<string, number> = {};
  for (const result of seenResults) {
    const reason = resultSkipReason(result);
    if (reason !== null) {
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
      continue;
    }
    surviving.push(result);
  }

  return {
    results: surviving,
    summary: {
      seen: seenResults.length,
      mapped: surviving.length,
      skipped: seenResults.length - surviving.length,
      skippedReasons,
    },
  };
}

// R-03 owns one skip reason: a result that cannot anchor a file/line. Later
// rules add their own reasons (uri escapes, non-failing kind, suppressed).
function resultSkipReason(result: SarifResult): string | null {
  return hasPhysicalLocation(result) ? null : "no-physical-location";
}

function hasPhysicalLocation(result: SarifResult): boolean {
  const probe = LocationProbeSchema.safeParse(result);
  if (!probe.success) {
    return false;
  }
  return probe.data.locations?.[0]?.physicalLocation !== undefined;
}

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 2000;
const RECOMMENDATION_MAX_LENGTH = 1000;
const SARIF_CATEGORY: Category = "security";
const SARIF_CONFIDENCE = 0.9;

// SARIF `level` to Finding severity. R-06 refines the full precedence chain
// (kind, rule configuration, default); R-04 uses the direct level mapping.
const SARIF_LEVEL_TO_SEVERITY: Readonly<Record<string, Severity>> = {
  error: "major",
  warning: "minor",
  note: "info",
  none: "nitpick",
};

const ResultViewSchema = z.looseObject({
  ruleId: z.string().optional(),
  level: z.string().optional(),
  message: z
    .looseObject({
      text: z.string().optional(),
      id: z.string().optional(),
      arguments: z.array(z.string()).optional(),
    })
    .optional(),
  locations: z
    .array(
      z.looseObject({
        physicalLocation: z
          .looseObject({
            artifactLocation: z.looseObject({ uri: z.string().optional() }).optional(),
            region: z
              .looseObject({
                startLine: z.number().int().positive().optional(),
                endLine: z.number().int().positive().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const RuleViewSchema = z.looseObject({
  id: z.string().optional(),
  shortDescription: z.looseObject({ text: z.string().optional() }).optional(),
  help: z.looseObject({ text: z.string().optional() }).optional(),
  messageStrings: z.record(z.string(), z.looseObject({ text: z.string().optional() })).optional(),
});

type ResultView = z.infer<typeof ResultViewSchema>;
type RuleView = z.infer<typeof RuleViewSchema>;

/**
 * Map one mappable SARIF result (with its resolved rule, when available) to a
 * core Finding with `source: "sarif"`. Over-long text is truncated to the
 * schema caps before construction, never a reason to drop the result.
 */
export function mapSarifResult(result: SarifResult, rule?: Record<string, unknown>): Finding {
  const view = parseView(ResultViewSchema, result);
  const ruleView = parseView(RuleViewSchema, rule ?? {});
  const location = resolveLocation(view);

  return {
    id: uuidv4(),
    audit_reference: generateAuditReference(SARIF_CATEGORY),
    severity: resolveSeverity(view),
    category: SARIF_CATEGORY,
    file: location.file,
    line_start: location.lineStart,
    line_end: location.lineEnd,
    title: truncate(resolveTitle(view, ruleView), TITLE_MAX_LENGTH),
    body: truncate(resolveMessage(view, ruleView), BODY_MAX_LENGTH),
    recommendation: truncate(resolveRecommendation(ruleView), RECOMMENDATION_MAX_LENGTH),
    source: "sarif",
    confidence: SARIF_CONFIDENCE,
    compliance_references: [],
  };
}

function parseView<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : schema.parse({});
}

function resolveLocation(view: ResultView): {
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
} {
  const physical = view.locations?.[0]?.physicalLocation;
  const file = physical?.artifactLocation?.uri ?? "unknown";
  const lineStart = physical?.region?.startLine ?? 1;
  const lineEnd = physical?.region?.endLine ?? lineStart;
  return { file, lineStart, lineEnd };
}

function resolveSeverity(view: ResultView): Severity {
  const level = view.level;
  return (level !== undefined && SARIF_LEVEL_TO_SEVERITY[level]) || "minor";
}

function resolveTitle(view: ResultView, rule: RuleView): string {
  return rule.shortDescription?.text ?? view.ruleId ?? "SARIF finding";
}

function resolveMessage(view: ResultView, rule: RuleView): string {
  const direct = view.message?.text;
  if (direct !== undefined && direct.length > 0) {
    return direct;
  }

  const messageId = view.message?.id;
  const template = messageId === undefined ? undefined : rule.messageStrings?.[messageId]?.text;
  if (template !== undefined) {
    return substituteArguments(template, view.message?.arguments ?? []);
  }

  return `SARIF result reported by rule ${view.ruleId ?? "unknown"}.`;
}

function substituteArguments(template: string, args: readonly string[]): string {
  return template.replace(/\{(\d+)\}/gu, (match, index: string) => args[Number(index)] ?? match);
}

function resolveRecommendation(rule: RuleView): string {
  return (
    rule.help?.text ??
    "Review the issue reported by the scanner and apply the recommended remediation."
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
