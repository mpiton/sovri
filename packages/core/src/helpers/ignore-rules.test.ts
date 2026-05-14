// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { type Finding } from "../types/Finding.js";

import { applyIgnoreRules } from "./ignore-rules.js";

const baseFinding: Finding = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  severity: "major",
  category: "bug",
  file: "src/index.ts",
  line_start: 10,
  line_end: 12,
  title: "Possible null dereference",
  body: "Variable `foo` may be `null` here.",
  source: "llm",
  confidence: 0.85,
};

function findingAt(file: string, id: string): Finding {
  return { ...baseFinding, id, file };
}

describe("applyIgnoreRules", () => {
  it("returns a fresh copy of all findings when ignores is empty", () => {
    const a = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const b = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440002");
    const input: Finding[] = [a, b];
    const result = applyIgnoreRules(input, []);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("returns an empty array when findings is empty", () => {
    expect(applyIgnoreRules([], ["**/*.ts"])).toEqual([]);
  });

  it("drops findings whose file matches an exact-path pattern", () => {
    const kept = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const dropped = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440002");
    expect(applyIgnoreRules([kept, dropped], ["src/b.ts"])).toEqual([kept]);
  });

  it("drops descendants under a globstar pattern", () => {
    const kept = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const drop1 = findingAt("node_modules/x.js", "550e8400-e29b-41d4-a716-446655440002");
    const drop2 = findingAt("node_modules/lib/y.js", "550e8400-e29b-41d4-a716-446655440003");
    expect(applyIgnoreRules([kept, drop1, drop2], ["node_modules/**"])).toEqual([kept]);
  });

  it("matches single-segment files with a top-level wildcard", () => {
    const kept = findingAt("src/sub/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const dropped = findingAt("a.ts", "550e8400-e29b-41d4-a716-446655440002");
    expect(applyIgnoreRules([kept, dropped], ["*.ts"])).toEqual([kept]);
  });

  it("uses OR semantics across multiple patterns", () => {
    const k = findingAt("src/index.ts", "550e8400-e29b-41d4-a716-446655440001");
    const d1 = findingAt("dist/bundle.js", "550e8400-e29b-41d4-a716-446655440002");
    const d2 = findingAt("coverage/lcov.info", "550e8400-e29b-41d4-a716-446655440003");
    const result = applyIgnoreRules([k, d1, d2], ["dist/**", "coverage/**"]);
    expect(result).toEqual([k]);
  });

  it("preserves the original input order of surviving findings", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("dist/x.js", "550e8400-e29b-41d4-a716-446655440002");
    const f3 = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440003");
    const f4 = findingAt("dist/y.js", "550e8400-e29b-41d4-a716-446655440004");
    expect(applyIgnoreRules([f1, f2, f3, f4], ["dist/**"])).toEqual([f1, f3]);
  });

  it("does not drop findings when no pattern matches", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440002");
    expect(applyIgnoreRules([f1, f2], ["docs/**", "*.md"])).toEqual([f1, f2]);
  });

  it("drops every finding when the pattern is `**`", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("dist/x.js", "550e8400-e29b-41d4-a716-446655440002");
    expect(applyIgnoreRules([f1, f2], ["**"])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("dist/x.js", "550e8400-e29b-41d4-a716-446655440002");
    const input: Finding[] = [f1, f2];
    const before = [...input];
    applyIgnoreRules(input, ["dist/**"]);
    expect(input).toEqual(before);
  });

  it("does not mutate the patterns array", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const patterns: string[] = ["dist/**", "node_modules/**"];
    const before = [...patterns];
    applyIgnoreRules([f1], patterns);
    expect(patterns).toEqual(before);
  });

  it("produces identical output for repeated calls (determinism)", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("dist/x.js", "550e8400-e29b-41d4-a716-446655440002");
    const first = applyIgnoreRules([f1, f2], ["dist/**"]);
    const second = applyIgnoreRules([f1, f2], ["dist/**"]);
    expect(first).toEqual(second);
  });

  it("returns a fresh array on each call (no shared reference)", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    expect(applyIgnoreRules([f1], [])).not.toBe(applyIgnoreRules([f1], []));
  });

  it("treats an empty pattern string as a non-match (Node default)", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    expect(applyIgnoreRules([f1], [""])).toEqual([f1]);
  });

  it("treats glob metacharacters in the file path as literal characters", () => {
    const meta = findingAt("src/file[0].ts", "550e8400-e29b-41d4-a716-446655440001");
    // Path is literal — a glob with `*` still matches because only the
    // pattern is interpreted, never the path.
    expect(applyIgnoreRules([meta], ["src/file*.ts"])).toEqual([]);
    // An exact-text pattern misses because `[0]` is read as a character class
    // expecting the literal character `0`, not the bracket sequence.
    expect(applyIgnoreRules([meta], ["src/file[0].ts"])).toEqual([meta]);
  });

  it("does not capture leading `../` traversal segments with a bare `**` pattern", () => {
    // POSIX glob semantics: `**` does not cross the leading `../` boundary, so a
    // traversal-style path is *not* filtered out by `**` alone. Callers must
    // normalize paths upstream — this test pins the surprising behaviour.
    const traversal = findingAt("../outside/file.ts", "550e8400-e29b-41d4-a716-446655440001");
    expect(applyIgnoreRules([traversal], ["**"])).toEqual([traversal]);
    // A targeted pattern with the `../` prefix does capture it.
    expect(applyIgnoreRules([traversal], ["../**"])).toEqual([]);
  });

  it("silently treats malformed patterns as non-matching (no throw)", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    expect(() => applyIgnoreRules([f1], ["["])).not.toThrow();
    expect(() => applyIgnoreRules([f1], ["{"])).not.toThrow();
    expect(applyIgnoreRules([f1], ["["])).toEqual([f1]);
  });
});
