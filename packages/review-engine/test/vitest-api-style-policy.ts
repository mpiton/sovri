// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export type VitestApiStyleFile = {
  readonly path: string;
  readonly source: string;
};

export type VitestApiStyleEvaluation = {
  readonly messages: readonly string[];
  readonly passed: boolean;
};

export type VitestApiStyleInput = {
  readonly configSource: string;
  readonly files: readonly VitestApiStyleFile[];
};

const trackedVitestApis: readonly string[] = [
  "afterAll",
  "afterEach",
  "beforeAll",
  "beforeEach",
  "describe",
  "expect",
  "expectTypeOf",
  "it",
  "test",
  "vi",
];

export function evaluateVitestApiStyle(input: VitestApiStyleInput): VitestApiStyleEvaluation {
  const messages = input.files.flatMap((file) => evaluateFile(file));

  return {
    messages,
    passed: messages.length === 0,
  };
}

function evaluateFile(file: VitestApiStyleFile): readonly string[] {
  const calledApis = trackedVitestApis.filter((api) => callsVitestApi(file.source, api));
  const importedApis = extractVitestImports(file.source);
  const missingApis = calledApis.filter((api) => !importedApis.has(api));

  if (missingApis.length === 0) {
    return [];
  }

  if (importedApis.size === 0) {
    return [`${file.path}: test files must import Vitest APIs explicitly`];
  }

  const label = missingApis.length === 1 ? "missing Vitest import" : "missing Vitest imports";
  return [`${file.path}: ${label}: ${missingApis.join(", ")}`];
}

function callsVitestApi(source: string, api: string): boolean {
  const pattern = new RegExp(`(^|[^\\w$.])${api}(?:\\s*\\(|\\s*\\.)`, "u");
  return pattern.test(source);
}

function extractVitestImports(source: string): ReadonlySet<string> {
  const imports = new Set<string>();
  const matches = source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']vitest["']/gu);
  for (const match of matches) {
    const importList = match[1] ?? "";
    for (const name of importList.split(",")) {
      const importParts = name.trim().split(/\s+as\s+/u);
      const importedName = importParts[1]?.trim() ?? importParts[0]?.trim();
      if (importedName !== undefined && importedName.length > 0) {
        imports.add(importedName);
      }
    }
  }
  return imports;
}
