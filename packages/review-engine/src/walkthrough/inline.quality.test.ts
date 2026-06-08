// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const INLINE_SOURCE_URL = new URL("./inline.ts", import.meta.url);
const BADGE_IMPORT_PATTERN = /import\s+\{(?<imports>[^}]+)\}\s+from "\.\/badge\.js";/u;

describe("inline renderer quality contract (R-08)", () => {
  it("imports shared helpers through explicit ESM paths without direct brand access", () => {
    // Given the source file "packages/review-engine/src/walkthrough/inline.ts"
    const source = readInlineSource();

    // When the inline renderer imports badge helpers
    const badgeImports = extractBadgeImports(source);

    // Then all refreshed inline helpers come from "./badge.js"
    expect(badgeImports).toContain("severityBadge");
    expect(badgeImports).toContain("categoryBadge");
    expect(badgeImports).toContain("renderAuditReference");
    // And the renderer does not import the brand package directly
    expect(source).not.toContain("@sovri/brand");
  });

  it("keeps package headers and strict TypeScript conventions", () => {
    // Given the source file "packages/review-engine/src/walkthrough/inline.ts"
    const source = readInlineSource();
    const lines = source.split(/\r?\n/u);

    // Then the package headers remain intact
    expect(lines[0]).toBe("// SPDX-License-Identifier: Apache-2.0");
    expect(lines[1]).toBe("// Copyright 2026 Sovri SAS");
    // And the renderer source contains no TypeScript escape hatches
    // Strip single-line comments before checking so prose in comments does not false-positive
    const codeOnly = stripSingleLineComments(source);
    expect(codeOnly).not.toMatch(/\bany\b/u);
    expect(codeOnly).not.toMatch(/\sas\s/u);
    expect(source).not.toContain("@ts-ignore");
    expect(source).not.toContain("@ts-expect-error");
    expect(source).not.toContain("oxlint-disable");
  });

  it("keeps validation boundaries without adding I/O, env reads, or logging", () => {
    // Given the source file "packages/review-engine/src/walkthrough/inline.ts"
    const source = readInlineSource();

    // Then external finding and diff inputs still pass through Zod parse boundaries
    expect(source).toContain("z.array(InlineFindingSchema).parse(findings)");
    expect(source).toContain("DiffSchema.parse(diff)");
    // And the renderer source remains pure and free of side-effect surfaces
    expectInlineSourceToAvoidIoAndEnvironment(source);
  });
});

function readInlineSource(): string {
  return readFileSync(INLINE_SOURCE_URL, "utf8");
}

/** Remove `//` single-line comments so prose inside them doesn't trip TS keyword checks. */
function stripSingleLineComments(source: string): string {
  return source
    .split(/\r?\n/u)
    .map((line) => line.replace(/\/\/.*$/u, ""))
    .join("\n");
}

function extractBadgeImports(source: string): string {
  const match = BADGE_IMPORT_PATTERN.exec(source);
  return match?.groups?.imports ?? "";
}

function expectInlineSourceToAvoidIoAndEnvironment(source: string): void {
  const forbiddenPatterns = [
    ["file system access", /\b(?:readFileSync|readFile|writeFile|createReadStream)\b/u],
    ["file system imports", /from\s+"(?:node:fs|fs)"/u],
    ["network access", /\b(?:fetch|XMLHttpRequest|WebSocket|Octokit)\b/u],
    ["network imports", /from\s+"(?:node:http|node:https|http|https)"/u],
    ["environment reads", /\bprocess\.env\b|import\.meta\.env/u],
    ["logger access", /\b(?:console\.|createLogger|logger\.)\b/u],
  ] satisfies ReadonlyArray<readonly [string, RegExp]>;

  for (const [label, pattern] of forbiddenPatterns) {
    expect(source, `inline.ts should not use ${label}`).not.toMatch(pattern);
  }
}
