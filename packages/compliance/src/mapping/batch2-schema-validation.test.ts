// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import { ComplianceMappingEntrySchema } from "../index.js";

const batchTwoCweIds = [
  "CWE-20",
  "CWE-77",
  "CWE-121",
  "CWE-122",
  "CWE-200",
  "CWE-284",
  "CWE-306",
  "CWE-502",
  "CWE-639",
  "CWE-770",
  "CWE-798",
  "CWE-863",
  "CWE-918",
];

describe("Batch 2 CWE mapping files are schema valid", () => {
  it.each(batchTwoCweIds)("exposes %s as a schema-valid entry in getCweMap", (cweId) => {
    // Given the batch 2 data file for <cwe_id>
    const entry = getCweMap().get(cweId);

    // When it is parsed with ComplianceMappingEntrySchema
    const result = ComplianceMappingEntrySchema.safeParse(entry);

    // Then parsing succeeds and the parsed entry cwe_id matches
    expect(result.success).toBe(true);
    expect(entry?.cwe_id).toBe(cweId);
  });

  it("rejects schema-invalid batch 2 mapping data before it reaches the map", () => {
    // Given a candidate batch 2 entry for CWE-502 whose mitre_url is not canonical
    const candidate = {
      cwe_id: "CWE-502",
      title: "Deserialization of Untrusted Data",
      mitre_url: "https://example.com/502",
      impacts: ["Remote code execution"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-502",
          description: "Deserialization of Untrusted Data",
          source_url: "https://cwe.mitre.org/data/definitions/502.html",
          applicability: "informational",
        },
      ],
    };

    // When it is parsed with ComplianceMappingEntrySchema
    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    // Then parsing fails and the failure reports path "mitre_url"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected schema-invalid mapping data to be rejected.");
    }
    const paths = result.error.issues.flatMap((issue) => issue.path);
    expect(paths).toContain("mitre_url");
  });

  it("carries the canonical MITRE URL on an official HTTPS host for CWE-918", () => {
    // Given the batch 2 mapping entry for CWE-918 is read from getCweMap
    const entry = getCweMap().get("CWE-918");
    if (entry === undefined) {
      throw new TypeError("Expected CWE-918 to be mapped.");
    }

    // When its mitre_url is inspected
    const url = new URL(entry.mitre_url);

    // Then it is the canonical URL on the official cwe.mitre.org HTTPS host
    expect(entry.mitre_url).toBe("https://cwe.mitre.org/data/definitions/918.html");
    expect(url.host).toBe("cwe.mitre.org");
    expect(url.protocol).toBe("https:");
  });
});
