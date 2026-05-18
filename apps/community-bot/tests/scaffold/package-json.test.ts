// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  expectPathExists,
  inspectPackageDependencies,
  inspectPackageMetadata,
  isRecord,
  parseJsonObject,
  readJsonObject,
  requiredDependencies,
} from "./helpers.js";

describe("community bot package manifest scaffold", () => {
  it("declares Apache-2.0 ESM package metadata", async () => {
    // Given "apps/community-bot/package.json" exists
    await expectPathExists("apps/community-bot/package.json");
    const manifest = readJsonObject("apps/community-bot/package.json");
    // And the package name is "@sovri/community-bot"
    expect(manifest.name).toBe("@sovri/community-bot");
    // And the package license is "Apache-2.0"
    // And the package type is "module"
    // When the package manifest is inspected
    const result = inspectPackageMetadata(manifest);
    // Then the package is eligible for Community distribution
    expect(result).toEqual({ ok: true });
  });

  it("declares the required runtime dependencies", async () => {
    // Given "apps/community-bot/package.json" exists
    await expectPathExists("apps/community-bot/package.json");
    const manifest = readJsonObject("apps/community-bot/package.json");
    // And dependency "probot" is declared with range "^14"
    // And dependency "@sovri/review-engine" is declared with range "workspace:*"
    // And dependency "@sovri/config" is declared with range "workspace:*"
    // And dependency "@sovri/observability" is declared with range "workspace:*"
    // When the package dependencies are inspected
    const result = inspectPackageDependencies(manifest);
    // Then the dependency check succeeds
    expect(result).toEqual({ ok: true });
  });

  it.each([
    { failure: "Apache-2.0", license: "MIT", type: "module" },
    { failure: "Apache-2.0", license: "UNLICENSED", type: "module" },
    { failure: "type: module", license: "Apache-2.0", type: "commonjs" },
  ])("rejects invalid package metadata $license $type", ({ failure, license, type }) => {
    // Given "apps/community-bot/package.json" exists
    const manifest = createValidPackageManifest();
    // And the package name is "@sovri/community-bot"
    manifest.license = license;
    // And the package license is "<license>"
    manifest.type = type;
    // And the package type is "<type>"
    // When the package manifest is inspected
    const result = inspectPackageMetadata(manifest);
    // Then the scaffold metadata check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<failure>"
    expect(result).toMatchObject({ message: expect.stringContaining(failure) });
  });

  it.each([
    { failure: "Apache-2.0", field: "license" },
    { failure: "type: module", field: "type" },
  ])("rejects missing metadata field $field", ({ failure, field }) => {
    // Given "apps/community-bot/package.json" exists
    const manifest = createValidPackageManifest();
    // And the package manifest omits "<field>"
    delete manifest[field];
    // When the package manifest is inspected
    const result = inspectPackageMetadata(manifest);
    // Then the scaffold metadata check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<failure>"
    expect(result).toMatchObject({ message: expect.stringContaining(failure) });
  });

  it.each(requiredDependencies)("rejects missing dependency $name", ({ expected, name }) => {
    // Given "apps/community-bot/package.json" exists
    // And all required dependencies except "<dependency>" are declared with their expected ranges
    const manifest = createValidPackageManifest();
    const dependencies = manifest.dependencies;
    if (!isRecord(dependencies)) {
      throw new Error("dependencies must be mutable");
    }
    // And dependency "<dependency>" is not declared
    delete dependencies[name];
    // When the package dependencies are inspected
    const result = inspectPackageDependencies(manifest);
    // Then the dependency check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<dependency>"
    expect(result).toMatchObject({ message: expect.stringContaining(name) });
    expect(result).toMatchObject({ message: expect.stringContaining(expected) });
  });

  it.each([
    { dependency: "probot", expected: "^14", range: "^15" },
    { dependency: "@sovri/review-engine", expected: "workspace:*", range: "0.1.0" },
    { dependency: "@sovri/config", expected: "workspace:*", range: "^0.1.0" },
    { dependency: "@sovri/observability", expected: "workspace:*", range: "file:." },
  ])("rejects dependency $dependency with range $range", ({ dependency, expected, range }) => {
    // Given "apps/community-bot/package.json" exists
    // And all required dependencies except "<dependency>" are declared with their expected ranges
    const manifest = createValidPackageManifest();
    const dependencies = manifest.dependencies;
    if (!isRecord(dependencies)) {
      throw new Error("dependencies must be mutable");
    }
    // And dependency "<dependency>" is declared with range "<range>"
    dependencies[dependency] = range;
    // When the package dependencies are inspected
    const result = inspectPackageDependencies(manifest);
    // Then the dependency check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<expected>"
    expect(result).toMatchObject({ message: expect.stringContaining(expected) });
  });

  it("rejects invalid JSON before package metadata validation", () => {
    // Given "apps/community-bot/package.json" contains "{ \"name\": \"@sovri/community-bot\", }"
    // When the package manifest is loaded
    // Then package manifest loading fails
    expect(() => parseJsonObject('{ "name": "@sovri/community-bot", }')).toThrow();
    // And the scaffold metadata check is not attempted
  });
});

function createValidPackageManifest(): Record<string, unknown> {
  return {
    dependencies: Object.fromEntries(
      requiredDependencies.map((dependency) => [dependency.name, dependency.expected]),
    ),
    license: "Apache-2.0",
    name: "@sovri/community-bot",
    type: "module",
  };
}
