// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Barrel for @sovri/config. v0.1 ships `SovriConfigSchema` (the `.sovri.yml`
// shape) and the inferred `SovriConfig` type. The loader (`loadConfig`) and
// org-override merge (`mergeWithOrgOverride`) land in follow-up tasks.

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
