// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ComplianceMappingEntrySchema, type ComplianceMappingEntry } from "./schema.js";
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
] satisfies readonly unknown[];
const cweMap = buildCweMap(mappingEntries);

function buildCweMap(entries: readonly unknown[]): ReadonlyMap<string, ComplianceMappingEntry> {
  const parsedEntries = entries.map((entry) =>
    freezeMappingEntry(ComplianceMappingEntrySchema.parse(entry)),
  );

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
