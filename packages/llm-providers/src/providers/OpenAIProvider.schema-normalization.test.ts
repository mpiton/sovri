// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const ProviderJsonSchemaHelper = "../helpers/provider-json-schema.js";

describe("OpenAIProvider schema normalization", () => {
  afterEach(() => {
    vi.doUnmock(ProviderJsonSchemaHelper);
    vi.resetModules();
  });

  it("makes optional enum-only and const-only schemas nullable with supported keywords", async () => {
    vi.resetModules();
    vi.doMock(ProviderJsonSchemaHelper, () => ({
      zodToProviderJsonSchema: () => ({
        type: "object",
        properties: {
          mode: { const: "manual" },
          status: { enum: ["ok", "err"] },
        },
        required: [],
      }),
    }));

    const { createOpenAIStrictJsonSchema } =
      await import("./OpenAIProvider.schema-normalization.js");

    const normalized = createOpenAIStrictJsonSchema(z.strictObject({}));
    const properties = requireRecord(normalized["properties"]);

    expect(properties["mode"]).toEqual({
      anyOf: [{ enum: ["manual"] }, { type: "null" }],
    });
    expect(properties["status"]).toEqual({
      anyOf: [{ enum: ["ok", "err"] }, { type: "null" }],
    });
    expect(normalized["required"]).toEqual(["mode", "status"]);
  });

  it("rewrites oneOf branches to the supported anyOf keyword", async () => {
    vi.resetModules();
    vi.doMock(ProviderJsonSchemaHelper, () => ({
      zodToProviderJsonSchema: () => ({
        type: "object",
        properties: {
          item: {
            oneOf: [{ type: "string" }, { type: "number" }],
          },
        },
        required: ["item"],
      }),
    }));

    const { createOpenAIStrictJsonSchema } =
      await import("./OpenAIProvider.schema-normalization.js");

    const normalized = createOpenAIStrictJsonSchema(z.strictObject({}));
    const properties = requireRecord(normalized["properties"]);

    expect(properties["item"]).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("rejects nested allOf schemas before provider requests", async () => {
    vi.resetModules();
    vi.doMock(ProviderJsonSchemaHelper, () => ({
      zodToProviderJsonSchema: () => ({
        type: "object",
        properties: {
          item: {
            allOf: [{ type: "object" }, { type: "object" }],
          },
        },
        required: ["item"],
      }),
    }));

    const { createOpenAIStrictJsonSchema } =
      await import("./OpenAIProvider.schema-normalization.js");

    expect(() => createOpenAIStrictJsonSchema(z.strictObject({}))).toThrow("allOf");
  });
});

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected value to be an object record");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
