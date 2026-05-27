// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { ComplianceMappingEntrySchema, type ComplianceMappingEntry } from "../index.js";

function buildCwe120EntryWithoutIsoReference(): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-120",
    title: "Buffer Copy without Checking Size of Input ('Classic Buffer Overflow')",
    mitre_url: "https://cwe.mitre.org/data/definitions/120.html",
    impacts: ["Memory corruption", "Availability loss"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-120",
        description: "Buffer Copy without Checking Size of Input ('Classic Buffer Overflow')",
        source_url: "https://cwe.mitre.org/data/definitions/120.html",
        applicability: "informational",
      },
      {
        framework: "GDPR",
        identifier: "Art. 32",
        description:
          "Security of processing for classic buffer overflow exposure when personal data processing is affected.",
        source_url:
          "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679#d1e3316-1-1",
        applicability: "applicable_if",
        condition: "The affected system processes personal data as defined by GDPR Art. 4",
      },
    ],
  };
}

function buildCwe862EntryWithoutDoraReference(): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-862",
    title: "Missing Authorization",
    mitre_url: "https://cwe.mitre.org/data/definitions/862.html",
    impacts: ["Unauthorized access", "Privilege abuse"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-862",
        description: "Missing Authorization",
        source_url: "https://cwe.mitre.org/data/definitions/862.html",
        applicability: "informational",
      },
      {
        framework: "GDPR",
        identifier: "Art. 32",
        description:
          "Security of processing for missing authorization when personal data access is affected.",
        source_url:
          "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679#d1e3316-1-1",
        applicability: "applicable_if",
        condition: "The affected system processes personal data as defined by GDPR Art. 4",
      },
      {
        framework: "NIS2",
        identifier: "Art. 21(2)(i)",
        description:
          "Access control policies and asset management for essential or important entities.",
        source_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022L2555",
        applicability: "applicable_if",
        condition: "The entity is an essential or important entity subject to NIS2",
      },
    ],
  };
}

function buildCwe89EntryWithMismatchedMitreUrl(): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-89",
    title: "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
    mitre_url: "https://cwe.mitre.org/data/definitions/79.html",
    impacts: ["Data breach", "Unauthorized data modification"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-89",
        description:
          "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
        source_url: "https://cwe.mitre.org/data/definitions/89.html",
        applicability: "informational",
      },
      {
        framework: "GDPR",
        identifier: "Art. 32",
        description:
          "Security of processing for SQL injection exposure when personal data storage is affected.",
        source_url:
          "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679#d1e3316-1-1",
        applicability: "applicable_if",
        condition: "The affected system processes personal data as defined by GDPR Art. 4",
      },
    ],
  };
}

function buildZeroPaddedCwe89Entry(): ComplianceMappingEntry {
  return {
    ...buildCwe89EntryWithMismatchedMitreUrl(),
    cwe_id: "CWE-089",
    mitre_url: "https://cwe.mitre.org/data/definitions/089.html",
  };
}

function buildCwe89EntryWithGdprSourceUrl(sourceUrl: string): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-89",
    title: "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
    mitre_url: "https://cwe.mitre.org/data/definitions/89.html",
    impacts: ["Data breach", "Unauthorized data modification"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-89",
        description:
          "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
        source_url: "https://cwe.mitre.org/data/definitions/89.html",
        applicability: "informational",
      },
      {
        framework: "GDPR",
        identifier: "Art. 32",
        description:
          "Security of processing for SQL injection exposure when personal data storage is affected.",
        source_url: sourceUrl,
        applicability: "applicable_if",
        condition: "The affected system processes personal data as defined by GDPR Art. 4",
      },
    ],
  };
}

function buildCwe89EntryWithNonOfficialGdprSourceUrl(): ComplianceMappingEntry {
  return buildCwe89EntryWithGdprSourceUrl("https://example.com/gdpr-art-32");
}

function buildCwe89EntryWithNonHttpsGdprSourceUrl(): ComplianceMappingEntry {
  return buildCwe89EntryWithGdprSourceUrl(
    "http://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679",
  );
}

function buildCwe79EntryWithoutGdprReference(): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-79",
    title: "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')",
    mitre_url: "https://cwe.mitre.org/data/definitions/79.html",
    impacts: ["Session compromise", "Unauthorized script execution"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-79",
        description:
          "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')",
        source_url: "https://cwe.mitre.org/data/definitions/79.html",
        applicability: "informational",
      },
    ],
  };
}

function buildZeroPaddedCwe89EntryWithoutGdprReference(): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-089",
    title: "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
    mitre_url: "https://cwe.mitre.org/data/definitions/89.html",
    impacts: ["Data breach", "Unauthorized data modification"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-89",
        description:
          "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
        source_url: "https://cwe.mitre.org/data/definitions/89.html",
        applicability: "informational",
      },
    ],
  };
}

