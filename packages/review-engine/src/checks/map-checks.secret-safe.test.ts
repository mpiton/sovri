// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { mapChecks } from "./index.js";

const SensitiveValues = [
  ["ghp", "_", "0123456789abcdef0123456789abcdef0123"].join(""),
  ["sk", "-", "llm-provider-test-key", "-", "0123456789abcdef"].join(""),
  '{"action":"opened","pull_request":{"id":7}}',
] as const;

describe("GitHub Checks descriptors — secret-safe output (R-07)", () => {
  it.each(SensitiveValues)("omits sensitive runtime value %s", (secret) => {
    // Given the review verdict is "request-changes"
    // And the review has 1 finding
    // And a signed audit entry is available
    // And the runtime contains sensitive value "<secret>"
    process.env["SOVRI_R07_SENSITIVE_VALUE"] = secret;

    try {
      // When the Sovri check descriptors are mapped
      const descriptors = mapChecks({
        verdict: { kind: "request-changes", label: "Request changes" },
        findingCount: 1,
        hasSignedAuditEntry: true,
      });

      // Then no descriptor title contains "<secret>"
      // And no descriptor summary contains "<secret>"
      for (const descriptor of descriptors) {
        expect(descriptor.title).not.toContain(secret);
        expect(descriptor.summary).not.toContain(secret);
      }
    } finally {
      delete process.env["SOVRI_R07_SENSITIVE_VALUE"];
    }
  });
});
