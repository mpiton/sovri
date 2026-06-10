// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z, type Finding } from "@sovri/core";

import { capFindings, checkReportBounds } from "./caps.js";
import { extractCwe } from "./cwe.js";
import { resolveSarifFile } from "./location.js";
import { mapSarifResult, resultKindReason, resultSuppressionReason } from "./mapper.js";
import { parseSarifReport, SarifParseError, type SarifResult } from "./reader.js";

// The single composition between the SARIF primitives and the review pipeline:
// one untrusted report string in, capped core Findings out. Drops (kind,
// suppression, file-escape, off-spec location) are counted per reason so a
// caller can log what a scanner report contributed without surfacing anything
// the pull request never touched. A whole-report failure (invalid JSON / wrong
// version / breached bounds) throws SarifParseError so the caller skips that
// report and still runs the LLM review.

export interface SarifIngestionSummary {
  readonly seen: number;
  readonly mapped: number;
  readonly skipped: number;
  readonly skippedReasons: Readonly<Record<string, number>>;
  readonly cappedDropped: number;
}

export interface SarifFindingsResult {
  readonly findings: readonly Finding[];
  readonly summary: SarifIngestionSummary;
}

const RunRulesSchema = z.looseObject({
  tool: z
    .looseObject({
      driver: z
        .looseObject({ rules: z.array(z.looseObject({ id: z.string().optional() })).optional() })
        .optional(),
    })
    .optional(),
});

const RuleRefSchema = z.looseObject({
  ruleId: z.string().optional(),
  ruleIndex: z.number().int().nonnegative().optional(),
  rule: z.looseObject({ index: z.number().int().nonnegative().optional() }).optional(),
});

export function collectSarifFindings(raw: string): SarifFindingsResult {
  const bounds = checkReportBounds(raw);
  if (bounds !== null) {
    throw new SarifParseError(`SARIF report exceeds bounds: ${bounds.reason}`, { cause: bounds });
  }

  const log = parseSarifReport(raw);

  let seen = 0;
  const mapped: Finding[] = [];
  const skippedReasons: Record<string, number> = {};
  for (const run of log.runs) {
    const rules = rulesOf(run);
    for (const result of run.results ?? []) {
      seen += 1;
      const outcome = mapResult(result, run, rules);
      if ("dropped" in outcome) {
        skippedReasons[outcome.dropped] = (skippedReasons[outcome.dropped] ?? 0) + 1;
        continue;
      }
      mapped.push(outcome.finding);
    }
  }

  const capped = capFindings(mapped);
  return {
    findings: capped.kept,
    summary: {
      seen,
      mapped: mapped.length,
      skipped: seen - mapped.length,
      skippedReasons,
      cappedDropped: capped.dropped,
    },
  };
}

type MappedResult = { readonly finding: Finding } | { readonly dropped: string };

function mapResult(
  result: SarifResult,
  run: Record<string, unknown>,
  rules: readonly Record<string, unknown>[],
): MappedResult {
  const kindReason = resultKindReason(result);
  if (kindReason !== null) {
    return { dropped: kindReason };
  }

  const suppressionReason = resultSuppressionReason(result);
  if (suppressionReason !== null) {
    return { dropped: suppressionReason };
  }

  const fileResolution = resolveSarifFile(result, run);
  if ("dropped" in fileResolution) {
    return { dropped: fileResolution.dropped };
  }

  const rule = resolveRule(result, rules);
  const base = mapSarifResult(result, rule);
  const cwe = extractCwe(result, rule, run);

  return {
    finding: {
      ...base,
      file: fileResolution.file,
      ...(cwe === undefined ? {} : { cwe }),
    },
  };
}

function rulesOf(run: Record<string, unknown>): readonly Record<string, unknown>[] {
  const parsed = RunRulesSchema.safeParse(run);
  return parsed.success ? (parsed.data.tool?.driver?.rules ?? []) : [];
}

function resolveRule(
  result: SarifResult,
  rules: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const ref = RuleRefSchema.safeParse(result);
  if (!ref.success) {
    return undefined;
  }

  const index = ref.data.ruleIndex ?? ref.data.rule?.index;
  if (index !== undefined) {
    return rules[index];
  }

  const ruleId = ref.data.ruleId;
  if (ruleId === undefined) {
    return undefined;
  }

  return rules.find((rule) => Reflect.get(rule, "id") === ruleId);
}
