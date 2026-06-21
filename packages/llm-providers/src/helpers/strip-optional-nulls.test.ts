// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { stripOptionalNulls } from "./strip-optional-nulls.js";

describe("stripOptionalNulls", () => {
  it("drops a null value on an optional, non-nullable property", () => {
    const schema = z.strictObject({ a: z.string(), cwe: z.string().optional() });

    expect(stripOptionalNulls({ a: "x", cwe: null }, schema)).toEqual({ a: "x" });
  });

  it("keeps a null value when the property schema allows null", () => {
    const schema = z.strictObject({ a: z.string(), cwe: z.string().nullable().optional() });

    expect(stripOptionalNulls({ a: "x", cwe: null }, schema)).toEqual({ a: "x", cwe: null });
  });

  it("keeps a null value on a required property", () => {
    const schema = z.strictObject({ a: z.string() });

    expect(stripOptionalNulls({ a: null }, schema)).toEqual({ a: null });
  });

  it("keeps non-null values and recurses through array items", () => {
    const schema = z.strictObject({
      items: z.array(z.strictObject({ cwe: z.string().optional() })),
    });

    expect(stripOptionalNulls({ items: [{ cwe: null }, { cwe: "CWE-1" }] }, schema)).toEqual({
      items: [{}, { cwe: "CWE-1" }],
    });
  });

  it("passes a non-record top-level value through untouched", () => {
    expect(stripOptionalNulls(42, z.number())).toBe(42);
  });
});
