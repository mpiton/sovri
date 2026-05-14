// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { z } from "./index.js";

describe("@sovri/core", () => {
  it("exposes a functional zod instance", () => {
    expect(typeof z).toBe("object");
    expect(typeof z.string).toBe("function");
  });
});
