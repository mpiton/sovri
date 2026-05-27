// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPackageManifest(): Record<string, unknown> {
  const value = readJson(join(packageRoot, "package.json"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected package manifest to be a JSON object.");
  }
  return value as Record<string, unknown>;
}

describe("@sovri/compliance package manifest scaffold", () => {
  it.each([
    { field: "name", value: "@sovri/compliance" },
    { field: "type", value: "module" },
    { field: "license", value: "Apache-2.0" },
  ])("exposes $field as $value", ({ field, value }) => {
    // Given the compliance package manifest exists
    const manifest = readPackageManifest();

    // When the manifest field "<field>" is inspected
    const actualValue = manifest[field];

    // Then the field value is exactly "<value>"
    expect(actualValue).toBe(value);
  });
});
