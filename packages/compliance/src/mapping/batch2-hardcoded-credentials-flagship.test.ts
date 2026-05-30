// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import { type ComplianceMappingEntry, type ComplianceReferenceEntry } from "../index.js";
import { auditFlagshipCredentials } from "./required-references.js";

function readFlagship(): ComplianceMappingEntry {
  const entry = getCweMap().get("CWE-798");
  if (entry === undefined) {
    throw new TypeError("Expected CWE-798 to be mapped.");
  }
  return entry;
}

function reference(
  entry: ComplianceMappingEntry,
  framework: string,
): ComplianceReferenceEntry | undefined {
  return entry.references.find((candidate) => candidate.framework === framework);
}

describe("CWE-798 is the flagship hard-coded credentials mapping", () => {
  it("carries the flagship regulatory reference set", () => {
    const entry = readFlagship();

    expect(entry.references.length).toBeGreaterThanOrEqual(4);
    expect(reference(entry, "OWASP-TOP10-2021")).toMatchObject({
      identifier: "A07:2021",
      applicability: "informational",
    });
    expect(reference(entry, "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
    expect(reference(entry, "ISO27001-2022")).toMatchObject({
      identifier: "A.5.17",
      applicability: "informational",
    });
    expect(reference(entry, "DORA")).toMatchObject({
      identifier: "Art. 9",
      applicability: "applicable_if",
    });
    expect(reference(entry, "NIS2")?.applicability).toBe("applicable_if");
  });

  it("states the flagship GDPR and DORA conditions in the credential wording", () => {
    const entry = readFlagship();

    expect(reference(entry, "GDPR")?.condition).toBe(
      "The hardcoded credential gives access to a system processing personal data",
    );
    expect(reference(entry, "DORA")?.condition).toBe(
      "The affected system is part of the ICT infrastructure of a financial entity",
    );
  });

  it("fails the flagship audit when a CWE-798 candidate has no DORA reference", () => {
    // Given a candidate CWE-798 entry with no DORA reference
    const candidate = {
      cwe_id: "CWE-798",
      references: [
        { framework: "CWE", identifier: "CWE-798" },
        { framework: "OWASP-TOP10-2021", identifier: "A07:2021" },
        { framework: "GDPR", identifier: "Art. 32" },
        { framework: "ISO27001-2022", identifier: "A.5.17" },
        { framework: "NIS2", identifier: "Art. 21(2)(i)" },
      ],
    };

    // When the flagship credentials audit runs
    const failure = auditFlagshipCredentials(candidate);

    // Then the audit fails reporting CWE-798 and the missing DORA framework
    expect(failure).toBeDefined();
    expect(failure?.cwe_id).toBe("CWE-798");
    expect(failure?.missingFrameworks).toContain("DORA");
  });

  it("passes the flagship audit for the real CWE-798 mapping", () => {
    expect(auditFlagshipCredentials(readFlagship())).toBeUndefined();
  });

  it("rejects a flagship candidate whose DORA reference cites the wrong article", () => {
    const candidate = {
      cwe_id: "CWE-798",
      references: [
        { framework: "CWE", identifier: "CWE-798" },
        { framework: "OWASP-TOP10-2021", identifier: "A07:2021" },
        { framework: "GDPR", identifier: "Art. 32" },
        { framework: "ISO27001-2022", identifier: "A.5.17" },
        { framework: "DORA", identifier: "Art. 5" },
        { framework: "NIS2", identifier: "Art. 21(2)(i)" },
      ],
    };

    const failure = auditFlagshipCredentials(candidate);

    expect(failure?.cwe_id).toBe("CWE-798");
    expect(failure?.missingFrameworks).toContain("DORA");
  });

  it("cites official HTTPS hosts on every flagship reference", () => {
    const entry = readFlagship();

    for (const candidate of entry.references) {
      expect(new URL(candidate.source_url).protocol).toBe("https:");
    }
    expect(new URL(reference(entry, "OWASP-TOP10-2021")?.source_url ?? "").host).toBe("owasp.org");
    expect(new URL(reference(entry, "ISO27001-2022")?.source_url ?? "").host).toBe("www.iso.org");
    for (const framework of ["GDPR", "DORA", "NIS2"]) {
      expect(new URL(reference(entry, framework)?.source_url ?? "").host).toBe("eur-lex.europa.eu");
    }
  });
});
