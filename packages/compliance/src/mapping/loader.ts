// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ComplianceMappingEntrySchema, type ComplianceMappingEntry } from "./schema.js";
import { auditFlagshipCredentials } from "./required-references.js";
import cwe22Entry from "./data/CWE-22.json" with { type: "json" };
import cwe78Entry from "./data/CWE-78.json" with { type: "json" };
import cwe79Entry from "./data/CWE-79.json" with { type: "json" };
import cwe89Entry from "./data/CWE-89.json" with { type: "json" };
import cwe94Entry from "./data/CWE-94.json" with { type: "json" };
import cwe120Entry from "./data/CWE-120.json" with { type: "json" };
import cwe125Entry from "./data/CWE-125.json" with { type: "json" };
import cwe352Entry from "./data/CWE-352.json" with { type: "json" };
import cwe416Entry from "./data/CWE-416.json" with { type: "json" };
import cwe434Entry from "./data/CWE-434.json" with { type: "json" };
import cwe476Entry from "./data/CWE-476.json" with { type: "json" };
import cwe787Entry from "./data/CWE-787.json" with { type: "json" };
import cwe798Entry from "./data/CWE-798.json" with { type: "json" };
import cwe862Entry from "./data/CWE-862.json" with { type: "json" };
import cwe20Entry from "./data/CWE-20.json" with { type: "json" };
import cwe77Entry from "./data/CWE-77.json" with { type: "json" };
import cwe121Entry from "./data/CWE-121.json" with { type: "json" };
import cwe122Entry from "./data/CWE-122.json" with { type: "json" };
import cwe200Entry from "./data/CWE-200.json" with { type: "json" };
import cwe284Entry from "./data/CWE-284.json" with { type: "json" };
import cwe306Entry from "./data/CWE-306.json" with { type: "json" };
import cwe502Entry from "./data/CWE-502.json" with { type: "json" };
import cwe639Entry from "./data/CWE-639.json" with { type: "json" };
import cwe770Entry from "./data/CWE-770.json" with { type: "json" };
import cwe863Entry from "./data/CWE-863.json" with { type: "json" };
import cwe918Entry from "./data/CWE-918.json" with { type: "json" };

const mappingEntries = [
  cwe22Entry,
  cwe78Entry,
  cwe79Entry,
  cwe89Entry,
  cwe94Entry,
  cwe120Entry,
  cwe125Entry,
  cwe352Entry,
  cwe416Entry,
  cwe434Entry,
  cwe476Entry,
  cwe787Entry,
  cwe798Entry,
  cwe862Entry,
  cwe20Entry,
  cwe77Entry,
  cwe121Entry,
  cwe122Entry,
  cwe200Entry,
  cwe284Entry,
  cwe306Entry,
  cwe502Entry,
  cwe639Entry,
  cwe770Entry,
  cwe863Entry,
  cwe918Entry,
] satisfies readonly unknown[];
const cweMap = buildCweMap(mappingEntries);

function buildCweMap(entries: readonly unknown[]): ReadonlyMap<string, ComplianceMappingEntry> {
  const parsedEntries = entries.map((entry) =>
    freezeMappingEntry(ComplianceMappingEntrySchema.parse(entry)),
  );

  for (const entry of parsedEntries) {
    const flagshipFailure = auditFlagshipCredentials(entry);
    if (flagshipFailure !== undefined) {
      throw new Error(
        `${flagshipFailure.cwe_id} flagship mapping is missing required frameworks: ${flagshipFailure.missingFrameworks.join(", ")}`,
      );
    }
  }

  return new Map(parsedEntries.map((entry) => [entry.cwe_id, entry]));
}

function freezeMappingEntry(entry: ComplianceMappingEntry): ComplianceMappingEntry {
  for (const reference of entry.references) {
    Object.freeze(reference);
  }
  Object.freeze(entry.impacts);
  Object.freeze(entry.references);
  Object.freeze(entry);

  return entry;
}

export function getCweMap(): ReadonlyMap<string, ComplianceMappingEntry> {
  return new Map(cweMap);
}
