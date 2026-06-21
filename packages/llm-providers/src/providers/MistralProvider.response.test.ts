// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { LLMResponseSchema } from "../schemas/LLMResponseSchema.js";
import { createMistralJsonSchemaResponseFormat } from "./MistralProvider.response.js";

// R-01 — bring the Mistral structured-response schema to OpenAI parity: optional
// finding fields (notably `cwe`) are forced into the object's `required` array and
// made nullable, so the model must decide `cwe` on every finding instead of
// silently omitting it. Strict-mode invariants (strict: true,
// additionalProperties: false) are preserved, and a schema whose properties are
// already all required is left unchanged (idempotent boundary).
describe("Mistral structured-response schema forces a per-finding cwe decision", () => {
  // Background:
  //   Given the Sovri LLM response schema where each finding has an optional "cwe" field
  //   And the Mistral provider builds its structured-response format with strict mode enabled

  // @nominal — Scenario: Optional cwe is promoted to required and made nullable
  it("promotes optional cwe to required and makes it nullable", () => {
    // When the Mistral JSON-schema response format is built
    const finding = findingObjectSchema(createMistralJsonSchemaResponseFormat(LLMResponseSchema));

    // Then each finding object lists "cwe" in its "required" array
    expect(requiredOf(finding)).toContain("cwe");
    // And the emitted "cwe" sub-schema accepts a null value
    expect(acceptsNull(propertyOf(finding, "cwe"))).toBe(true);
  });

  // @nominal — Scenario: A genuinely required finding field stays non-nullable
  it("keeps a genuinely required field required and non-nullable", () => {
    // When the Mistral JSON-schema response format is built
    const finding = findingObjectSchema(createMistralJsonSchemaResponseFormat(LLMResponseSchema));

    // Then each finding object lists "severity" in its "required" array
    expect(requiredOf(finding)).toContain("severity");
    // And the emitted "severity" sub-schema does not accept a null value
    expect(acceptsNull(propertyOf(finding, "severity"))).toBe(false);
  });

  // @technical — Scenario: Strict-mode constraints are preserved at every object level
  it("preserves strict mode and additionalProperties:false at every object node", () => {
    // When the Mistral JSON-schema response format is built
    const format = createMistralJsonSchemaResponseFormat(LLMResponseSchema);

    // Then the response format keeps "strict" set to true
    expect(strictFlag(format)).toBe(true);
    // And every object node sets "additionalProperties" to false
    expect(everyObjectNodeForbidsAdditionalProperties(schemaDefinition(format))).toBe(true);
  });

  // @limit — Scenario: A schema with no optional fields keeps its required array unchanged
  it("leaves an already fully-required schema unchanged", () => {
    // Given a finding schema whose every property is already required
    const allRequired = z.strictObject({ severity: z.string(), title: z.string() });

    // When the Mistral JSON-schema response format is built
    const root = schemaDefinition(createMistralJsonSchemaResponseFormat(allRequired));

    // Then the finding's "required" array is unchanged
    const required = requiredOf(root);
    expect(required).toHaveLength(2);
    expect(required).toContain("severity");
    expect(required).toContain("title");
    // And no property is made nullable
    expect(acceptsNull(propertyOf(root, "severity"))).toBe(false);
    expect(acceptsNull(propertyOf(root, "title"))).toBe(false);
  });
});

function schemaDefinition(format: unknown): Record<string, unknown> {
  const jsonSchema = requireRecord(requireRecord(format)["jsonSchema"]);
  return requireRecord(jsonSchema["schemaDefinition"]);
}

function strictFlag(format: unknown): unknown {
  return requireRecord(requireRecord(format)["jsonSchema"])["strict"];
}

function findingObjectSchema(format: unknown): Record<string, unknown> {
  const root = schemaDefinition(format);
  const findings = requireRecord(requireRecord(root["properties"])["findings"]);
  return requireRecord(findings["items"]);
}

function propertyOf(objectSchema: Record<string, unknown>, name: string): unknown {
  return requireRecord(objectSchema["properties"])[name];
}

function requiredOf(objectSchema: Record<string, unknown>): readonly string[] {
  const required = objectSchema["required"];
  if (!Array.isArray(required) || !required.every((entry) => typeof entry === "string")) {
    throw new Error("Expected a string[] 'required' array");
  }
  return required;
}

function acceptsNull(subSchema: unknown): boolean {
  if (!isRecord(subSchema)) return false;

  const type = subSchema["type"];
  if (type === "null") return true;
  if (Array.isArray(type) && type.includes("null")) return true;

  const anyOf = subSchema["anyOf"];
  return Array.isArray(anyOf) && anyOf.some((entry) => isRecord(entry) && entry["type"] === "null");
}

function everyObjectNodeForbidsAdditionalProperties(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.every(everyObjectNodeForbidsAdditionalProperties);
  }
  if (!isRecord(node)) return true;
  if (isObjectSchemaNode(node) && node["additionalProperties"] !== false) return false;
  return Object.values(node).every(everyObjectNodeForbidsAdditionalProperties);
}

function isObjectSchemaNode(node: Record<string, unknown>): boolean {
  return node["type"] === "object" || isRecord(node["properties"]);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected value to be an object record");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
