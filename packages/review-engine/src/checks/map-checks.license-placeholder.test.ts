// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

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

describe("GitHub Checks descriptors - license scan placeholder (R-05)", () => {
  it.each([
    {
      verdict: "approve",
      label: "Approve",
      findingCount: 0,
      hasSignedAuditEntry: false,
      auditState: "no",
    },
    {
      verdict: "comment",
      label: "Comment",
      findingCount: 2,
      hasSignedAuditEntry: true,
      auditState: "a",
    },
    {
      verdict: "request-changes",
      label: "Request changes",
      findingCount: 5,
      hasSignedAuditEntry: true,
      auditState: "a",
    },
  ])(
    "keeps license scan neutral for verdict $verdict with $auditState signed audit entry",
    ({ verdict, label, findingCount, hasSignedAuditEntry }) => {
      // Given the review verdict is "<verdict>"
      // And the review has <finding_count> findings
      // And <audit_state> signed audit entry is available
      const input = {
        verdict: { kind: verdict, label },
        findingCount,
        hasSignedAuditEntry,
      };

      // When the Sovri check descriptors are mapped
      const descriptor = licenseDescriptor(mapChecks(input));

      // Then the "Sovri / license-scan" descriptor conclusion is "neutral"
      expect(descriptor.conclusion).toBe("neutral");

      // And its summary is "License scan available in v1.0"
      expect(descriptor.summary).toBe("License scan available in v1.0");
    },
  );

  it("does not include a SARIF reader or license scanner command in the mapper", async () => {
    // Given the review verdict is "request-changes"
    // And the review has 5 findings
    // And a signed audit entry is available
    const input = {
      verdict: { kind: "request-changes", label: "Request changes" },
      findingCount: 5,
      hasSignedAuditEntry: true,
    };

    // When the Sovri check descriptors are mapped
    licenseDescriptor(mapChecks(input));
    const source = await readChecksMapperSource();

    // Then the checks mapper performs no file I/O of its own
    expect(source).not.toContain("node:fs");

    // And no license scanner command is executed
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("execFile");
    expect(source).not.toContain("spawn");
  });
});
