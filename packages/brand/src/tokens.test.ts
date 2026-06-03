// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CategorySchema, SeveritySchema } from "@sovri/core";
import {
  CategoryPaletteSchema,
  ColorTokensSchema,
  SeverityPaletteSchema,
  SpacingScaleSchema,
  TypeScaleSchema,
  categoryPalette,
  colors,
  severityPalette,
  spacing,
  typeScale,
} from "./index.js";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const SOURCE_FILES = ["./tokens.ts", "./index.ts"] as const;

// ── R-01 — spacing scale ──────────────────────────────────────────────────
describe("R-01 spacing scale", () => {
  it("holds the nine canonical pixel steps in order", () => {
    expect(spacing).toEqual({
      "s-1": 4,
      "s-2": 8,
      "s-3": 12,
      "s-4": 16,
      "s-5": 24,
      "s-6": 32,
      "s-7": 48,
      "s-8": 64,
      "s-9": 96,
    });
  });

  it("exposes exactly the nine keys", () => {
    expect(Object.keys(spacing).toSorted()).toEqual(
      ["s-1", "s-2", "s-3", "s-4", "s-5", "s-6", "s-7", "s-8", "s-9"].toSorted(),
    );
  });

  it("rejects a missing key", () => {
    const candidate: Record<string, number> = { ...spacing };
    delete candidate["s-9"];
    expect(() => SpacingScaleSchema.parse(candidate)).toThrow();
  });

  it("rejects a non-positive value", () => {
    expect(() => SpacingScaleSchema.parse({ ...spacing, "s-1": 0 })).toThrow();
  });
});

// ── R-02 — type scale ─────────────────────────────────────────────────────
describe("R-02 type scale", () => {
  it("exposes exactly the nine keys", () => {
    expect(Object.keys(typeScale).toSorted()).toEqual(
      ["t-xs", "t-sm", "t-base", "t-md", "t-lg", "t-xl", "t-2xl", "t-3xl", "t-display"].toSorted(),
    );
  });

  it("keeps the fluid steps verbatim as clamp strings", () => {
    expect(typeScale["t-2xl"]).toBe("clamp(22px, 2.3vw, 30px)");
    expect(typeScale["t-3xl"]).toBe("clamp(28px, 3.4vw, 44px)");
    expect(typeScale["t-display"]).toBe("clamp(96px, 19vw, 260px)");
  });

  it("keeps the fixed steps as pixel strings", () => {
    expect(typeScale["t-xs"]).toBe("12px");
    expect(typeScale["t-base"]).toBe("16px");
    expect(typeScale["t-xl"]).toBe("32px");
  });

  it("rejects a missing fluid key", () => {
    const candidate: Record<string, string> = { ...typeScale };
    delete candidate["t-display"];
    expect(() => TypeScaleSchema.parse(candidate)).toThrow();
  });
});

// ── R-03 — light/dark key parity ──────────────────────────────────────────
describe("R-03 colour key parity", () => {
  it("light and dark share an identical key set", () => {
    expect(Object.keys(colors.light).toSorted()).toEqual(Object.keys(colors.dark).toSorted());
  });

  it("carries the documented colour keys", () => {
    for (const key of [
      "ink",
      "ink-soft",
      "ink-muted",
      "ink-faint",
      "rule",
      "rule-soft",
      "accent",
      "accent-bright",
      "accent-soft",
      "gold",
      "gold-soft",
      "eu-star",
    ]) {
      expect(Object.keys(colors.light)).toContain(key);
    }
  });

  it("detects a dark ramp that drops a key", () => {
    const badDark: Record<string, string> = { ...colors.dark };
    delete badDark["eu-star"];
    expect(Object.keys(colors.light).toSorted()).not.toEqual(Object.keys(badDark).toSorted());
  });
});

// ── R-04 — colour values valid ────────────────────────────────────────────
describe("R-04 colour values", () => {
  it("both ramps parse against the schema", () => {
    expect(() => ColorTokensSchema.parse(colors.light)).not.toThrow();
    expect(() => ColorTokensSchema.parse(colors.dark)).not.toThrow();
  });

  it("every value is a non-empty string", () => {
    for (const ramp of [colors.light, colors.dark]) {
      for (const value of Object.values(ramp)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects an empty colour value", () => {
    expect(() => ColorTokensSchema.parse({ ...colors.light, accent: "" })).toThrow();
  });
});

// ── R-05 — severity palette ───────────────────────────────────────────────
describe("R-05 severity palette", () => {
  it("keys equal the core Severity enum", () => {
    expect(Object.keys(severityPalette).toSorted()).toEqual([...SeveritySchema.options].toSorted());
  });

  it("each entry has a non-empty colour and glyph", () => {
    for (const entry of Object.values(severityPalette)) {
      expect(entry.color.length).toBeGreaterThan(0);
      expect(entry.glyph.length).toBeGreaterThan(0);
    }
  });

  it("rejects an extra severity key", () => {
    expect(() =>
      SeverityPaletteSchema.parse({
        ...severityPalette,
        critical: { color: "#000000", glyph: "x" },
      }),
    ).toThrow();
  });
});

// ── R-06 — category palette ───────────────────────────────────────────────
describe("R-06 category palette", () => {
  it("keys equal the core Category enum", () => {
    expect(Object.keys(categoryPalette).toSorted()).toEqual([...CategorySchema.options].toSorted());
  });

  it("each entry has a non-empty label and colour", () => {
    for (const entry of Object.values(categoryPalette)) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.color.length).toBeGreaterThan(0);
    }
  });

  it("rejects a candidate missing a category key", () => {
    const candidate: Record<string, { color: string; label: string }> = { ...categoryPalette };
    delete candidate["test-coverage"];
    expect(() => CategoryPaletteSchema.parse(candidate)).toThrow();
  });
});