describe("Compliance mapping data audits", () => {
  it("rejects CWE-120 when the ISO 27001 A.8.28 reference is missing", () => {
    // Given a candidate batch 1 map contains "CWE-120"
    const candidateBatchOneMap = new Map<string, ComplianceMappingEntry>([
      ["CWE-120", buildCwe120EntryWithoutIsoReference()],
    ]);

    // And the "CWE-120" entry has no ISO27001-2022 reference
    const candidateEntry = candidateBatchOneMap.get("CWE-120");
    if (candidateEntry === undefined) {
      throw new TypeError("Expected candidate batch 1 map to contain CWE-120.");
    }

    // When the buffer overflow ISO audit runs
    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    // Then the audit fails
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the buffer overflow ISO audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    // And the failure reports "CWE-120"
    expect(failureText).toContain("CWE-120");

    // And the failure reports missing identifier "A.8.28"
    expect(failureText).toContain("A.8.28");
  });

  it("rejects a critical ICT CWE when the DORA reference is missing", () => {
    // Given a candidate batch 1 map contains "CWE-862"
    const candidateBatchOneMap = new Map<string, ComplianceMappingEntry>([
      ["CWE-862", buildCwe862EntryWithoutDoraReference()],
    ]);

    // And the "CWE-862" entry has no DORA reference
    const candidateEntry = candidateBatchOneMap.get("CWE-862");
    if (candidateEntry === undefined) {
      throw new TypeError("Expected candidate batch 1 map to contain CWE-862.");
    }

    // When the critical ICT regulatory audit runs
    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    // Then the audit fails
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the critical ICT regulatory audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    // And the failure reports "CWE-862"
    expect(failureText).toContain("CWE-862");

    // And the failure reports missing framework "DORA"
    expect(failureText).toContain("DORA");
  });

  it("rejects a CWE mapping entry whose MITRE URL identifier does not match", () => {
    // Given a candidate mapping entry has cwe_id "CWE-89"
    const candidateEntry = buildCwe89EntryWithMismatchedMitreUrl();

    // And mitre_url is "https://cwe.mitre.org/data/definitions/79.html"

    // When the batch 1 data audit checks canonical MITRE URLs
    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    // Then the audit fails
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the canonical MITRE URL audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    // And the failure reports "CWE-89"
    expect(failureText).toContain("CWE-89");
  });

  it("normalizes zero-padded CWE identifiers before auditing MITRE URLs", () => {
    const candidateEntry = buildZeroPaddedCwe89Entry();

    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the canonical MITRE URL audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    expect(failureText).toContain("CWE-089");
    expect(failureText).toContain("https://cwe.mitre.org/data/definitions/89.html");
  });

  it("rejects a compliance reference whose source URL host is not official", () => {
    // Given a candidate reference has framework "GDPR"
    const candidateEntry = buildCwe89EntryWithNonOfficialGdprSourceUrl();

    // And source_url is "https://example.com/gdpr-art-32"

    // When the batch 1 source URL audit runs
    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    // Then the audit fails
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the source URL host audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    // And the failure reports framework "GDPR"
    expect(failureText).toContain("GDPR");

    // And the failure reports source_url "https://example.com/gdpr-art-32"
    expect(failureText).toContain("https://example.com/gdpr-art-32");
  });

  it("rejects a compliance reference whose source URL does not use HTTPS", () => {
    const candidateEntry = buildCwe89EntryWithNonHttpsGdprSourceUrl();

    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the HTTPS source URL audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    expect(failureText).toContain("HTTPS");
    expect(failureText).toContain(
      "http://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679",
    );
  });

  it("rejects a web vulnerability CWE when the GDPR Art. 32 reference is missing", () => {
    // Given a candidate batch 1 map contains "CWE-79"
    const candidateBatchOneMap = new Map<string, ComplianceMappingEntry>([
      ["CWE-79", buildCwe79EntryWithoutGdprReference()],
    ]);

    // And the "CWE-79" entry has no GDPR reference
    const candidateEntry = candidateBatchOneMap.get("CWE-79");
    if (candidateEntry === undefined) {
      throw new TypeError("Expected candidate batch 1 map to contain CWE-79.");
    }

    // When the web vulnerability GDPR audit runs
    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    // Then the audit fails
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the web vulnerability GDPR audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    // And the failure reports "CWE-79"
    expect(failureText).toContain("CWE-79");

    // And the failure reports missing framework "GDPR"
    expect(failureText).toContain("GDPR");
  });

  it("normalizes zero-padded web vulnerability CWE identifiers before auditing GDPR references", () => {
    const candidateEntry = buildZeroPaddedCwe89EntryWithoutGdprReference();

    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the web vulnerability GDPR audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    expect(failureText).toContain("CWE-089");
    expect(failureText).toContain("GDPR");
  });
});
