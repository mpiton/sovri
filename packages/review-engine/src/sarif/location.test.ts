// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-05 (safe file resolution from a SARIF physical
// location): the uri chain is resolved, uriBaseId resolved or refused,
// percent-decoded, and routed through repo-relative normalization. A
// non-relative scheme, an absolute path, or a traversal that escapes the repo
// is dropped, never surfaced; a result with no physical location is dropped.

import { describe, expect, it } from "vitest";

import { resolveSarifFile } from "./location.js";

function resultWithArtifactLocation(
  artifactLocation: Record<string, unknown>,
): Record<string, unknown> {
  return { ruleId: "rule-1", locations: [{ physicalLocation: { artifactLocation } }] };
}

describe("resolveSarifFile — R-05 safe file resolution", () => {
  it("resolves a relative artifactLocation uri to a repo-relative path", () => {
    // Given a result whose physicalLocation.artifactLocation.uri is "src/auth/login.ts"
    const result = resultWithArtifactLocation({ uri: "src/auth/login.ts" });

    // When the file is resolved / Then the Finding file is "src/auth/login.ts"
    expect(resolveSarifFile(result)).toEqual({ file: "src/auth/login.ts" });
  });

  it("falls back to run.artifacts[index].location.uri", () => {
    // Given a result referencing artifact index 0 with no inline uri
    const result = resultWithArtifactLocation({ index: 0 });
    const run = { artifacts: [{ location: { uri: "src/payments/charge.ts" } }] };

    // When the file is resolved / Then it uses the run artifact uri
    expect(resolveSarifFile(result, run)).toEqual({ file: "src/payments/charge.ts" });
  });

  it("percent-decodes a relative uri before normalization", () => {
    // Given an artifactLocation.uri "src/util/parse%20query.ts"
    const result = resultWithArtifactLocation({ uri: "src/util/parse%20query.ts" });

    // When the file is resolved / Then it is decoded
    expect(resolveSarifFile(result)).toEqual({ file: "src/util/parse query.ts" });
  });

  it("resolves a uri relative to a known uriBaseId", () => {
    // Given originalUriBaseIds defines "SRCROOT" as "src/" and uri "auth/login.ts" with that base
    const result = resultWithArtifactLocation({ uri: "auth/login.ts", uriBaseId: "SRCROOT" });
    const run = { originalUriBaseIds: { SRCROOT: { uri: "src/" } } };

    // When the file is resolved / Then it is resolved against the base
    expect(resolveSarifFile(result, run)).toEqual({ file: "src/auth/login.ts" });
  });

  it("refuses a uri referencing an unknown uriBaseId", () => {
    // Given a uriBaseId "SRCROOT" with no entry in originalUriBaseIds
    const result = resultWithArtifactLocation({ uri: "auth/login.ts", uriBaseId: "SRCROOT" });
    const run = { originalUriBaseIds: {} };

    // When the file is resolved / Then it is dropped, not assumed repo-relative
    expect(resolveSarifFile(result, run)).toEqual({ dropped: "unresolved-uri-base-id" });
  });

  it.each([
    ["file:///etc/passwd", "non-relative-uri"],
    ["http://evil.example/x.ts", "non-relative-uri"],
    ["/etc/shadow", "absolute-path"],
    ["../../../../etc/passwd", "path-escape"],
  ])("drops a uri that escapes the repository: %s", (uri, reason) => {
    // Given an artifactLocation.uri that escapes the repo
    const result = resultWithArtifactLocation({ uri });

    // When the file is resolved / Then it is dropped with the matching reason
    expect(resolveSarifFile(result)).toEqual({ dropped: reason });
  });

  it("drops a result with no physical location", () => {
    // Given a result that carries no physicalLocation
    const result = { ruleId: "rule-1", locations: [{}] };

    // When the file is resolved / Then it is dropped with reason "no-physical-location"
    expect(resolveSarifFile(result)).toEqual({ dropped: "no-physical-location" });
  });
});
