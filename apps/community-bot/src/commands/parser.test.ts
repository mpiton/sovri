// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

describe("parseCommand", () => {
  it("detects a case-insensitive mention at column one on a later line", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `Please re-run this after the latest push.
@SOVRI-BOT re-review`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `re-review`
    expect(command).toEqual({ kind: "re-review" });
  });

  it("uses the first valid mention when multiple command lines are present", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot dismiss finding-123
@sovri-bot re-review`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `dismiss`
    // And the parsed finding id is "finding-123"
    expect(command).toEqual({ kind: "dismiss", findingId: "finding-123" });
  });

  it("ignores a mention after leading whitespace", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "  @sovri-bot re-review";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `no-mention`
    expect(command).toEqual({ kind: "no-mention" });
  });

  it("ignores a mention in a quoted reply line", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "> @sovri-bot re-review";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `no-mention`
    expect(command).toEqual({ kind: "no-mention" });
  });
});