// ── R-07 — frozen exports ─────────────────────────────────────────────────
describe("R-07 frozen token objects", () => {
  it("every exported token object is frozen", () => {
    expect(Object.isFrozen(spacing)).toBe(true);
    expect(Object.isFrozen(typeScale)).toBe(true);
    expect(Object.isFrozen(colors)).toBe(true);
    expect(Object.isFrozen(colors.light)).toBe(true);
    expect(Object.isFrozen(colors.dark)).toBe(true);
    expect(Object.isFrozen(severityPalette)).toBe(true);
    expect(Object.isFrozen(categoryPalette)).toBe(true);
  });

  it("a write to a frozen token is rejected and leaves the value intact", () => {
    expect(Reflect.set(spacing, "s-1", 999)).toBe(false);
    expect(spacing["s-1"]).toBe(4);
    expect(Reflect.deleteProperty(spacing, "s-1")).toBe(false);
  });

  it("freezes nested palette and colour entries (deep, not shallow)", () => {
    expect(Object.isFrozen(severityPalette.blocker)).toBe(true);
    expect(Object.isFrozen(categoryPalette.bug)).toBe(true);
    expect(Object.isFrozen(colors.light)).toBe(true);
    expect(Reflect.set(severityPalette.blocker, "color", "#000000")).toBe(false);
    expect(severityPalette.blocker.color).toBe("#d1242f");
    expect(Reflect.set(categoryPalette.bug, "label", "Mutated")).toBe(false);
    expect(categoryPalette.bug.label).toBe("Bug");
  });
});

// ── R-08 — leaf purity ────────────────────────────────────────────────────
describe("R-08 leaf purity", () => {
  it("package.json declares zod as the sole runtime dependency, pinned exactly", () => {
    const pkg = JSON.parse(read("../package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(["zod"]);
    expect(pkg.dependencies["zod"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no non-test source imports a workspace package", () => {
    for (const file of SOURCE_FILES) {
      const src = read(file);
      const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
      for (const spec of specifiers) {
        if (spec.startsWith(".")) {
          expect(spec).toMatch(/\.js$/);
        } else {
          expect(spec).toBe("zod");
        }
      }
    }
  });
});

// ── R-09 — schema round-trip ──────────────────────────────────────────────
describe("R-09 schema round-trip", () => {
  it("each token set deep-equals its parsed value", () => {
    expect(SpacingScaleSchema.parse(spacing)).toEqual(spacing);
    expect(TypeScaleSchema.parse(typeScale)).toEqual(typeScale);
    expect(ColorTokensSchema.parse(colors.light)).toEqual(colors.light);
    expect(ColorTokensSchema.parse(colors.dark)).toEqual(colors.dark);
    expect(SeverityPaletteSchema.parse(severityPalette)).toEqual(severityPalette);
    expect(CategoryPaletteSchema.parse(categoryPalette)).toEqual(categoryPalette);
  });
});

// ── R-10 — code-quality contract ──────────────────────────────────────────
describe("R-10 code-quality contract", () => {
  it("every source file carries the Apache header", () => {
    for (const file of SOURCE_FILES) {
      const lines = read(file).split("\n");
      expect(lines[0]).toBe("// SPDX-License-Identifier: Apache-2.0");
      expect(lines[1]).toBe("// Copyright 2026 Sovri SAS");
    }
  });

  it("derives types from Zod and uses no hand-written interface", () => {
    const tokensSrc = read("./tokens.ts");
    expect(tokensSrc).toMatch(/z\.infer<typeof/);
    expect(tokensSrc).not.toMatch(/\binterface\b/);
  });

  it("contains no any, escape hatch, or logging in source", () => {
    for (const file of SOURCE_FILES) {
      const src = read(file);
      expect(src).not.toMatch(/@ts-(ignore|expect-error)/);
      expect(src).not.toMatch(/\bany\b/);
      expect(src).not.toMatch(/console\./);
    }
  });
});
