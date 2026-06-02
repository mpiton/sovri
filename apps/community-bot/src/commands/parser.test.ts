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

  it("recognizes the lowercase re-review command", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot re-review";
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

  it("uses a later valid mention after an unsupported mention command", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot Re-Review
@sovri-bot re-review`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the later valid command is used
    expect(command).toEqual({ kind: "re-review" });
  });

  it("recognizes the lowercase dismiss command with one finding id", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot dismiss finding-abc-123";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `dismiss`
    // And the parsed finding id is "finding-abc-123"
    expect(command).toEqual({ kind: "dismiss", findingId: "finding-abc-123" });
  });

  it.each([
    "finding-abc-123",
    "550e8400-e29b-41d4-a716-446655440000",
    "ABC-123-def",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ])("recognizes resolve command with valid finding id %s", async (findingId) => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot resolve ${findingId}`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `resolve`
    // And the parsed finding id is "<finding_id>"
    expect(command).toEqual({ kind: "resolve", findingId });
  });

  it.each([
    "abc-123-def",
    "550e8400-e29b-41d4-a716-446655440000",
    "ABC-123-def",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ])("accepts alphanumeric dash finding id %s", async (findingId) => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot dismiss ${findingId}`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `dismiss`
    // And the parsed finding id is "<finding_id>"
    expect(command).toEqual({ kind: "dismiss", findingId });
  });

  it.each([
    "abc_123",
    "abc.123",
    "abc/123",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ])("returns unknown for malformed finding id %s", async (findingId) => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot dismiss ${findingId}`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is "dismiss <finding_id>"
    expect(command).toEqual({ kind: "unknown", raw: `dismiss ${findingId}` });
  });

  it("returns unknown for dismiss without a finding id", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot dismiss";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is "dismiss"
    expect(command).toEqual({ kind: "unknown", raw: "dismiss" });
  });

  it("returns unknown for resolve without a finding id", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot resolve";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is "resolve"
    expect(command).toEqual({ kind: "unknown", raw: "resolve" });
  });

  it.each(["finding_abc", "finding.abc", "finding/abc"])(
    "returns unknown for resolve with invalid finding id characters %s",
    async (findingId) => {
      const { parseCommand } = await import("./parser.js");

      // Given a GitHub issue comment body:
      const body = `@sovri-bot resolve ${findingId}`;
      // When the command body is parsed
      const command = parseCommand(body);
      // Then the parsed command is `unknown`
      // And the raw command remainder is "resolve <finding_id>"
      expect(command).toEqual({ kind: "unknown", raw: `resolve ${findingId}` });
    },
  );

  it("returns unknown for resolve with a finding id longer than 64 characters", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const findingId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const body = `@sovri-bot resolve ${findingId}`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is "resolve aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(command).toEqual({ kind: "unknown", raw: `resolve ${findingId}` });
  });

  it("recognizes supported commands after repeated mention whitespace", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given GitHub issue comment bodies with repeated mention whitespace:
    const reReviewBody = "@sovri-bot   re-review";
    const dismissBody = "@sovri-bot\tdismiss finding-abc-123";
    const resolveBody = "@sovri-bot   resolve finding-abc-123";
    // When the command bodies are parsed
    const reReviewCommand = parseCommand(reReviewBody);
    const dismissCommand = parseCommand(dismissBody);
    const resolveCommand = parseCommand(resolveBody);
    // Then the supported commands are still recognized
    expect(reReviewCommand).toEqual({ kind: "re-review" });
    expect(dismissCommand).toEqual({
      kind: "dismiss",
      findingId: "finding-abc-123",
    });
    expect(resolveCommand).toEqual({
      kind: "resolve",
      findingId: "finding-abc-123",
    });
  });

  it("returns unknown for an unsupported command word with raw remainder", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot explain this finding";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is preserved
    expect(command).toEqual({
      kind: "unknown",
      raw: "explain this finding",
    });
  });

  it("returns unknown for a mention without a command", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is empty
    expect(command).toEqual({ kind: "unknown", raw: "" });
  });

  it("keeps punctuation in an unknown raw command remainder", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot help, please!";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is "help, please!"
    expect(command).toEqual({ kind: "unknown", raw: "help, please!" });
  });

  it("excludes trailing whitespace from an unknown raw command remainder", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot explain    ";
    // And the command line has four trailing spaces after "explain"
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `unknown`
    // And the raw command remainder is "explain"
    expect(command).toEqual({ kind: "unknown", raw: "explain" });
  });

  it.each(["RE-REVIEW", "DISMISS abc-123-def", "RESOLVE abc-123-def"])(
    "returns unknown for non-exact command verb %s",
    async (commandLine) => {
      const { parseCommand } = await import("./parser.js");

      // Given a GitHub issue comment body:
      const body = `@sovri-bot ${commandLine}`;
      // When the command body is parsed
      const command = parseCommand(body);
      // Then the parsed command is `unknown`
      // And the raw command remainder is preserved
      expect(command).toEqual({ kind: "unknown", raw: commandLine });
    },
  );

  it.each(["re-review now", "dismiss abc-123-def duplicate", "resolve finding-abc-123 done"])(
    "returns unknown for supported command with extra tokens %s",
    async (commandLine) => {
      const { parseCommand } = await import("./parser.js");

      // Given a GitHub issue comment body:
      const body = `@sovri-bot ${commandLine}`;
      // When the command body is parsed
      const command = parseCommand(body);
      // Then the parsed command is `unknown`
      // And the raw command remainder is preserved
      expect(command).toEqual({ kind: "unknown", raw: commandLine });
    },
  );

  it("returns no-mention for an ordinary comment without a bot mention", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "Please take another look after I update the tests.";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `no-mention`
    expect(command).toEqual({ kind: "no-mention" });
  });

  it("detects a case-insensitive mention before a lowercase resolve command", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `Please resolve this handled finding.
@SOVRI-BOT resolve finding-case-001`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `resolve`
    // And the parsed finding id is "finding-case-001"
    expect(command).toEqual({ kind: "resolve", findingId: "finding-case-001" });
  });

  it("ignores an inline mention in prose", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "Could @sovri-bot re-review this after CI is green?";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `no-mention`
    expect(command).toEqual({ kind: "no-mention" });
  });

  it("ignores an inline resolve mention in prose", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "Could @sovri-bot resolve finding-case-001 after CI passes?";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `no-mention`
    expect(command).toEqual({ kind: "no-mention" });
  });

  it("returns no-mention for an empty comment body", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given an empty GitHub issue comment body:
    const body = "";
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `no-mention`
    expect(command).toEqual({ kind: "no-mention" });
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

  it("ignores a quoted resolve mention in favor of a later command line", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `> @sovri-bot resolve old-finding
@sovri-bot resolve finding-case-002`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `resolve`
    // And the parsed finding id is "finding-case-002"
    expect(command).toEqual({ kind: "resolve", findingId: "finding-case-002" });
  });

  it.each([
    ["resolve", "resolve"],
    ["dismiss", "dismiss"],
  ])(
    "keeps %s and dismiss as distinct command kinds for the same finding id",
    async (commandWord, kind) => {
      const { parseCommand } = await import("./parser.js");

      // Given a GitHub issue comment body:
      const body = `@sovri-bot ${commandWord} finding-same-001`;
      // When the command body is parsed
      const command = parseCommand(body);
      // Then the parsed command is `<kind>`
      // And the parsed finding id is "finding-same-001"
      expect(command).toEqual({ kind, findingId: "finding-same-001" });
    },
  );

  it("uses the first valid resolve line before a later dismiss line", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot resolve finding-first-001
@sovri-bot dismiss finding-second-001`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `resolve`
    // And the parsed finding id is "finding-first-001"
    expect(command).toEqual({ kind: "resolve", findingId: "finding-first-001" });
  });

  it("uses the first valid dismiss line before a later resolve line", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot dismiss finding-first-002
@sovri-bot resolve finding-second-002`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `dismiss`
    // And the parsed finding id is "finding-first-002"
    expect(command).toEqual({ kind: "dismiss", findingId: "finding-first-002" });
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

  it("parses a standalone resolve body string without GitHub event context", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = "@sovri-bot resolve standalone-789";
    // When the command body is parsed without a GitHub event object
    const command = parseCommand(body);
    // Then the parsed command is `resolve`
    // And the parsed finding id is "standalone-789"
    expect(command).toEqual({ kind: "resolve", findingId: "standalone-789" });
  });

  it("uses a later valid resolve mention after a malformed resolve command with a slash id", async () => {
    const { parseCommand } = await import("./parser.js");

    // Given a GitHub issue comment body:
    const body = `@sovri-bot resolve finding/invalid
@sovri-bot resolve valid-finding-001`;
    // When the command body is parsed
    const command = parseCommand(body);
    // Then the parsed command is `resolve`
    // And the parsed finding id is "valid-finding-001"
    expect(command).toEqual({ kind: "resolve", findingId: "valid-finding-001" });
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
