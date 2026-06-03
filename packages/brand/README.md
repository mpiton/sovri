# @sovri/brand

The typed, Zod-validated design system for Sovri — the single source of truth for colour,
spacing, type scale, and the severity/category palettes. Pure leaf package, `zod`-only
(ADR-015). The review-engine rendering and the repo brand assets both import these tokens
so the bot output and the public identity can never drift.

## Exports

- `spacing` / `SpacingScaleSchema` — nine-step pixel ramp (`s-1`..`s-9`).
- `typeScale` / `TypeScaleSchema` — fixed + fluid type steps (`clamp(...)` kept verbatim).
- `colors` (`light` + `dark`) / `ColorTokensSchema` — the colour ramp, identical key sets per theme.
- `severityPalette` / `SeverityPaletteSchema` — one `{ color, glyph }` per `Severity`.
- `categoryPalette` / `CategoryPaletteSchema` — one `{ color, glyph, label }` per `Category`.

Every exported token object is frozen and validated against its schema at module load, so a
malformed token fails fast at import. GitHub strips CSS in PR comments, so the palettes carry
literal colours and emoji glyphs rather than class names.

## License

Apache-2.0 — Copyright 2026 Sovri SAS.
