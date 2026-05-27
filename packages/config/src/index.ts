// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Barrel for @sovri/config. v0.1 ships `SovriConfigSchema` (the `.sovri.yml`
// shape), the inferred `SovriConfig` type, and `loadConfig` to read+validate
// the file from disk. Org-override merge (`mergeWithOrgOverride`) lands in a
// follow-up task.

export type { Severity } from "@sovri/core";
export type { Logger } from "@sovri/observability";

export {
  ProviderSchema,
  ReviewModeSchema,
  SeverityThresholdSchema,
  SovriConfigSchema,
  type Provider,
  type ReviewMode,
  type SeverityThreshold,
  type SovriConfig,
} from "./types/SovriConfig.js";

export { DEFAULT_CONFIG, loadConfig, parseConfigContent } from "./loader.js";
export {
  SovriConfigParseError,
  SovriConfigSymlinkError,
  SovriConfigValidationError,
} from "./errors.js";
