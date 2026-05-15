// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, expectTypeOf, it } from "vitest";

import type { Severity as CoreSeverity } from "@sovri/core";
import type { Logger as ObservabilityLogger } from "@sovri/observability";

import {
  SovriConfigSchema as SovriConfigSchemaFromTypes,
  type SovriConfig as SovriConfigFromTypes,
} from "./types/SovriConfig.js";

import {
  DEFAULT_CONFIG as DefaultConfigFromLoader,
  loadConfig as loadConfigFromLoader,
} from "./loader.js";
import {
  SovriConfigParseError as ParseErrorFromErrors,
  SovriConfigValidationError as ValidationErrorFromErrors,
} from "./errors.js";

import {
  DEFAULT_CONFIG,
  loadConfig,
  SovriConfigParseError,
  SovriConfigSchema,
  SovriConfigValidationError,
  type Logger,
  type Severity,
  type SovriConfig,
} from "./index.js";

describe("@sovri/config barrel", () => {
  it("re-exports the same SovriConfigSchema symbol as ./types/SovriConfig.js", () => {
    expect(SovriConfigSchema).toBe(SovriConfigSchemaFromTypes);
  });

  it("re-exports the SovriConfig type unchanged", () => {
    expectTypeOf<SovriConfig>().toEqualTypeOf<SovriConfigFromTypes>();
  });

  it("Severity re-export matches @sovri/core", () => {
    expectTypeOf<Severity>().toEqualTypeOf<CoreSeverity>();
  });

  it("Logger re-export matches @sovri/observability", () => {
    expectTypeOf<Logger>().toEqualTypeOf<ObservabilityLogger>();
  });

  it("re-exports loadConfig and DEFAULT_CONFIG from ./loader.js", () => {
    expect(loadConfig).toBe(loadConfigFromLoader);
    expect(DEFAULT_CONFIG).toBe(DefaultConfigFromLoader);
  });

  it("re-exports SovriConfigParseError and SovriConfigValidationError from ./errors.js", () => {
    expect(SovriConfigParseError).toBe(ParseErrorFromErrors);
    expect(SovriConfigValidationError).toBe(ValidationErrorFromErrors);
  });
});
