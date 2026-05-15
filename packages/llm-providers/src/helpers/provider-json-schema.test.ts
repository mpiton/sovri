// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { LLMResponseSchema } from "../schemas/LLMResponseSchema.js";
import { zodToProviderJsonSchema } from "./provider-json-schema.js";

// Narrow the JSON Schema return type at assertion points — the lib's
// `BaseSchema` is intentionally loose because draft 2020-12 allows any
// keyword shape. The casts only widen access for the assertions; runtime
// shape is still validated via `toMatchObject` / direct comparisons.
interface JsonObjectSchema {
  type?: string;
  properties?: Record<string, JsonObjectSchema>;
  items?: JsonObjectSchema;
  required?: readonly string[];
  enum?: readonly unknown[];
}

describe("zodToProviderJsonSchema — primitives", () => {
  it("converts a flat object to type/properties/required", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const json = zodToProviderJsonSchema(schema) as JsonObjectSchema;
    expect(json).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    });
    expect(json.required).toHaveLength(2);
    expect(json.required).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("omits optional fields from the required array", () => {
    const schema = z.object({ a: z.string(), b: z.string().optional() });
    const json = zodToProviderJsonSchema(schema) as JsonObjectSchema;
    expect(json.required).toEqual(["a"]);
    expect(json.properties).toHaveProperty("b");
  });

  it("converts an enum to an enum keyword array", () => {
    const schema = z.object({ status: z.enum(["ok", "error"]) });
    const json = zodToProviderJsonSchema(schema) as JsonObjectSchema;
    expect(json.properties?.status?.enum).toEqual(["ok", "error"]);
  });
});

describe("zodToProviderJsonSchema — nested objects", () => {
  it("converts a nested object schema preserving inner shape and required", () => {
    const schema = z.object({
      inner: z.object({ flag: z.boolean(), name: z.string() }),
    });
    const json = zodToProviderJsonSchema(schema) as JsonObjectSchema;
    expect(json.properties).toMatchObject({
      inner: {
        type: "object",
        properties: { flag: { type: "boolean" }, name: { type: "string" } },
      },
    });
    const inner = json.properties?.inner;
    expect(inner?.required).toHaveLength(2);
    expect(inner?.required).toEqual(expect.arrayContaining(["flag", "name"]));
  });

  it("inlines reused subschemas instead of emitting $ref", () => {
    const Inner = z.object({ x: z.number() });
    const schema = z.object({ a: Inner, b: Inner });
    const serialized = JSON.stringify(zodToProviderJsonSchema(schema));
    expect(serialized).not.toContain("$ref");
  });
});

describe("zodToProviderJsonSchema — arrays", () => {
  it("converts an array schema with typed items", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const json = zodToProviderJsonSchema(schema) as JsonObjectSchema;
    expect(json.properties).toMatchObject({
      tags: { type: "array", items: { type: "string" } },
    });
  });

  it("converts an array of objects with nested properties and required", () => {
    const schema = z.object({
      entries: z.array(z.object({ key: z.string(), value: z.number() })),
    });
    const json = zodToProviderJsonSchema(schema) as JsonObjectSchema;
    expect(json.properties).toMatchObject({
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: { key: { type: "string" }, value: { type: "number" } },
        },
      },
    });
    const items = json.properties?.entries?.items;
    expect(items?.required).toHaveLength(2);
    expect(items?.required).toEqual(expect.arrayContaining(["key", "value"]));
  });
});

describe("zodToProviderJsonSchema — @sovri/core integration", () => {
  it("converts FindingSchema producing object/enum/regex properties with exact required set", () => {
    const json = zodToProviderJsonSchema(FindingSchema) as JsonObjectSchema;
    expect(json.type).toBe("object");
    expect(json.properties).toMatchObject({
      severity: { enum: ["blocker", "major", "minor", "info", "nitpick"] },
      category: {
        enum: [
          "bug",
          "security",
          "performance",
          "maintainability",
          "style",
          "documentation",
          "test-coverage",
        ],
      },
    });
    const expectedRequired = [
      "id",
      "severity",
      "category",
      "file",
      "line_start",
      "line_end",
      "title",
      "body",
      "source",
      "confidence",
    ];
    expect(json.required).toHaveLength(expectedRequired.length);
    expect(json.required).toEqual(expect.arrayContaining(expectedRequired));
    expect(json.required).not.toContain("suggestion");
    expect(json.required).not.toContain("cwe");
  });

  it("converts LLMResponseSchema producing a nested array of finding objects with full inner required", () => {
    const json = zodToProviderJsonSchema(LLMResponseSchema) as JsonObjectSchema;
    expect(json.type).toBe("object");
    expect(json.properties).toMatchObject({
      summary: { type: "string" },
      walkthrough_markdown: { type: "string" },
      findings: {
        type: "array",
        items: { type: "object" },
      },
    });
    const expectedTopLevel = ["summary", "findings", "walkthrough_markdown"];
    expect(json.required).toHaveLength(expectedTopLevel.length);
    expect(json.required).toEqual(expect.arrayContaining(expectedTopLevel));

    const items = json.properties?.findings?.items;
    const expectedInner = [
      "severity",
      "category",
      "file",
      "line_start",
      "line_end",
      "title",
      "body",
    ];
    expect(items?.required).toHaveLength(expectedInner.length);
    expect(items?.required).toEqual(expect.arrayContaining(expectedInner));
  });
});
