// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import { OpenAIProviderError } from "./OpenAIProvider.errors.js";
import { isJsonObject, isStringArray, stringArray } from "./OpenAIProvider.schema-guards.js";

export function createOpenAIStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    const jsonSchema = zodToProviderJsonSchema(schema);

    if (!isJsonObject(jsonSchema) || jsonSchema["type"] !== "object") {
      throw new OpenAIProviderError("OpenAI JSON schema root must be an object schema");
    }

    return normalizeOpenAIStrictJsonSchema(jsonSchema);
  } catch (cause) {
    if (cause instanceof OpenAIProviderError) {
      throw new OpenAIProviderError(`Failed to build OpenAI response schema: ${cause.message}`, {
        cause,
      });
    }

    throw new OpenAIProviderError("Failed to build OpenAI response schema", { cause });
  }
}

function normalizeOpenAIStrictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeJsonSchemaValue(schema);
  if (!isJsonObject(normalized)) {
    throw new OpenAIProviderError("OpenAI JSON schema root must be an object schema");
  }

  return normalized;
}

function normalizeJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchemaValue);
  }
  if (!isJsonObject(value)) {
    return value;
  }

  const normalized = normalizeJsonSchemaObject(value);
  normalizeOpenAIObjectShape(normalized);

  return normalized;
}

function normalizeJsonSchemaObject(value: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeJsonSchemaValue(child);
  }
  rewriteOpenAISupportedSchemaKeywords(normalized);

  return normalized;
}

function rewriteOpenAISupportedSchemaKeywords(schema: Record<string, unknown>): void {
  if (schema["allOf"] !== undefined) {
    throw new OpenAIProviderError("OpenAI strict JSON schemas do not support allOf.");
  }

  if (Object.hasOwn(schema, "const")) {
    const constantValue = schema["const"];
    delete schema["const"];
    schema["enum"] = [constantValue];
  }

  const oneOf = schema["oneOf"];
  if (!Array.isArray(oneOf)) {
    return;
  }
  if (schema["anyOf"] !== undefined) {
    throw new OpenAIProviderError("OpenAI strict JSON schemas do not support mixed oneOf/anyOf");
  }

  delete schema["oneOf"];
  schema["anyOf"] = oneOf;
}

function normalizeOpenAIObjectShape(schema: Record<string, unknown>): void {
  const properties = schema["properties"];
  if (schema["type"] !== "object" && !isJsonObject(properties)) {
    return;
  }
  if (hasDynamicObjectProperties(schema)) {
    throw new OpenAIProviderError(
      "OpenAI strict JSON schemas do not support dynamic object properties.",
    );
  }

  const requiredProperties = new Set(stringArray(schema["required"]));
  if (isJsonObject(properties)) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (!requiredProperties.has(propertyName)) {
        properties[propertyName] = allowNullJsonSchemaValue(propertySchema);
      }
    }
  }

  schema["additionalProperties"] = false;
  schema["required"] = isJsonObject(properties) ? Object.keys(properties) : [];
}

function allowNullJsonSchemaValue(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return value;
  }

  const type = value["type"];
  if (typeof type === "string") {
    value["type"] = type === "null" ? type : [type, "null"];
    return value;
  }
  if (isStringArray(type)) {
    value["type"] = type.includes("null") ? type : [...type, "null"];
    return value;
  }

  const anyOf = value["anyOf"];
  if (Array.isArray(anyOf)) {
    if (!anyOf.some(isNullSchema)) {
      value["anyOf"] = [...anyOf, { type: "null" }];
    }
    return value;
  }

  return { anyOf: [value, { type: "null" }] };
}

function hasDynamicObjectProperties(schema: Record<string, unknown>): boolean {
  const additionalProperties = schema["additionalProperties"];
  return (
    schema["propertyNames"] !== undefined ||
    (additionalProperties !== undefined && additionalProperties !== false)
  );
}

function isNullSchema(value: unknown): boolean {
  return isJsonObject(value) && value["type"] === "null";
}
