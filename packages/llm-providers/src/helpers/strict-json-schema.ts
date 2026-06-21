// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// Provider-neutral strict-schema normalization shared by structured-output
// adapters. Every object node lists all of its properties in `required`,
// properties that were not already required are made nullable, and
// `additionalProperties` is pinned to false. This forces the model to emit a
// value (or an explicit null) for every field instead of silently omitting an
// optional one — the behavior both OpenAI strict mode and Mistral strict mode
// rely on for fields like `cwe`.
//
// OpenAI's adapter layers extra strict-mode keyword rewrites (const -> enum,
// oneOf -> anyOf, allOf / dynamic-property rejection) on top of this shape
// normalization; those constraints are OpenAI-strict-specific and stay in the
// OpenAI adapter.
export function normalizeStrictObjectShapes(
  jsonSchema: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = normalizeValue(jsonSchema);
  if (!isRecord(normalized)) {
    throw new Error("strict JSON schema root must be an object schema (received non-object root)");
  }

  return normalized;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeValue(child);
  }
  normalizeObjectShape(normalized);

  return normalized;
}

function normalizeObjectShape(schema: Record<string, unknown>): void {
  const properties = schema["properties"];
  if (schema["type"] !== "object" && !isRecord(properties)) {
    return;
  }

  const required = new Set(stringArray(schema["required"]));
  if (isRecord(properties)) {
    for (const [name, sub] of Object.entries(properties)) {
      if (!required.has(name)) {
        properties[name] = allowNull(sub);
      }
    }
  }

  schema["additionalProperties"] = false;
  schema["required"] = isRecord(properties) ? Object.keys(properties) : [];
}

function allowNull(value: unknown): unknown {
  if (!isRecord(value)) {
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNullSchema(value: unknown): boolean {
  return isRecord(value) && value["type"] === "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
