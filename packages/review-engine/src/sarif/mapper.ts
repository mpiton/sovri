// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

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
