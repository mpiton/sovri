// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { type Finding } from "../types/Finding.js";

import { compareFilePaths, groupFindingsByFile } from "./grouping.js";

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

function findingAt(file: string, id: string, line_start = 1): Finding {
  return { ...baseFinding, id, file, line_start, line_end: line_start };
}

describe("compareFilePaths", () => {
  it("returns -1 when the first argument sorts earlier", () => {
    expect(compareFilePaths("a.ts", "b.ts")).toBe(-1);
  });

  it("returns 1 when the first argument sorts later", () => {
    expect(compareFilePaths("b.ts", "a.ts")).toBe(1);
  });

  it("returns 0 when the arguments are equal", () => {
    expect(compareFilePaths("a.ts", "a.ts")).toBe(0);
  });

  it("orders by code point, not locale (uppercase before lowercase)", () => {
    expect(compareFilePaths("Z.ts", "a.ts")).toBe(-1);
  });
});

describe("groupFindingsByFile", () => {
  it("returns an empty object for an empty input", () => {
    expect(groupFindingsByFile([])).toEqual({});
  });

  it("groups a single finding into a single-key record", () => {
    const finding = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    expect(groupFindingsByFile([finding])).toEqual({ "src/a.ts": [finding] });
  });

  it("co-locates findings that share the same file in input order", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001", 10);
    const f2 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440002", 20);
    const f3 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440003", 30);
    expect(groupFindingsByFile([f1, f2, f3])).toEqual({ "src/a.ts": [f1, f2, f3] });
  });

  it("orders keys ascending and locale-independently", () => {
    const a = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const b = findingAt("src/B.ts", "550e8400-e29b-41d4-a716-446655440002");
    const c = findingAt("src/c.ts", "550e8400-e29b-41d4-a716-446655440003");
    const z = findingAt("z/last.ts", "550e8400-e29b-41d4-a716-446655440004");
    const grouped = groupFindingsByFile([c, z, a, b]);
    // Uppercase 'B' sorts before lowercase 'a' under a code-point comparison.
    expect(Object.keys(grouped)).toEqual(["src/B.ts", "src/a.ts", "src/c.ts", "z/last.ts"]);
  });

  it("preserves input order across groups", () => {
    const a1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001", 1);
    const b1 = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440002", 1);
    const a2 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440003", 2);
    const b2 = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440004", 2);
    const grouped = groupFindingsByFile([a1, b1, a2, b2]);
    expect(grouped).toEqual({
      "src/a.ts": [a1, a2],
      "src/b.ts": [b1, b2],
    });
  });

  it("does not mutate the input array", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440002");
    const input: Finding[] = [f1, f2];
    const before = [...input];
    groupFindingsByFile(input);
    expect(input).toEqual(before);
  });

  it("does not mutate individual finding objects", () => {
    const f1 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const snapshot = structuredClone(f1);
    groupFindingsByFile([f1]);
    expect(f1).toEqual(snapshot);
  });

  it("produces identical output for repeated calls (determinism)", () => {
    const f1 = findingAt("src/c.ts", "550e8400-e29b-41d4-a716-446655440001");
    const f2 = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440002");
    const f3 = findingAt("src/b.ts", "550e8400-e29b-41d4-a716-446655440003");
    const first = groupFindingsByFile([f1, f2, f3]);
    const second = groupFindingsByFile([f1, f2, f3]);
    expect(first).toEqual(second);
    expect(Object.keys(first)).toEqual(Object.keys(second));
  });

  it("preserves the total finding count across groups", () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      findingAt(
        `src/file-${i % 4}.ts`,
        `550e8400-e29b-41d4-a716-${(440000 + i).toString().padStart(12, "0")}`,
        i + 1,
      ),
    );
    const grouped = groupFindingsByFile(findings);
    const total = Object.values(grouped).reduce((acc, bucket) => acc + bucket.length, 0);
    expect(total).toBe(findings.length);
  });

  it("returns a fresh object on each call (no shared reference)", () => {
    const f = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    expect(groupFindingsByFile([f])).not.toBe(groupFindingsByFile([f]));
  });

  it("orders non-ASCII (Unicode) file paths by code point", () => {
    const ascii = findingAt("src/a.ts", "550e8400-e29b-41d4-a716-446655440001");
    const accent = findingAt("src/schéma.ts", "550e8400-e29b-41d4-a716-446655440002");
    const cjk = findingAt("src/クラス.ts", "550e8400-e29b-41d4-a716-446655440003");
    // Code-point order: ASCII letters come before Latin-1 accents which come before CJK.
    expect(Object.keys(groupFindingsByFile([cjk, accent, ascii]))).toEqual([
      "src/a.ts",
      "src/schéma.ts",
      "src/クラス.ts",
    ]);
  });

  it("treats `__proto__` as a regular own property without polluting Object.prototype", () => {
    const finding = findingAt("__proto__", "550e8400-e29b-41d4-a716-446655440001");
    const grouped = groupFindingsByFile([finding]);
    expect(Object.prototype.hasOwnProperty.call(grouped, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(grouped)).toBe(Object.prototype);
    // Confirm Object.prototype itself was not mutated.
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
  });
});
