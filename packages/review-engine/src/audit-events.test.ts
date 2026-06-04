// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { computePromptSha256 } from "./audit-events.js";

describe("computePromptSha256", () => {
  it("uses an unambiguous prompt-pair hash input", () => {
    // Given two prompt pairs that collapse to the same raw newline-joined text
    const firstDigest = computePromptSha256("system", "user\nprompt");
    const secondDigest = computePromptSha256("system\nuser", "prompt");

    // Then provenance digests distinguish the actual prompt pair boundaries
    expect(firstDigest).not.toBe(secondDigest);
  });

  it("returns a stable SHA-256 hex digest", () => {
    const digest = computePromptSha256("system prompt", "user prompt");

    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(computePromptSha256("system prompt", "user prompt")).toBe(digest);
  });
});
