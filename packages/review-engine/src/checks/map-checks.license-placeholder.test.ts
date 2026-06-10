// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// The license-scan row doubles as the scanner-ingestion row (MAT-6): neutral
// placeholder until a SARIF report is ingested for the review, then success.
// Replaces the earlier placeholder test that asserted the SARIF reader was absent.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { mapChecks, type CheckRunDescriptor } from "./index.js";

function licenseDescriptor(descriptors: readonly CheckRunDescriptor[]): CheckRunDescriptor {
  const descriptor = descriptors.find((candidate) => candidate.name === "Sovri / license-scan");
  if (descriptor === undefined) {
    throw new Error("Sovri / license-scan descriptor not found");
  }

  return descriptor;
}

async function readChecksMapperSource(): Promise<string> {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readFile(join(directory, "index.ts"), "utf8");
}

describe("GitHub Checks descriptors - scanner (license-scan) row", () => {
  it.each([
    { verdict: "approve", label: "Approve", findingCount: 0, hasSignedAuditEntry: false },
    { verdict: "comment", label: "Comment", findingCount: 2, hasSignedAuditEntry: true },
    {
      verdict: "request-changes",
      label: "Request changes",
      findingCount: 5,
      hasSignedAuditEntry: true,
    },
  ])(
    "keeps the row neutral when no SARIF report was ingested ($verdict)",
    ({ verdict, label, findingCount, hasSignedAuditEntry }) => {
      // Given a review with no SARIF report ingested (sarifIngested omitted -> default false)
      const input = { verdict: { kind: verdict, label }, findingCount, hasSignedAuditEntry };

      // When the Sovri check descriptors are mapped
      const descriptor = licenseDescriptor(mapChecks(input));

      // Then the "Sovri / license-scan" descriptor stays the neutral v1.0 placeholder
      expect(descriptor.conclusion).toBe("neutral");
      expect(descriptor.summary).toBe("License scan available in v1.0");
    },
  );

  it("flips the row to success once a SARIF report is ingested", () => {
    // Given a review for which at least one SARIF report was ingested
    const input = {
      verdict: { kind: "comment", label: "Comment" },
      findingCount: 3,
      hasSignedAuditEntry: false,
      sarifIngested: true,
    };

    // When the Sovri check descriptors are mapped
    const descriptor = licenseDescriptor(mapChecks(input));

    // Then the "Sovri / license-scan" row reports the ingested scan
    expect(descriptor.conclusion).toBe("success");
    expect(descriptor.title).toBe("Sovri SARIF scan ingested");
  });

  it("keeps the checks mapper free of file or process I/O", async () => {
    // The mapper turns a Review into descriptors with no side effects: ingestion
    // happens upstream in the orchestrator, never in this pure mapping layer.
    const source = await readChecksMapperSource();

    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("execFile");
    expect(source).not.toContain("spawn");
  });
});
