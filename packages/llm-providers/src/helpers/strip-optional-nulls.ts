// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "@sovri/core";

import { zodToProviderJsonSchema } from "./provider-json-schema.js";

// Drop null-valued properties that the schema marks optional and non-nullable, so
// a strict provider that emits `field: null` for an absent optional field (e.g.
// strict-mode `cwe`) round-trips to the same parsed value as if the field were
// omitted. The schema is consulted so a field that legitimately allows null keeps
// its null.
//
// Mirrors the OpenAI adapter's null strip. The OpenAI variant additionally
// resolves `anyOf` unions branch-by-branch; the Sovri response schema has no such
// unions, so this provider-neutral form walks objects and arrays directly.
export function stripOptionalNulls(value: unknown, schema: z.ZodType): unknown {
  return stripValue(value, zodToProviderJsonSchema(schema));
}

function stripValue(value: unknown, schema: unknown): unknown {
  if (Array.isArray(value)) {
    const items = isRecord(schema) ? schema["items"] : undefined;
    return value.map((item) => stripValue(item, items));
  }
  if (!isRecord(value) || !isRecord(schema)) {
    return value;
  }

  const properties = schema["properties"];
  if (!isRecord(properties)) {
    return value;
  }

  const required = new Set(stringArray(schema["required"]));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (child === null && !required.has(key) && !allowsNull(propertySchema)) {
      continue;
    }
    result[key] = stripValue(child, propertySchema);
  }

  return result;
}

function allowsNull(schema: unknown): boolean {
  if (!isRecord(schema)) {
    return false;
  }

  const type = schema["type"];
  if (type === "null") {
    return true;
  }
  if (Array.isArray(type) && type.includes("null")) {
    return true;
  }

  const anyOf = schema["anyOf"];
  return Array.isArray(anyOf) && anyOf.some((entry) => isRecord(entry) && entry["type"] === "null");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
