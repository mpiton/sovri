// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { deriveCwe } from "./derive.js";

describe("deriveCwe — deterministic CWE derivation from finding signals (ADR-020)", () => {
  it("derives CWE-89 from raw SQL string concatenation", () => {
    expect(
      deriveCwe({
        title: "raw SQL string concatenation against the users table",
        body: "The finding describes raw SQL string concatenation against the users table.",
      }),
    ).toBe("CWE-89");
  });

  it("derives CWE-79 from unescaped user input rendered into HTML", () => {
    expect(
      deriveCwe({
        title: "unescaped user input rendered into an HTML response",
        body: "The finding describes unescaped user input rendered into an HTML response.",
      }),
    ).toBe("CWE-79");
  });

  it("is case-insensitive on the signal text", () => {
    expect(deriveCwe({ title: "RAW SQL STRING CONCATENATION", body: "" })).toBe("CWE-89");
  });

  it("declines (undefined) for a generic concern with no identifiable vulnerability class", () => {
    expect(
      deriveCwe({
        title: "possible security concern",
        body: "A generic possible security concern with no identifiable vulnerability class.",
      }),
    ).toBeUndefined();
  });

  it("declines for content unrelated to any rule", () => {
    expect(
      deriveCwe({ title: "inconsistent quote style", body: "Use double quotes throughout." }),
    ).toBeUndefined();
  });

  it("declines (undefined) when the content matches more than one rule (ambiguous)", () => {
    expect(
      deriveCwe({
        title: "unescaped SQL string concatenation rendered into an HTML response",
        body: "The finding describes unescaped SQL string concatenation rendered into an HTML response.",
      }),
    ).toBeUndefined();
  });
});
