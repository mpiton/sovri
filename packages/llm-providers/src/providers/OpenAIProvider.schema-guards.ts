// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * Shared JSON-value type guards for the OpenAI provider schema modules
 * (matching, normalization, stripping). Pure predicates, no I/O.
 */

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function stringArray(value: unknown): readonly string[] {
  return isStringArray(value) ? value : [];
}
