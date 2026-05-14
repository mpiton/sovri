// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, expectTypeOf, it } from "vitest";

import * as observability from "./index.js";
import type { Logger } from "./index.js";
import type { Logger as PinoLogger } from "pino";

describe("@sovri/observability barrel", () => {
  it("exposes createLogger as a function", () => {
    expect(typeof observability.createLogger).toBe("function");
  });

  it("createLogger returns a Pino-shaped logger", () => {
    const log = observability.createLogger("test");
    expect(typeof log.info).toBe("function");
    expect(typeof log.child).toBe("function");
    expect(log.bindings()).toMatchObject({ component: "test" });
  });

  it("Logger type matches Pino Logger", () => {
    expectTypeOf<Logger>().toEqualTypeOf<PinoLogger>();
  });
});
