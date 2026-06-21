// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { normalizeStrictObjectShapes } from "./strict-json-schema.js";

// Branch-level unit tests for the provider-neutral strict-schema normalizer.
// The Mistral acceptance test (MistralProvider.response.test.ts) only exercises
// the `cwe` (string-typed) path; these cover the other JSON-schema value shapes
// `allowNull` handles for OpenAI parity.
describe("normalizeStrictObjectShapes", () => {
  it("promotes a not-required string property to required + nullable and pins additionalProperties false", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: { a: { type: "string" } },
        required: [],
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: ["string", "null"] } },
      required: ["a"],
      additionalProperties: false,
    });
  });

  it("leaves an already-required property untouched", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    });
  });

  it("appends null to a string-array type, but not when null is already present", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: {
          a: { type: ["string", "number"] },
          b: { type: ["string", "null"] },
        },
        required: [],
      }),
    ).toEqual({
      type: "object",
      properties: {
        a: { type: ["string", "number", "null"] },
        b: { type: ["string", "null"] },
      },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("adds a null member to an anyOf, but not when one is already there", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: {
          a: { anyOf: [{ type: "string" }] },
          b: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: [],
      }),
    ).toEqual({
      type: "object",
      properties: {
        a: { anyOf: [{ type: "string" }, { type: "null" }] },
        b: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });

  it("wraps a typeless property (enum-only) in an anyOf with null", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: { a: { enum: ["x", "y"] } },
        required: [],
      }),
    ).toEqual({
      type: "object",
      properties: { a: { anyOf: [{ enum: ["x", "y"] }, { type: "null" }] } },
      required: ["a"],
      additionalProperties: false,
    });
  });

  it("normalizes nested object nodes recursively through array items", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: {
          list: {
            type: "array",
            items: { type: "object", properties: { b: { type: "string" } }, required: [] },
          },
        },
        required: ["list"],
      }),
    ).toEqual({
      type: "object",
      properties: {
        list: {
          type: "array",
          items: {
            type: "object",
            properties: { b: { type: ["string", "null"] } },
            required: ["b"],
            additionalProperties: false,
          },
        },
      },
      required: ["list"],
      additionalProperties: false,
    });
  });

  it("treats an object node with no properties as empty-required (missing required key)", () => {
    expect(normalizeStrictObjectShapes({ type: "object" })).toEqual({
      type: "object",
      required: [],
      additionalProperties: false,
    });
  });

  it("treats a non-record properties value (e.g. an array) as a property-less object node", () => {
    expect(normalizeStrictObjectShapes({ type: "object", properties: [], required: [] })).toEqual({
      type: "object",
      properties: [],
      required: [],
      additionalProperties: false,
    });
  });

  it("passes non-record property values through untouched", () => {
    expect(
      normalizeStrictObjectShapes({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        title: "ignored scalar",
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
      title: "ignored scalar",
    });
  });
});
