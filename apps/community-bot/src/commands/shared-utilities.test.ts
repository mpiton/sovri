// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { readBotLogin } from "./shared-utilities.js";

describe("readBotLogin", () => {
  it("returns the default GitHub App login when SOVRI_BOT_LOGIN is absent", () => {
    expect(readBotLogin({})).toBe("sovri-bot[bot]");
  });

  it("returns the trimmed configured GitHub App login", () => {
    expect(readBotLogin({ SOVRI_BOT_LOGIN: "  sovri-reviewer[bot]  " })).toBe(
      "sovri-reviewer[bot]",
    );
  });

  it("falls back to the default GitHub App login when SOVRI_BOT_LOGIN is blank", () => {
    expect(readBotLogin({ SOVRI_BOT_LOGIN: "   " })).toBe("sovri-bot[bot]");
  });
});
