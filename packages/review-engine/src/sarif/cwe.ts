// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

import type { SarifResult } from "./reader.js";

// Extract a single canonical CWE id (`CWE-<n>`, no leading zeros) from the real
// per-tool shapes: Semgrep `rule.properties.cwe`, CodeQL `rule.properties.tags`
// (`external/cwe/cwe-0NN`), and `taxa` / `rule.relationships` resolved against
// `run.taxonomies` where the component name is "CWE". CWE is optional. When a
// result yields several distinct ids, the first in document order wins.

/**
 * Extract the canonical CWE id for a SARIF result, or `undefined` when none is
 * present. Sources are consulted in document order: `rule.properties.cwe`, then
 * `rule.properties.tags`, then taxonomy references (`result.taxa` and
 * `rule.relationships`) against `run.taxonomies`.
 */
// Anchored on the literal `cwe` token, an optional separator, optional leading
// zeros, then the digits. Single capture group, no alternation or nested
// quantifier, so evaluation is linear with no catastrophic backtracking.
const CwePattern = /cwe[-_]?0*(\d+)/iu;

const RuleCweViewSchema = z.looseObject({
  properties: z
    .looseObject({
      cwe: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  relationships: z
    .array(
      z.looseObject({
        target: z
          .looseObject({
            index: z.number().int().nonnegative().optional(),
            toolComponent: z
              .looseObject({ index: z.number().int().nonnegative().optional() })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const ResultCweViewSchema = z.looseObject({
  taxa: z
    .array(
      z.looseObject({
        toolComponentIndex: z.number().int().nonnegative().optional(),
        index: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
});

const RunTaxonomiesViewSchema = z.looseObject({
  taxonomies: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        taxa: z.array(z.looseObject({ id: z.string().optional() })).optional(),
      }),
    )
    .optional(),
});

type TaxonomyRef = {
  readonly componentIndex?: number | undefined;
  readonly taxonIndex?: number | undefined;
};

type TaxonomyList = z.infer<typeof RunTaxonomiesViewSchema>["taxonomies"];

export function extractCwe(
  result: SarifResult,
  rule?: Record<string, unknown>,
  run?: Record<string, unknown>,
): string | undefined {
  const ruleView = RuleCweViewSchema.safeParse(rule ?? {});
  const ruleData = ruleView.success ? ruleView.data : undefined;

  const fromProperties =
    firstCanonicalCwe(ruleData?.properties?.cwe) ?? firstCanonicalCwe(ruleData?.properties?.tags);
  if (fromProperties !== undefined) {
    return fromProperties;
  }

  const resultView = ResultCweViewSchema.safeParse(result);
  const runView = RunTaxonomiesViewSchema.safeParse(run ?? {});
  const taxonomies = runView.success ? runView.data.taxonomies : undefined;

  const refs: TaxonomyRef[] = [
    ...(resultView.success ? (resultView.data.taxa ?? []) : []).map((taxon) => ({
      componentIndex: taxon.toolComponentIndex,
      taxonIndex: taxon.index,
    })),
    ...(ruleData?.relationships ?? []).map((relationship) => ({
      componentIndex: relationship.target?.toolComponent?.index,
      taxonIndex: relationship.target?.index,
    })),
  ];

  return cweFromTaxonomyRefs(refs, taxonomies);
}

function canonicalizeCwe(token: string): string | undefined {
  const match = CwePattern.exec(token);
  const digits = match?.[1];
  return digits === undefined ? undefined : `CWE-${Number(digits)}`;
}

function firstCanonicalCwe(values: readonly string[] | undefined): string | undefined {
  for (const value of values ?? []) {
    const canonical = canonicalizeCwe(value);
    if (canonical !== undefined) {
      return canonical;
    }
  }
  return undefined;
}

function cweFromTaxonomyRefs(
  refs: readonly TaxonomyRef[],
  taxonomies: TaxonomyList,
): string | undefined {
  for (const { componentIndex, taxonIndex } of refs) {
    if (componentIndex === undefined || taxonIndex === undefined) {
      continue;
    }
    const taxonomy = taxonomies?.[componentIndex];
    if (taxonomy?.name !== "CWE") {
      continue;
    }
    const id = taxonomy.taxa?.[taxonIndex]?.id;
    const canonical = id === undefined ? undefined : canonicalizeCwe(`CWE-${id}`);
    if (canonical !== undefined) {
      return canonical;
    }
  }
  return undefined;
}
