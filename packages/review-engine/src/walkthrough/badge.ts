// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { categoryPalette, severityPalette } from "@sovri/brand";
import type { Category, Severity } from "@sovri/core";

// GitHub-safe badge vocabulary shared by the v0.5 walkthrough / assessment / inline renderers
// (tasks 118-120). GitHub strips CSS in PR comments (ADR-016), so a badge is an emoji glyph
// (and, for categories, a label) read straight from the @sovri/brand palettes — never a CSS
// class and never a glyph hard-coded here. Pure and deterministic: no I/O of any kind.

// Severity badge = the brand glyph alone (the colour-coded scale ⛔🔴🟡ℹ️💬 is self-explanatory).
export function severityBadge(severity: Severity): string {
  return severityPalette[severity].glyph;
}

// Category badge = the brand glyph, a single space, then the brand label (e.g. "🐛 Bug").
export function categoryBadge(category: Category): string {
  const entry = categoryPalette[category];
  return `${entry.glyph} ${entry.label}`;
}
