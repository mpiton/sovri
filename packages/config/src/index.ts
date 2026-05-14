// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Scaffold barrel for @sovri/config — the `.sovri.yml` parser and validator
// surface (`SovriConfigSchema`, `loadConfig`, `mergeWithOrgOverride`) lands
// in follow-up tasks. v0.1 ships only the package shape so the workspace
// graph and downstream type wiring are already in place.

import { z } from "@sovri/core";

// Re-export the workspace `Severity` and `Logger` types so consumers can
// already wire `@sovri/config` imports against the same shared types they
// will use once the loader exists. Pure type-level re-exports — no runtime
// surface from `@sovri/core` or `@sovri/observability` is published here.
export type { Severity } from "@sovri/core";
export type { Logger } from "@sovri/observability";

/**
 * Placeholder schema. The full `.sovri.yml` shape (`llm` / `review` /
 * `ignores` / `sarif` / `limits`) lands in a follow-up task. Until then this
 * schema accepts any object and preserves unknown keys via `passthrough`,
 * so callers can round-trip a parsed YAML document without committing to
 * a moving type.
 *
 * **Stability:** placeholder. The inferred type is intentionally not
 * re-exported as a named alias — typing against `{}` would silently break
 * the moment the real schema lands with a discriminated shape. Consumers
 * should call `SovriConfigSchema.parse(...)` and refine downstream.
 */
export const SovriConfigSchema = z.object({}).passthrough();
