// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import {
  allowsNullJsonSchemaValue,
  matchesJsonSchemaValue,
  matchesOpenAIResponseJsonSchemaValue,
} from "./OpenAIProvider.schema-matching.js";

export function stripOpenAIOptionalNulls(value: unknown, schema: z.ZodType): unknown {
  return stripOptionalNullsFromValue(value, zodToProviderJsonSchema(schema));
}

function stripOptionalNullsFromValue(value: unknown, schema: unknown): unknown {
  if (Array.isArray(value)) {
    const itemSchema = isJsonObject(schema) ? schema["items"] : undefined;
    return value.map((item) => stripOptionalNullsFromValue(item, itemSchema));
  }
  if (!isJsonObject(value) || !isJsonObject(schema)) {
    return value;
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    return stripOptionalNullsFromAnyOf(value, anyOf);
  }

  const properties = schema["properties"];
  if (!isJsonObject(properties)) {
    return value;
  }

  const requiredProperties = new Set(stringArray(schema["required"]));
  const normalized: Record<string, unknown> = {};
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[propertyName];
    if (
      propertyValue === null &&
      !requiredProperties.has(propertyName) &&
      !allowsNullJsonSchemaValue(propertySchema)
    ) {
      continue;
    }

    normalized[propertyName] = stripOptionalNullsFromValue(propertyValue, propertySchema);
  }

  return normalized;
}

function stripOptionalNullsFromAnyOf(value: unknown, schemas: ReadonlyArray<unknown>): unknown {
  let bestValue = value;
  let bestRemovedNulls = -1;
  const sourceNulls = countNullValues(value);

  for (const schema of schemas) {
    if (!matchesOpenAIResponseJsonSchemaValue(value, schema)) {
      continue;
    }

    const candidate = stripOptionalNullsFromValue(value, schema);
    if (!matchesJsonSchemaValue(candidate, schema)) {
      continue;
    }

    const removedNulls = sourceNulls - countNullValues(candidate);
    if (removedNulls > bestRemovedNulls) {
      bestValue = candidate;
      bestRemovedNulls = removedNulls;
    }
  }

  return bestValue;
}

function countNullValues(value: unknown): number {
  if (value === null) {
    return 1;
  }
  if (!Array.isArray(value) && !isJsonObject(value)) {
    return 0;
  }

  const values = Array.isArray(value) ? value : Object.values(value);
  let count = 0;
  for (const item of values) {
    count += countNullValues(item);
  }

  return count;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringArray(value: unknown): readonly string[] {
  return isStringArray(value) ? value : [];
}
