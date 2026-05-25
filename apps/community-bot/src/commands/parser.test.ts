// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

  it("returns the same parsed command for repeated parsing of the same input", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot dismiss finding-456";
    // When the command body is parsed repeatedly
    const firstCommand = parseCommand(body);
    const secondCommand = parseCommand(body);
    // Then the parsed command is the same each time
    expect(secondCommand).toEqual(firstCommand);
  });

  it("parses a standalone body string without GitHub event context", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot dismiss finding-789";
    // When the command body is parsed without a GitHub event object
    const command = parseCommand(body);
    // Then the parsed command is `dismiss`
    // And the parsed finding id is "finding-789"
    expect(command).toEqual({ kind: "dismiss", findingId: "finding-789" });
  });

  it("does not read process environment or filesystem state", () => {
    // Given the command parser source:
    const parserPath = fileURLToPath(new URL("./parser.ts", import.meta.url));
    const parserSource = readFileSync(parserPath, "utf8");
    const filesystemImportPattern =
      /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["'](?:node:)?fs(?:\/promises)?["']/u;
    // When parser dependencies are inspected
    // Then the parser does not read process environment
    expect(parserSource).not.toContain("process.env");
    // And the parser does not import filesystem modules
    expect(parserSource).not.toMatch(filesystemImportPattern);
  });
});
