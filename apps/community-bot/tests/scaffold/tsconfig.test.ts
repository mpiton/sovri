// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  expectPathExists,
  inspectTsconfigInheritance,
  parseJsonObject,
  readJsonObject,
} from "./helpers.js";

describe("community bot TypeScript config scaffold", () => {
  it("extends the root base config", async () => {
    // Given "apps/community-bot/tsconfig.json" exists
    await expectPathExists("apps/community-bot/tsconfig.json");
    const config = readJsonObject("apps/community-bot/tsconfig.json");
    // And the TypeScript config extends "../../tsconfig.base.json"
    expect(config.extends).toBe("../../tsconfig.base.json");
    // And the TypeScript config includes "src/**/*.ts"
    // When the TypeScript config is inspected
    const result = inspectTsconfigInheritance(config);
    // Then the config inheritance check succeeds
    expect(result).toEqual({ ok: true });
  });

  it.each(["", "./tsconfig.base.json", "../tsconfig.json"])(
    "rejects wrong extends value %s",
    (extendsValue) => {
      // Given "apps/community-bot/tsconfig.json" exists
      const config = { extends: extendsValue, include: ["src/**/*.ts"] };
      // And the TypeScript config extends "<extends>"
      // When the TypeScript config is inspected
      const result = inspectTsconfigInheritance(config);
      // Then the config inheritance check fails
      expect(result.ok).toBe(false);
      // And the failure mentions "../../tsconfig.base.json"
      expect(result).toMatchObject({
        message: expect.stringContaining("../../tsconfig.base.json"),
      });
    },
  );

  it("rejects invalid JSON before config inheritance validation", () => {
    // Given "apps/community-bot/tsconfig.json" contains "{ \"extends\": \"../../tsconfig.base.json\", }"
    // When the TypeScript config is loaded
    // Then TypeScript config loading fails
    expect(() => parseJsonObject('{ "extends": "../../tsconfig.base.json", }')).toThrow();
    // And the config inheritance check is not attempted
  });
});
