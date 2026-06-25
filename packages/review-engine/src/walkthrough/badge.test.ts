// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// RED acceptance test for specs/task-117-severity-category-badges/badge-vocabulary.feature
// Rules R-00..R-05. Resolved design (interview 2026-06-03):
//   severityBadge(s) = severityPalette[s].glyph                       (emoji glyph alone)
//   categoryBadge(c) = categoryPalette[c].glyph + " " + ...[c].label  (emoji + space + label)
// Glyphs/labels come only from @sovri/brand, never hard-coded in badge.ts.

import { CategoryPaletteSchema, categoryPalette, severityPalette } from "@sovri/brand";
import { CategorySchema, SeveritySchema } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { categoryBadge, severityBadge } from "./badge.js";

describe("severityBadge", () => {
  // Scenario Outline: severityBadge returns the brand glyph alone for every severity
  it.each([
    ["blocker", "⛔"],
    ["major", "🔴"],
    ["minor", "🟡"],
    ["info", "ℹ️"],
    ["nitpick", "💬"],
  ] as const)("returns the brand glyph alone for %s", (severity, glyph) => {
    // When I call severityBadge with "<severity>"
    const badge = severityBadge(severity);
    // Then it returns exactly "<glyph>"
    expect(badge).toBe(glyph);
    // And the result equals severityPalette["<severity>"].glyph
    expect(badge).toBe(severityPalette[severity].glyph);
    // And the result carries no text label beyond the glyph
    expect(badge).not.toMatch(/[A-Za-z]/);
  });

  // Scenario: severityBadge is total over the core Severity enum
  it("is total over SeveritySchema.options, mapping every value", () => {
    // Given the 5 values of SeveritySchema.options from @sovri/core
    expect(SeveritySchema.options).toHaveLength(5);
    for (const severity of SeveritySchema.options) {
      // When I call severityBadge with each value / Then every call returns a non-empty string
      expect(severityBadge(severity).length).toBeGreaterThan(0);
    }
  });
});

describe("categoryBadge", () => {
  // Scenario Outline: categoryBadge returns "glyph + space + label" for every category
  it.each([
    ["bug", "🐛 Bug"],
    ["security", "🔒 Security"],
  ] as const)("returns glyph + space + label for %s", (category, expected) => {
    // When I call categoryBadge with "<category>"
    const badge = categoryBadge(category);
    // Then it returns exactly "<badge>"
    expect(badge).toBe(expected);
    // And the result equals categoryPalette["<category>"].glyph + " " + ...label
    expect(badge).toBe(`${categoryPalette[category].glyph} ${categoryPalette[category].label}`);
  });

  // Scenario: categoryBadge is total over the core Category enum
  it("is total over CategorySchema.options, mapping every value", () => {
    // Given the 2 values of CategorySchema.options from @sovri/core (compliance pivot, ADR-021)
    expect(CategorySchema.options).toHaveLength(2);
    for (const category of CategorySchema.options) {
      // When I call categoryBadge with each value / Then every call returns a non-empty string
      expect(categoryBadge(category).length).toBeGreaterThan(0);
    }
  });
});

describe("brand category glyph extension (R-00)", () => {
  // Scenario: every categoryPalette entry carries a non-empty glyph emoji
  it("exposes a non-empty glyph and label for each of the 2 categories", () => {
    for (const category of CategorySchema.options) {
      const entry = categoryPalette[category];
      expect(entry.glyph.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  // Scenario: the brand CategoryEntrySchema rejects an entry missing its glyph
  it("rejects a category entry that has no glyph", () => {
    // Given a candidate category entry { color, label } with no glyph
    const brokenPalette = { ...categoryPalette, bug: { color: "#d1242f", label: "Bug" } };
    // When CategoryPaletteSchema parses it / Then parsing fails because "glyph" is required
    expect(CategoryPaletteSchema.safeParse(brokenPalette).success).toBe(false);
  });
});

describe("badge purity and GitHub-safe output", () => {
  // Scenario: both badge helpers are pure and deterministic
  it("returns byte-identical output on repeated calls (R-04)", () => {
    expect(severityBadge("major")).toBe(severityBadge("major"));
    expect(categoryBadge("security")).toBe(categoryBadge("security"));
  });

  // Scenario: no badge output contains CSS, a class attribute, or a style attribute
  it("emits no class=, style=, or CSS — only emoji and plain text (R-05)", () => {
    const badges = [
      ...SeveritySchema.options.map((severity) => severityBadge(severity)),
      ...CategorySchema.options.map((category) => categoryBadge(category)),
    ];
    for (const badge of badges) {
      expect(badge).not.toContain("class=");
      expect(badge).not.toContain("style=");
      expect(badge).not.toContain("{");
      expect(badge).not.toContain("</");
    }
  });
});
