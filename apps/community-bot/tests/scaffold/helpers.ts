// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";

const testDirectory = dirname(fileURLToPath(import.meta.url));

export const packageRoot = resolve(testDirectory, "../..");
export const repoRoot = resolve(packageRoot, "../..");

export type CheckResult =
  | {
      readonly ok: true;
    }
  | {
      readonly message: string;
      readonly ok: false;
    };

export type RequiredDependency = {
  readonly expected: string;
  readonly name: string;
};

export type RequiredPermission = {
  readonly access: string;
  readonly name: string;
};

export const requiredDependencies: readonly RequiredDependency[] = [
  { expected: "^14", name: "probot" },
  { expected: "workspace:*", name: "@sovri/review-engine" },
  { expected: "workspace:*", name: "@sovri/config" },
  { expected: "workspace:*", name: "@sovri/observability" },
];

export const requiredEvents: readonly string[] = ["pull_request", "issue_comment"];

export const requiredPermissions: readonly RequiredPermission[] = [
  { access: "write", name: "pull_requests" },
  { access: "read", name: "contents" },
  { access: "write", name: "issues" },
  { access: "read", name: "metadata" },
];

export const requiredSourceFiles: readonly string[] = [
  "apps/community-bot/src/app.ts",
  "apps/community-bot/src/server.ts",
  "apps/community-bot/src/handlers/index.ts",
  "apps/community-bot/src/github/index.ts",
  "apps/community-bot/src/commands/index.ts",
];

export async function expectPathExists(relativePath: string): Promise<void> {
  await access(resolve(repoRoot, relativePath));
}

export function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

export function readJsonObject(relativePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readRepoFile(relativePath));
  if (!isRecord(parsed)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  return parsed;
}

export function readYamlObject(relativePath: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readRepoFile(relativePath));
  if (!isRecord(parsed)) {
    throw new Error(`${relativePath} must contain a YAML object`);
  }
  return parsed;
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error("JSON content must be an object");
  }
  return parsed;
}

export function parseYamlObject(content: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(content);
  if (!isRecord(parsed)) {
    throw new Error("YAML content must be an object");
  }
  return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inspectPackageMetadata(manifest: Record<string, unknown>): CheckResult {
  if (manifest.license !== "Apache-2.0") {
    return { message: "Expected license Apache-2.0", ok: false };
  }
  if (manifest.type !== "module") {
    return { message: "Expected type: module", ok: false };
  }
  return { ok: true };
}

export function inspectPackageDependencies(manifest: Record<string, unknown>): CheckResult {
  const dependencies = manifest.dependencies;
  if (!isRecord(dependencies)) {
    return { message: "Expected dependencies", ok: false };
  }
  for (const dependency of requiredDependencies) {
    const declared = dependencies[dependency.name];
    if (typeof declared !== "string" || !dependencyRangeMatches(dependency, declared)) {
      return { message: `${dependency.name} must use ${dependency.expected}`, ok: false };
    }
  }
  return { ok: true };
}

export function inspectTsconfigInheritance(config: Record<string, unknown>): CheckResult {
  if (config.extends !== "../../tsconfig.base.json") {
    return { message: "Expected ../../tsconfig.base.json", ok: false };
  }
  if (!arrayIncludes(config.include, "src/**/*.ts")) {
    return { message: "Expected include src/**/*.ts", ok: false };
  }
  return { ok: true };
}

export function inspectManifestAccess(manifest: Record<string, unknown>): CheckResult {
  const permissions = manifest.default_permissions;
  if (!isRecord(permissions)) {
    return { message: "Expected default_permissions", ok: false };
  }
  for (const permission of requiredPermissions) {
    if (permissions[permission.name] !== permission.access) {
      return { message: `${permission.name}: ${permission.access}`, ok: false };
    }
  }
  for (const permission of Object.keys(permissions)) {
    if (!requiredPermissions.some((required) => required.name === permission)) {
      return { message: permission, ok: false };
    }
  }
  if (!arrayEquals(manifest.default_events, requiredEvents)) {
    return { message: missingEventMessage(manifest.default_events), ok: false };
  }
  return { ok: true };
}

export function assertNotIgnored(relativePath: string): void {
  try {
    execFileSync("git", ["check-ignore", "--quiet", relativePath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch (error) {
    if (hasStatus(error, 1)) {
      return;
    }
    throw error;
  }
  throw new Error(`${relativePath} is ignored by Git`);
}

function dependencyRangeMatches(dependency: RequiredDependency, declared: string): boolean {
  if (dependency.name === "probot") {
    return declared === "^14" || declared.startsWith("^14.");
  }
  return declared === dependency.expected;
}

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function arrayEquals(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((item) => value.includes(item))
  );
}

function missingEventMessage(value: unknown): string {
  if (!Array.isArray(value)) {
    return "default_events";
  }
  const missing = requiredEvents.find((event) => !value.includes(event));
  return missing ?? "default_events";
}

function hasStatus(value: unknown, status: number): boolean {
  return isRecord(value) && value.status === status;
}
