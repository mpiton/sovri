// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isSyntacticallySane } from "./syntax-sanity.js";

const ParsingLayerDirectory = dirname(fileURLToPath(import.meta.url));
const ForbiddenRuntimeEvaluationCallPatterns: readonly RegExp[] = [
  /(?<![$0-9A-Z_a-z])eval\(/u,
  /(?<![$0-9A-Z_a-z])Function\(/u,
  /(?<![$0-9A-Z_a-z])import\(/u,
];

describe("isSyntacticallySane", () => {
  it("validates balanced snippets and rejects uncertain syntax conservatively", () => {
    // Given the syntactic sanity helper is invoked directly from the parsing layer
    const saneCodes = [
      "return calculateTotal(items);",
      "const tuple = [first, { second: true }];",
      'const label = "ready";',
      "const label = `ready`;",
      "const label = 'ready';",
      String.raw`const label = "ready \"now\"";`,
      "const label = `total ${format(count)}`;",
      "const view = html`<div>${name}</div>`;",
      String.raw`const pattern = /a\/[bc]+/g;`,
      "return /ready/.test(input);",
      "/^ready$/.test(input);",
      "const next = [...items, ...[fallback], ...(enabled ? items : [])];",
      "const next = [first,];",
      "const sparse = [, first, , third,];",
      "const emptySlots = [,,];",
      "const object = { ...source };",
      "const object = { value: 1, };",
      "call(first,);",
      "const total = 0x2A + 1_000.5;",
      "const ratio = 1e-3;",
      "const value = input /* explain */ + fallback;",
      "call(first, second); // trailing )",
      "const first = 1; // trailing )\nconst second = call();",
      "return values[index++];",
      "return fn(i--);",
      "return normalize(value!);",
      "return object.class;",
      "return object?.class;",
      "return;",
      "yield;",
      "const result = value as Result;",
      "const next = value as const;",
      "const less = count < /ready/.test(input);",
      "return <div>{name}</div>;",
      "return <Button disabled={loading}>Save</Button>;",
      "return <Button label={`ready`}>Save</Button>;",
      "return <span>Hello world</span>;",
      "return <span>Hello {name}</span>;",
      "return <>{name}</>;",
      "std::mem::drop(value);",
      "return items[1:]",
      "return items[:]",
      "try { cleanup(); } finally { report(); }",
      "do { cleanup(); } while (active);",
      'const loaded = import("./module.js", { assert: { type: "json" } });',
      "const fallback = enabled ? value : backup;",
    ];

    for (const code of saneCodes) {
      // Given the candidate suggestion code is <code>
      // When the syntactic sanity helper validates the code
      const result = isSyntacticallySane(code);

      // Then the result is true
      expect(result, code).toBe(true);
    }

    const uncertainCodes = [
      "return calculateTotal(items;",
      "return calculateTotal(items));",
      "const tuple = [first, second);",
      'const object = { name: "Ada";',
      'const label = "ready;',
      'const label = prefix"suffix";',
      "const label = `ready;",
      "return value'tail';",
      "return normalize(value...",
      "const value = \u2026;",
      "const value = input /* explain",
      "return /ready",
      "return /[abc/;",
      "const copy = ...items;",
      "const copy = [...];",
      "call(first +);",
      "call(,);",
      "call(first,,second);",
      "return items[,]",
      "const object = {,};",
      "call(first];",
      "return total +",
      "return total +;",
      "return total <",
      "return total >;",
      "const fn = () =>;",
      "const next = enabled ? fallback",
      "const next = enabled ? { value: fallback }",
      "const next = enabled ? : fallback;",
      "return <Button disabled={loading +}>Save</Button>;",
      "return <Button disabled={}>Save</Button>;",
      "return <Button label=>Save</Button>;",
      "return <Button label=`ready`>Save</Button>;",
      "return items[condition ? value :]",
      "const values = [first:];",
      "const invalid = { value: 1 } trailing<end>;",
      "const pair = first,",
      "if (enabled) else",
      "const",
      "value as;",
      "as const;",
      "throw",
      "throw;",
      "try",
      "try { cleanup(); } finally",
      "default",
      "await",
      "typeof",
      "foo bar",
      "const count = 1abc;",
      "const invalid = /ready/é;",
      "const first = 1; // trailing )\nconst second = call(",
    ];

    for (const code of uncertainCodes) {
      // Given the candidate suggestion code is <code>
      // When the syntactic sanity helper validates the code
      const result = isSyntacticallySane(code);

      // Then the result is false
      expect(result, code).toBe(false);
    }

    // Given the candidate suggestion code is "const message = \"Total (estimated\";"
    const balancedMessage = 'const message = "Total (estimated";';

    // When the syntactic sanity helper validates the code
    const balancedResult = isSyntacticallySane(balancedMessage);

    // Then the result is true
    expect(balancedResult).toBe(true);

    // When the candidate suggestion code is "const message = \"Total (estimated\";"
    // And the final semicolon is replaced by ")"
    const uncertainMessage = 'const message = "Total (estimated")';
    const uncertainResult = isSyntacticallySane(uncertainMessage);

    // Then the syntactic sanity helper result is false
    expect(uncertainResult).toBe(false);
  });

  it("validates snippets with a pure language-agnostic character scan", () => {
    const saneLanguageSnippets = [
      "const total = amount ?? 0;",
      'result = {"ok": True}',
      "let total = items.len();",
      "if err != nil { return err }",
    ];

    for (const code of saneLanguageSnippets) {
      // Given the candidate suggestion code is <code>
      // When the syntactic sanity helper validates the code
      const result = isSyntacticallySane(code);

      // Then the result is true
      expect(result, code).toBe(true);
    }

    const malformedLanguageSnippets = [
      'result = {"ok": True',
      "let total = items.len(;",
      "if err != nil { return err",
    ];

    for (const code of malformedLanguageSnippets) {
      // Given the candidate suggestion code is <code>
      // When the syntactic sanity helper validates the code
      const result = isSyntacticallySane(code);

      // Then the result is false
      expect(result, code).toBe(false);
    }

    // Given the candidate suggestion code is "throw new Error(\"should not run\");"
    const executableLookingSnippet = 'throw new Error("should not run");';
    let result: boolean | undefined;

    // When the syntactic sanity helper validates the code
    const validate = () => {
      result = isSyntacticallySane(executableLookingSnippet);
    };

    // Then the helper call does not throw "should not run"
    expect(validate).not.toThrow("should not run");

    // And the result is true
    expect(result).toBe(true);

    const parsingLayerSource = readParsingLayerSource();

    // And the parsing layer source contains no "eval("
    // And the parsing layer source contains no "Function("
    // And the parsing layer source contains no "import("
    for (const forbiddenCallPattern of ForbiddenRuntimeEvaluationCallPatterns) {
      expect(parsingLayerSource).not.toMatch(forbiddenCallPattern);
    }
  });
});

function readParsingLayerSource(): string {
  return readdirSync(ParsingLayerDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith(".ts"))
    .filter((entry) => !entry.name.includes(".test"))
    .map((entry) => readFileSync(join(ParsingLayerDirectory, entry.name), "utf8"))
    .join("\n");
}
