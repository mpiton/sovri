// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, expectTypeOf, it } from "vitest";

import type { Logger as PinoLogger } from "pino";

import * as observability from "./index.js";
import type { Logger } from "./index.js";

describe("@sovri/observability", () => {
  it("barrel module resolves at runtime", () => {
    expect(observability).toBeTypeOf("object");
    expect(observability).not.toBeNull();
  });

  it("re-exports Pino's Logger type unchanged", () => {
    expectTypeOf<Logger>().toEqualTypeOf<PinoLogger>();
  });
});
