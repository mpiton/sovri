// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "zod";

// Recursively freeze an object and every nested object so a consumer cannot mutate a
// nested token entry (e.g. `severityPalette.blocker.color = "x"`). `Object.freeze` alone
// is shallow, which would leave the palette entries writable. The cast narrows the generic
// to an indexable record purely to iterate its values; nothing escapes the function.
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
  }
  return Object.freeze(value);
};

// ── Spacing scale ─────────────────────────────────────────────────────────
// Ported verbatim from mockup `:root` (--s-1..--s-9 = 4/8/12/16/24/32/48/64/96).
export const SpacingScaleSchema = z.strictObject({
  "s-1": z.number().int().positive(),
  "s-2": z.number().int().positive(),
  "s-3": z.number().int().positive(),
  "s-4": z.number().int().positive(),
  "s-5": z.number().int().positive(),
  "s-6": z.number().int().positive(),
  "s-7": z.number().int().positive(),
  "s-8": z.number().int().positive(),
  "s-9": z.number().int().positive(),
});
export type SpacingScale = z.infer<typeof SpacingScaleSchema>;

// ── Type scale ────────────────────────────────────────────────────────────
// Fixed steps as pixel strings; the fluid steps keep their clamp() expression verbatim.
export const TypeScaleSchema = z.strictObject({
  "t-xs": z.string().min(1),
  "t-sm": z.string().min(1),
  "t-base": z.string().min(1),
  "t-md": z.string().min(1),
  "t-lg": z.string().min(1),
  "t-xl": z.string().min(1),
  "t-2xl": z.string().min(1),
  "t-3xl": z.string().min(1),
  "t-display": z.string().min(1),
});
export type TypeScale = z.infer<typeof TypeScaleSchema>;

// ── Colour ramp ───────────────────────────────────────────────────────────
// Light and dark share one key set; values are hex or rgba() strings.
export const ColorTokensSchema = z.strictObject({
  ink: z.string().min(1),
  "ink-soft": z.string().min(1),
  "ink-muted": z.string().min(1),
  "ink-faint": z.string().min(1),
  rule: z.string().min(1),
  "rule-soft": z.string().min(1),
  accent: z.string().min(1),
  "accent-bright": z.string().min(1),
  "accent-soft": z.string().min(1),
  gold: z.string().min(1),
  "gold-soft": z.string().min(1),
  "eu-star": z.string().min(1),
});
export type ColorTokens = z.infer<typeof ColorTokensSchema>;

// ── Severity / category palettes ──────────────────────────────────────────
// GitHub strips CSS in PR comments, so each entry carries a literal colour and an
// emoji glyph rather than a class name. The key sets stay exhaustive against the
// core `Severity` / `Category` enums (verified in the colocated test, which may
// import core; this source must not — leaf purity).
const SeverityEntrySchema = z.strictObject({
  color: z.string().min(1),
  glyph: z.string().min(1),
});
export const SeverityPaletteSchema = z.strictObject({
  blocker: SeverityEntrySchema,
  major: SeverityEntrySchema,
  minor: SeverityEntrySchema,
  info: SeverityEntrySchema,
  nitpick: SeverityEntrySchema,
});
export type SeverityPalette = z.infer<typeof SeverityPaletteSchema>;

const CategoryEntrySchema = z.strictObject({
  color: z.string().min(1),
  glyph: z.string().min(1),
  label: z.string().min(1),
});
export const CategoryPaletteSchema = z.strictObject({
  bug: CategoryEntrySchema,
  security: CategoryEntrySchema,
});
export type CategoryPalette = z.infer<typeof CategoryPaletteSchema>;

// ── Frozen token values ───────────────────────────────────────────────────
export const spacing: SpacingScale = deepFreeze({
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

export const typeScale: TypeScale = deepFreeze({
  "t-xs": "12px",
  "t-sm": "14px",
  "t-base": "16px",
  "t-md": "20px",
  "t-lg": "24px",
  "t-xl": "32px",
  "t-2xl": "clamp(22px, 2.3vw, 30px)",
  "t-3xl": "clamp(28px, 3.4vw, 44px)",
  "t-display": "clamp(96px, 19vw, 260px)",
});

const light: ColorTokens = {
  ink: "#111827",
  "ink-soft": "#374151",
  "ink-muted": "#6b7280",
  "ink-faint": "#9ca3af",
  rule: "rgba(17, 24, 39, 0.12)",
  "rule-soft": "rgba(17, 24, 39, 0.06)",
  accent: "#1e3a8a",
  "accent-bright": "#3b82f6",
  "accent-soft": "rgba(30, 58, 138, 0.08)",
  gold: "#8b6f2a",
  "gold-soft": "rgba(139, 111, 42, 0.18)",
  "eu-star": "#b89a5e",
};

const dark: ColorTokens = {
  ink: "#f3f4f6",
  "ink-soft": "#d1d5db",
  "ink-muted": "#9ca3af",
  "ink-faint": "#6b7280",
  rule: "rgba(243, 244, 246, 0.16)",
  "rule-soft": "rgba(243, 244, 246, 0.08)",
  accent: "#93b4ff",
  "accent-bright": "#93b4ff",
  "accent-soft": "rgba(147, 180, 255, 0.12)",
  gold: "#d8b87a",
  "gold-soft": "rgba(216, 184, 122, 0.22)",
  "eu-star": "#d8b87a",
};

export const colors = deepFreeze({ light, dark });

export const severityPalette: SeverityPalette = deepFreeze({
  blocker: { color: "#d1242f", glyph: "⛔" },
  major: { color: "#9a6700", glyph: "🔴" },
  minor: { color: "#0969da", glyph: "🟡" },
  info: { color: "#1a7f37", glyph: "ℹ️" },
  nitpick: { color: "#59636e", glyph: "💬" },
});

export const categoryPalette: CategoryPalette = deepFreeze({
  bug: { color: "#d1242f", glyph: "🐛", label: "Bug" },
  security: { color: "#9a6700", glyph: "🔒", label: "Security" },
});

// Validate every frozen export once, at module load, so a malformed token fails fast
// at import rather than lazily at first use.
SpacingScaleSchema.parse(spacing);
TypeScaleSchema.parse(typeScale);
ColorTokensSchema.parse(colors.light);
ColorTokensSchema.parse(colors.dark);
SeverityPaletteSchema.parse(severityPalette);
CategoryPaletteSchema.parse(categoryPalette);
