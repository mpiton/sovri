// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

type JsonSchemaMatchMode = "strict" | "openai-response";

export function matchesJsonSchemaValue(value: unknown, schema: unknown): boolean {
  return matchesJsonSchemaValueForMode(value, schema, "strict");
}

export function matchesOpenAIResponseJsonSchemaValue(value: unknown, schema: unknown): boolean {
  return matchesJsonSchemaValueForMode(value, schema, "openai-response");
}

export function allowsNullJsonSchemaValue(value: unknown): boolean {
  if (!isJsonObject(value)) {
    return false;
  }

  const type = value["type"];
  if (type === "null") {
    return true;
  }
  if (isStringArray(type) && type.includes("null")) {
    return true;
  }

  const values = value["enum"];
  if (Array.isArray(values) && values.some((item) => item === null)) {
    return true;
  }

  const anyOf = value["anyOf"];
  return Array.isArray(anyOf) && anyOf.some(allowsNullJsonSchemaValue);
}

function matchesJsonSchemaValueForMode(
  value: unknown,
  schema: unknown,
  mode: JsonSchemaMatchMode,
): boolean {
  if (!isJsonObject(schema)) {
    return true;
  }

  return (
    matchesJsonSchemaAlternatives(value, schema, mode) &&
    matchesJsonSchemaConstOrEnum(value, schema) &&
    matchesJsonSchemaType(value, schema["type"]) &&
    matchesJsonSchemaChildren(value, schema, mode)
  );
}

function matchesJsonSchemaAlternatives(
  value: unknown,
  schema: Record<string, unknown>,
  mode: JsonSchemaMatchMode,
): boolean {
  const anyOf = schema["anyOf"];
  if (
    Array.isArray(anyOf) &&
    !anyOf.some((branch) => matchesJsonSchemaValueForMode(value, branch, mode))
  ) {
    return false;
  }

  const oneOf = schema["oneOf"];
  return (
    !Array.isArray(oneOf) ||
    oneOf.some((branch) => matchesJsonSchemaValueForMode(value, branch, mode))
  );
}

function matchesJsonSchemaConstOrEnum(value: unknown, schema: Record<string, unknown>): boolean {
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema["const"])) {
    return false;
  }

  const values = schema["enum"];
  return !Array.isArray(values) || values.some((item) => Object.is(item, value));
}

function matchesJsonSchemaType(value: unknown, type: unknown): boolean {
  return typeof type === "string"
    ? matchesJsonSchemaSingleType(value, type)
    : !isStringArray(type) || type.some((item) => matchesJsonSchemaSingleType(value, item));
}

function matchesJsonSchemaSingleType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isJsonObject(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    default:
      return typeof value === type;
  }
}

function matchesJsonSchemaChildren(
  value: unknown,
  schema: Record<string, unknown>,
  mode: JsonSchemaMatchMode,
): boolean {
  if (Array.isArray(value)) {
    return value.every((item) => matchesJsonSchemaValueForMode(item, schema["items"], mode));
  }
  if (!isJsonObject(value)) {
    return true;
  }

  return matchesJsonSchemaObjectChildren(value, schema, mode);
}

function matchesJsonSchemaObjectChildren(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  mode: JsonSchemaMatchMode,
): boolean {
  const properties = schema["properties"];
  const requiredProperties = stringArray(schema["required"]);
  if (requiredProperties.some((propertyName) => value[propertyName] === undefined)) {
    return false;
  }
  if (!isJsonObject(properties)) {
    return schema["additionalProperties"] !== false || Object.keys(value).length === 0;
  }
  if (!allowsAdditionalProperties(value, properties, schema)) {
    return false;
  }

  return Object.entries(value).every(([propertyName, propertyValue]) =>
    matchesJsonSchemaPropertyValue(
      propertyValue,
      properties[propertyName],
      requiredProperties.includes(propertyName),
      mode,
    ),
  );
}

function allowsAdditionalProperties(
  value: Record<string, unknown>,
  properties: Record<string, unknown>,
  schema: Record<string, unknown>,
): boolean {
  return (
    schema["additionalProperties"] !== false ||
    Object.keys(value).every((propertyName) => properties[propertyName] !== undefined)
  );
}

function matchesJsonSchemaPropertyValue(
  value: unknown,
  schema: unknown,
  isRequired: boolean,
  mode: JsonSchemaMatchMode,
): boolean {
  return (
    isOpenAIOptionalNullSentinel(value, schema, isRequired, mode) ||
    matchesJsonSchemaValueForMode(value, schema, mode)
  );
}

function isOpenAIOptionalNullSentinel(
  value: unknown,
  schema: unknown,
  isRequired: boolean,
  mode: JsonSchemaMatchMode,
): boolean {
  return (
    mode === "openai-response" &&
    value === null &&
    !isRequired &&
    schema !== undefined &&
    !allowsNullJsonSchemaValue(schema)
  );
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
