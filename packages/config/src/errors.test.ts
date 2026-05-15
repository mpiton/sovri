// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { z } from "@sovri/core";

import { SovriConfigParseError, SovriConfigValidationError } from "./errors.js";

describe("SovriConfigParseError", () => {
  it("preserves the original parser error in cause", () => {
    const original = new Error("YAML syntax error at line 2");
    const err = new SovriConfigParseError("/repo/.sovri.yml", original);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SovriConfigParseError");
    expect(err.cause).toBe(original);
    expect(err.message).toContain("/repo/.sovri.yml");
  });

  it("attaches the offending file path as a public field", () => {
    const err = new SovriConfigParseError("/abs/path/.sovri.yml", "raw");

    expect(err.filePath).toBe("/abs/path/.sovri.yml");
  });

  it("accepts an unknown cause without throwing", () => {
    const err = new SovriConfigParseError("/x", { not: "an error" });

    expect(err.cause).toEqual({ not: "an error" });
  });
});

describe("SovriConfigValidationError", () => {
  const ProbeSchema = z.strictObject({ x: z.string() });
  const zodError = ProbeSchema.safeParse({ y: 1 }).error!;

  it("preserves the ZodError in cause and surfaces its issues", () => {
    const err = new SovriConfigValidationError("/repo/.sovri.yml", zodError);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SovriConfigValidationError");
    expect(err.cause).toBe(zodError);
    expect(err.issues).toBe(zodError.issues);
    expect(err.issues.length).toBeGreaterThan(0);
  });

  it("attaches the offending file path as a public field", () => {
    const err = new SovriConfigValidationError("/abs/path/.sovri.yml", zodError);

    expect(err.filePath).toBe("/abs/path/.sovri.yml");
    expect(err.message).toContain("/abs/path/.sovri.yml");
  });
});
