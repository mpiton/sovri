// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Acceptance test for the v0.6 OpenTelemetry dependency set added to @sovri/observability
// (GitHub issue #2396). One atomic dependency-add, verified by one co-located offline test:
// no network, no pnpm runtime — every assertion reads the working tree (manifest, lockfile,
// installed manifests, barrel source). Rules R-01/R-02/R-03/R-06/R-07/R-08.

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly license?: string;
}

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const fileExists = (relative: string): boolean =>
  existsSync(fileURLToPath(new URL(relative, import.meta.url)));

const readManifest = (relative: string): PackageManifest =>
  JSON.parse(read(relative)) as PackageManifest;

// R-03: ARCHI §4.6 trace baseline (7) + the two metrics packages for the later /metrics endpoint.
const TRACE_BASELINE = [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation-pino",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/resources",
  "@opentelemetry/semantic-conventions",
] as const;
const METRICS_PACKAGES = [
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/exporter-prometheus",
] as const;
const EXPECTED_OTEL: readonly string[] = [...TRACE_BASELINE, ...METRICS_PACKAGES];

// R-01: an exact pin is a concrete semver with no range operator or wildcard.
const EXACT_PIN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const FORBIDDEN_RANGE_CHARS = ["^", "~", ">", "<", "=", "|", "*", "x", " "] as const;

const manifest = readManifest("../package.json");
const rootManifest = readManifest("../../../package.json");
const dependencies = manifest.dependencies ?? {};

describe("@sovri/observability OpenTelemetry dependency set (task-124)", () => {
  // R-03 — the declared set is exactly the trace baseline plus the two metrics packages.
  it("declares the full v0.6 OTel dependency set under dependencies", () => {
    for (const name of EXPECTED_OTEL) {
      expect(dependencies, `${name} must be declared in dependencies`).toHaveProperty(name);
    }
  });

  // R-01 — every declared OTel version is an exact pin, no range operator or wildcard.
  it.each(EXPECTED_OTEL)("pins %s to an exact version", (name) => {
    const version = dependencies[name];
    expect(version, `${name} missing from dependencies`).toBeDefined();
    const value = version ?? "";
    expect(value, `${name}@${value} must be an exact semver`).toMatch(EXACT_PIN);
    for (const char of FORBIDDEN_RANGE_CHARS) {
      expect(value.includes(char), `${name}@${value} must not contain "${char}"`).toBe(false);
    }
  });

  // R-02 — placement is dependencies-only: never the package devDependencies, never the root.
  it("keeps every @opentelemetry/* out of the package devDependencies", () => {
    const devKeys = Object.keys(manifest.devDependencies ?? {});
    expect(devKeys.filter((name) => name.startsWith("@opentelemetry/"))).toEqual([]);
  });

  it("keeps every @opentelemetry/* out of the repository root manifest", () => {
    const rootDeps = Object.keys(rootManifest.dependencies ?? {});
    const rootDevDeps = Object.keys(rootManifest.devDependencies ?? {});
    expect(rootDeps.filter((name) => name.startsWith("@opentelemetry/"))).toEqual([]);
    expect(rootDevDeps.filter((name) => name.startsWith("@opentelemetry/"))).toEqual([]);
  });

  // R-06 (offline static slice) — the committed lockfile records each pin at its exact version.
  it("records each declared OTel dependency at its exact pinned version in pnpm-lock.yaml", () => {
    const lockfile = read("../../../pnpm-lock.yaml");
    for (const name of EXPECTED_OTEL) {
      const version = dependencies[name];
      expect(version, `${name} missing from dependencies`).toBeDefined();
      expect(
        lockfile.includes(`${name}@${version ?? ""}`),
        `pnpm-lock.yaml must resolve ${name}@${version ?? ""}`,
      ).toBe(true);
    }
  });

  // R-08 (offline static slice) — each declared OTel package is Apache-2.0 licensed.
  it.each(EXPECTED_OTEL)("installs %s under an Apache-2.0 license", (name) => {
    const installed = readManifest(`../node_modules/${name}/package.json`);
    expect(installed.license, `${name} must be Apache-2.0`).toBe("Apache-2.0");
  });
});

describe("@sovri/observability logger API is unchanged (R-07)", () => {
  const barrel = read("./index.ts");

  it("still re-exports createLogger from ./logger.js", () => {
    expect(barrel).toMatch(/export\s*\{\s*createLogger\s*\}\s*from\s*["']\.\/logger\.js["']/u);
  });

  it("still re-exports the Logger type from ./logger.js", () => {
    expect(barrel).toMatch(/export\s+type\s*\{\s*Logger\s*\}\s*from\s*["']\.\/logger\.js["']/u);
  });

  it("keeps logger.ts and tracing.ts state expected by the deps slice", () => {
    // task-125 adds telemetry.ts (the SDK lifecycle); tracing.ts is a later task and stays absent.
    expect(fileExists("./telemetry.ts"), "telemetry.ts must exist after task-125").toBe(true);
    expect(fileExists("./tracing.ts"), "tracing.ts must not exist yet").toBe(false);
    expect(fileExists("./logger.ts"), "logger.ts must still exist").toBe(true);
  });

  it('leaves the exports map as a single "." entry', () => {
    const exportsMap = manifest.exports;
    expect(exportsMap).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    });
  });
});
