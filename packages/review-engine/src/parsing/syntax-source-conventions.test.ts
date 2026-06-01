// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseLLMResponse } from "./parser.js";
import { inspectParsingSourceConventions } from "./syntax-source-conventions.js";

const CurrentDirectory = dirname(fileURLToPath(import.meta.url));
const WorkspaceRoot = join(CurrentDirectory, "../../../..");
const SourceHeader = "// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sovri SAS\n\n";
const ChangedParsingSourceFiles: readonly string[] = [
  "packages/review-engine/src/parsing/parser.ts",
  "packages/review-engine/src/parsing/syntax-characters.ts",
  "packages/review-engine/src/parsing/syntax-regex-flags.ts",
  "packages/review-engine/src/parsing/syntax-sanity.ts",
  "packages/review-engine/src/parsing/syntax-scanner.ts",
  "packages/review-engine/src/parsing/syntax-source-conventions.ts",
  "packages/review-engine/src/parsing/syntax-token-rules.ts",
];
const ForbiddenIoViolations: readonly string[] = [
  "forbidden-node:fs",
  "forbidden-node:net",
  "forbidden-node:http",
  "forbidden-node:https",
  "forbidden-process-env",
  "forbidden-eval",
];
const ConventionViolations: readonly string[] = [
  "missing-spdx",
  "relative-import-without-js",
  "forbidden-any",
  "forbidden-ts-ignore",
  "forbidden-ts-expect-error",
  "forbidden-oxlint-directive",
];
const ForbiddenSyntheticSources: ReadonlyArray<{ readonly sourceText: string }> = [
  { sourceText: "import fs from 'node:fs';" },
  { sourceText: "import {\n  readFileSync\n} from 'node:fs';" },
  { sourceText: "const fs = await import('node:fs');" },
  { sourceText: 'import "./setup";' },
  { sourceText: "const value: any = code;" },
  { sourceText: "// @ts-ignore" },
  { sourceText: "// oxlint-disable no-console" },
  { sourceText: "eval(code)" },
];

describe("review-engine parsing source conventions", () => {
  it("keeps the changed parsing helper sources pure and local", () => {
    // Given the implementation changes are in packages/review-engine/src/parsing
    const inspectedSources = inspectChangedParsingSources();

    // When the changed parsing source files are inspected
    for (const inspectedSource of inspectedSources) {
      const violationMessage = formatViolations(inspectedSource);

      // Then they import no "node:fs"
      // And they import no "node:net"
      // And they import no "node:http"
      // And they import no "node:https"
      // And they read no "process.env"
      for (const violation of ForbiddenIoViolations) {
        expect(inspectedSource.violations, violationMessage).not.toContain(violation);
      }

      // And they perform no file, network, or environment I/O
      expect(inspectedSource.ok, violationMessage).toBe(true);
    }
  });

  it("preserves TypeScript and ESM conventions in changed parsing sources", () => {
    // Given the implementation changes are in packages/review-engine/src/parsing
    const inspectedSources = inspectChangedParsingSources();

    // When the changed parsing source files are inspected
    for (const inspectedSource of inspectedSources) {
      const violationMessage = formatViolations(inspectedSource);

      // Then every new source file has the Apache-2.0 SPDX header
      // And every internal relative import ends with ".js"
      // And no new code uses "any"
      // And no new code uses "@ts-ignore"
      // And no new code uses "@ts-expect-error"
      // And no new code uses "oxlint-disable"
      for (const violation of ConventionViolations) {
        expect(inspectedSource.violations, violationMessage).not.toContain(violation);
      }

      expect(inspectedSource.ok, violationMessage).toBe(true);
    }
  });

  it.each(ForbiddenSyntheticSources)(
    "fails the convention check for forbidden source text $sourceText",
    ({ sourceText }) => {
      // Given a synthetic changed parsing source contains <source_text>
      const source = withSourceHeader(sourceText);

      // When the static convention check inspects the source text
      const result = inspectParsingSourceConventions(source);

      // Then the convention check fails
      expect(result.ok).toBe(false);
      expect(result.violations).not.toEqual([]);
    },
  );

  it("preserves the existing parser suggestion contract", () => {
    // Given a raw finding has suggested_code "return user.name ?? \"Anonymous\";"
    const input: unknown = {
      summary: "One finding found",
      findings: [
        {
          severity: "major",
          category: "bug",
          file: "src/users.ts",
          line_start: 12,
          line_end: 12,
          title: "Preserve fallback user name",
          body: "The user name fallback should stay explicit.",
          suggested_code: 'return user.name ?? "Anonymous";',
          confidence: 0.94,
        },
      ],
    };

    // When the raw finding is converted to a public Finding
    const [finding] = parseLLMResponse(input);
    const suggestion = finding?.suggestion;
    if (suggestion === undefined) {
      expect.fail("Expected parsed finding to include a suggestion");
    }

    // Then suggestion.code still equals "return user.name ?? \"Anonymous\";"
    expect(suggestion.code).toBe('return user.name ?? "Anonymous";');

    // And suggestion.committable is a boolean
    expect(typeof suggestion.committable).toBe("boolean");

    // And no extra field is added to suggestion
    expect(Object.keys(suggestion).toSorted()).toEqual(["code", "committable"]);
  });
});

type InspectedSource = ReturnType<typeof inspectParsingSourceConventions> & {
  readonly path: string;
};

function inspectChangedParsingSources(): InspectedSource[] {
  return ChangedParsingSourceFiles.map((path) => {
    const inspection = inspectParsingSourceConventions(readWorkspaceFile(path));
    return {
      path,
      ok: inspection.ok,
      violations: inspection.violations,
    };
  });
}

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(WorkspaceRoot, relativePath), "utf8");
}

function withSourceHeader(sourceText: string): string {
  return `${SourceHeader}${sourceText}\n`;
}

function formatViolations(inspectedSource: InspectedSource): string {
  return `${inspectedSource.path}: ${inspectedSource.violations.join(", ")}`;
}
