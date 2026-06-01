// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { isSyntacticallySane } from "./syntax-sanity.js";

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
      String.raw`const pattern = /a\/[bc]+/g;`,
      "return /ready/.test(input);",
      "/^ready$/.test(input);",
      "const next = [...items, ...[fallback], ...(enabled ? items : [])];",
      "const object = { ...source };",
      "const total = 0x2A + 1_000.5;",
      "const ratio = 1e-3;",
      "const value = input /* explain */ + fallback;",
      "call(first, second); // trailing )",
      "return values[index++];",
      "return fn(i--);",
      "const result = value as Result;",
      "const less = count < /ready/.test(input);",
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
      "const label = `ready;",
      "return normalize(value...",
      "const value = \u2026;",
      "const value = input /* explain",
      "return /ready",
      "return /[abc/;",
      "const copy = ...items;",
      "const copy = [...];",
      "call(first +);",
      "call(first];",
      "return total +",
      "return total <",
      "const pair = first,",
      "throw",
      "await",
      "typeof",
      "foo bar",
      "const count = 1abc;",
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
});
