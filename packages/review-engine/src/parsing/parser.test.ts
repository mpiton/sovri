// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, type Category, type Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { parseLLMResponse } from "./parser.js";
import { LLMRawFindingSchema, LLMResponseSchema } from "./schema.js";

const UuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NonV4Uuid = "550e8400-e29b-11d4-a716-446655440000";

type RawFindingFixture = {
  severity: Severity;
  category: Category;
  file: string;
  line_start: number;
  line_end: number;
  title: string;
  body: string;
  suggested_code: string | null;
  confidence: number;
};

function buildRawFinding(overrides: Partial<RawFindingFixture> = {}): RawFindingFixture {
  return {
    severity: "major",
    category: "bug",
    file: "src/cards.ts",
    line_start: 8,
    line_end: 8,
    title: "Reject blocked card state",
    body: "Blocked cards are still treated as active.",
    suggested_code: "return false;",
    confidence: 0.87,
    ...overrides,
  };
}

function buildPaymentFinding(overrides: Partial<RawFindingFixture> = {}): RawFindingFixture {
  return buildRawFinding({
    severity: "major",
    category: "bug",
    file: "src/payments.ts",
    line_start: 12,
    line_end: 12,
    title: "Reject expired cards",
    body: "The expired card path is accepted.",
    suggested_code: "return false;",
    confidence: 0.91,
    ...overrides,
  });
}

describe("LLMRawFindingSchema", () => {
  it("accepts valid model-provided raw finding fields", () => {
    const validRawFindings: ReadonlyArray<unknown> = [
      {
        severity: "blocker",
        category: "security",
        file: "src/auth/session.ts",
        line_start: 44,
        line_end: 44,
        title: "Reject unsigned session token",
        body: "The session token path accepts unsigned tokens.",
        suggested_code: "throw new UnauthorizedError();",
        confidence: 0.99,
        cwe: "CWE-347",
      },
      {
        severity: "major",
        category: "bug",
        file: "src/auth/session.ts",
        line_start: 1,
        line_end: 1,
        title: "Reject missing payment status",
        body: "The payment status can be omitted.",
        suggested_code: null,
        confidence: 0,
      },
      {
        severity: "minor",
        category: "maintainability",
        file: "src/auth/session.ts",
        line_start: 7,
        line_end: 7,
        title: "t".repeat(200),
        body: "b".repeat(2000),
        suggested_code: "const total = amount ?? 0;",
        confidence: 1,
      },
    ];

    for (const rawFinding of validRawFindings) {
      // Given the raw finding has severity "<severity>"
      // And the raw finding has category "<category>"
      // And the raw finding has file "src/auth/session.ts"
      // And the raw finding has line_start <line_start>
      // And the raw finding has line_end <line_end>
      // And the raw finding has title <title>
      // And the raw finding has body <body>
      // And the raw finding has suggested_code <suggested_code>
      // And the raw finding has confidence <confidence>
      // And the raw finding has cwe <cwe>
      // When the maintainer validates the raw finding
      const validation = LLMRawFindingSchema.safeParse(rawFinding);

      // Then validation succeeds
      if (!validation.success) {
        expect.fail("Expected valid raw finding validation to succeed");
      }

      // And the raw finding does not contain id
      expect(rawFinding).not.toHaveProperty("id");
      expect(validation.data).not.toHaveProperty("id");

      // And the raw finding does not contain source
      expect(rawFinding).not.toHaveProperty("source");
      expect(validation.data).not.toHaveProperty("source");
    }
  });

  it("rejects deterministic finding fields from raw LLM findings", () => {
    const deterministicFields = [
      { field: "id", value: "550e8400-e29b-41d4-a716-446655440000" },
      { field: "source", value: "llm" },
    ];

    for (const { field, value } of deterministicFields) {
      // Given the raw finding has severity "major"
      // And the raw finding has category "bug"
      // And the raw finding has file "src/auth/session.ts"
      // And the raw finding has line_start 44
      // And the raw finding has line_end 44
      // And the raw finding has title "Reject unsigned session token"
      // And the raw finding has body "The session token path accepts unsigned tokens."
      // And the raw finding has suggested_code null
      // And the raw finding has confidence 0.80
      // And the raw finding includes deterministic field "<field>" with value "<value>"
      const rawFinding = {
        severity: "major",
        category: "bug",
        file: "src/auth/session.ts",
        line_start: 44,
        line_end: 44,
        title: "Reject unsigned session token",
        body: "The session token path accepts unsigned tokens.",
        suggested_code: null,
        confidence: 0.8,
        [field]: value,
      };

      // When the maintainer validates the raw finding
      const validation = LLMRawFindingSchema.safeParse(rawFinding);

      // Then validation fails with an unknown field validation error
      if (validation.success) {
        expect.fail("Expected deterministic raw finding field validation to fail");
      }

      expect(validation.error.issues).toContainEqual(
        expect.objectContaining({
          code: "unrecognized_keys",
          keys: expect.arrayContaining([field]),
        }),
      );
    }
  });

  it("rejects invalid raw finding field values", () => {
    const invalidRawFindings: ReadonlyArray<unknown> = [
      {
        severity: "critical",
        category: "bug",
        file: "src/app.ts",
        line_start: 1,
        line_end: 1,
        title: "Invalid severity",
        body: "Valid body",
        suggested_code: null,
        confidence: 0.75,
      },
      {
        severity: "major",
        category: "typo",
        file: "src/app.ts",
        line_start: 1,
        line_end: 1,
        title: "Invalid category",
        body: "Valid body",
        suggested_code: null,
        confidence: 0.75,
      },
      {
        severity: "major",
        category: "bug",
        file: "",
        line_start: 1,
        line_end: 1,
        title: "Empty file",
        body: "Valid body",
        suggested_code: null,
        confidence: 0.75,
      },
      {
        severity: "major",
        category: "bug",
        file: "src/app.ts",
        line_start: 9,
        line_end: 7,
        title: "Reversed lines",
        body: "Valid body",
        suggested_code: null,
        confidence: 0.75,
      },
      {
        severity: "major",
        category: "bug",
        file: "src/app.ts",
        line_start: 1,
        line_end: 1,
        title: "Valid title",
        body: "Valid body",
        suggested_code: null,
        confidence: 1.01,
      },
      {
        severity: "major",
        category: "bug",
        file: "src/app.ts",
        line_start: 0,
        line_end: 1,
        title: "Zero line start",
        body: "Valid body",
        suggested_code: null,
        confidence: 0.75,
      },
      {
        severity: "major",
        category: "bug",
        file: "src/app.ts",
        line_start: 1,
        line_end: 1,
        title: "t".repeat(201),
        body: "Valid body",
        suggested_code: null,
        confidence: 0.75,
      },
      {
        severity: "major",
        category: "bug",
        file: "src/app.ts",
        line_start: 1,
        line_end: 1,
        title: "Valid title",
        body: "b".repeat(2001),
        suggested_code: null,
        confidence: 0.75,
      },
    ];

    for (const rawFinding of invalidRawFindings) {
      // Given the raw finding has severity "<severity>"
      // And the raw finding has category "<category>"
      // And the raw finding has file "<file>"
      // And the raw finding has line_start <line_start>
      // And the raw finding has line_end <line_end>
      // And the raw finding has title <title>
      // And the raw finding has body <body>
      // And the raw finding has suggested_code null
      // And the raw finding has confidence <confidence>
      // When the maintainer validates the raw finding
      const validation = LLMRawFindingSchema.safeParse(rawFinding);

      // Then validation fails with a raw finding validation error
      if (validation.success) {
        expect.fail("Expected invalid raw finding validation to fail");
      }

      expect(validation.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects invalid optional CWE values", () => {
    const invalidCwes = ["cwe-79", "CWE-"];

    for (const cwe of invalidCwes) {
      // Given the raw finding has severity "major"
      // And the raw finding has category "security"
      // And the raw finding has file "src/auth/session.ts"
      // And the raw finding has line_start 44
      // And the raw finding has line_end 44
      // And the raw finding has title "Reject unsigned session token"
      // And the raw finding has body "The session token path accepts unsigned tokens."
      // And the raw finding has suggested_code null
      // And the raw finding has confidence 0.80
      // And the raw finding has cwe "<cwe>"
      const rawFinding = {
        severity: "major",
        category: "security",
        file: "src/auth/session.ts",
        line_start: 44,
        line_end: 44,
        title: "Reject unsigned session token",
        body: "The session token path accepts unsigned tokens.",
        suggested_code: null,
        confidence: 0.8,
        cwe,
      };

      // When the maintainer validates the raw finding
      const validation = LLMRawFindingSchema.safeParse(rawFinding);

      // Then validation fails with a CWE validation error
      if (validation.success) {
        expect.fail("Expected invalid CWE validation to fail");
      }

      expect(validation.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["cwe"],
        }),
      );
    }
  });
});

describe("LLMResponseSchema", () => {
  it("accepts a strict response with a non-empty summary and one finding", () => {
    // Given the valid raw finding file is "src/review.ts"
    // And the valid raw finding line_start is 21
    // And the valid finding line_end is 21
    // And the valid finding suggested_code is "return review;"
    // Given the raw LLM response summary is "Review completed"
    // And the raw LLM response contains the valid raw finding
    const response = {
      summary: "Review completed",
      findings: [
        buildRawFinding({
          file: "src/review.ts",
          line_start: 21,
          line_end: 21,
          suggested_code: "return review;",
        }),
      ],
    };

    // When the maintainer validates the raw LLM response
    const validation = LLMResponseSchema.safeParse(response);

    // Then validation succeeds
    if (!validation.success) {
      expect.fail("Expected strict LLM response validation to succeed");
    }

    // And the response contains 1 raw finding
    expect(validation.data.findings).toHaveLength(1);
  });

  it("rejects invalid summary values", () => {
    const summaries = ["", "x".repeat(2001)];

    for (const summary of summaries) {
      // Given the valid raw finding file is "src/review.ts"
      // And the valid raw finding line_start is 21
      // And the valid finding line_end is 21
      // And the valid finding suggested_code is "return review;"
      // Given the raw LLM response summary is <summary>
      // And the raw LLM response contains the valid raw finding
      const response = {
        summary,
        findings: [
          buildRawFinding({
            file: "src/review.ts",
            line_start: 21,
            line_end: 21,
            suggested_code: "return review;",
          }),
        ],
      };

      // When the maintainer validates the raw LLM response
      const validation = LLMResponseSchema.safeParse(response);
      const parsedFindings = validation.success ? validation.data.findings : undefined;

      // Then validation fails with a summary validation error
      if (validation.success) {
        expect.fail("Expected invalid summary validation to fail");
      }

      expect(validation.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["summary"],
        }),
      );

      // And no parsed findings are returned
      expect(parsedFindings).toBeUndefined();
    }
  });

  it("rejects unknown top-level response fields", () => {
    // Given the valid raw finding file is "src/review.ts"
    // And the valid raw finding line_start is 21
    // And the valid finding line_end is 21
    // And the valid finding suggested_code is "return review;"
    // Given the raw LLM response summary is "Review completed"
    // And the raw LLM response contains the valid raw finding
    // And the raw LLM response includes unknown field "model_notes" with value "approve"
    const response = {
      summary: "Review completed",
      findings: [
        buildRawFinding({
          file: "src/review.ts",
          line_start: 21,
          line_end: 21,
          suggested_code: "return review;",
        }),
      ],
      model_notes: "approve",
    };

    // When the maintainer validates the raw LLM response
    const validation = LLMResponseSchema.safeParse(response);
    const parsedFindings = validation.success ? validation.data.findings : undefined;

    // Then validation fails with an unknown field validation error
    if (validation.success) {
      expect.fail("Expected unknown top-level field validation to fail");
    }

    expect(validation.error.issues).toContainEqual(
      expect.objectContaining({
        code: "unrecognized_keys",
        keys: expect.arrayContaining(["model_notes"]),
      }),
    );

    // And no parsed findings are returned
    expect(parsedFindings).toBeUndefined();
  });

  it("rejects missing required top-level fields", () => {
    const responses: ReadonlyArray<{ field: string; response: unknown }> = [
      {
        field: "summary",
        response: {
          findings: [
            buildRawFinding({
              file: "src/review.ts",
              line_start: 21,
              line_end: 21,
              suggested_code: "return review;",
            }),
          ],
        },
      },
      {
        field: "findings",
        response: {
          summary: "Review completed",
        },
      },
    ];

    for (const { field, response } of responses) {
      // Given the raw LLM response is missing required field "<field>"
      // When the maintainer validates the raw LLM response
      const validation = LLMResponseSchema.safeParse(response);
      const parsedFindings = validation.success ? validation.data.findings : undefined;

      // Then validation fails with a required field validation error
      if (validation.success) {
        expect.fail("Expected missing required top-level field validation to fail");
      }

      expect(validation.error.issues).toContainEqual(
        expect.objectContaining({
          path: [field],
        }),
      );

      // And no parsed findings are returned
      expect(parsedFindings).toBeUndefined();
    }
  });

  it("accepts a response summary with exactly 2000 characters", () => {
    const summary = "x".repeat(2000);

    // Given the valid raw finding file is "src/review.ts"
    // And the valid raw finding line_start is 21
    // And the valid finding line_end is 21
    // And the valid finding suggested_code is "return review;"
    // Given the raw LLM response summary is 2000 x characters long
    // And the raw LLM response contains the valid raw finding
    const response = {
      summary,
      findings: [
        buildRawFinding({
          file: "src/review.ts",
          line_start: 21,
          line_end: 21,
          suggested_code: "return review;",
        }),
      ],
    };

    // When the maintainer validates the raw LLM response
    const validation = LLMResponseSchema.safeParse(response);

    // Then validation succeeds
    if (!validation.success) {
      expect.fail("Expected 2000-character summary validation to succeed");
    }

    // And the summary length is 2000 JavaScript string characters
    expect(validation.data.summary).toHaveLength(2000);
  });
});

describe("parseLLMResponse", () => {
  it("parses a raw JSON string into findings", () => {
    // Given the raw LLM response summary is "One finding found"
    // And the raw finding has severity "major"
    // And the raw finding has category "bug"
    // And the raw finding has file "src/orders.ts"
    // And the raw finding has line_start 18
    // And the raw finding has line_end 18
    // And the raw finding has title "Reject cancelled orders"
    // And the raw finding has body "Cancelled orders still reach the fulfillment queue."
    // And the raw finding has suggested_code "return;"
    // And the raw finding has confidence 0.92
    // Given the LLM response input is the raw JSON string for the response
    const input = JSON.stringify({
      summary: "One finding found",
      findings: [
        buildRawFinding({
          file: "src/orders.ts",
          line_start: 18,
          line_end: 18,
          title: "Reject cancelled orders",
          body: "Cancelled orders still reach the fulfillment queue.",
          suggested_code: "return;",
          confidence: 0.92,
        }),
      ],
    });

    // When the maintainer calls `parseLLMResponse`
    const findings = parseLLMResponse(input);

    const [finding] = findings;

    // Then parsing succeeds
    expect(findings).toHaveLength(1);

    // And the returned value is a `Finding[]`
    expect(Array.isArray(findings)).toBe(true);

    // And the returned finding has source "llm"
    expect(finding?.source).toBe("llm");

    // And the returned finding has a UUID v4 id
    expect(finding?.id).toMatch(UuidV4Pattern);

    // And the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("parses an already-parsed unknown object into findings", () => {
    // Given the raw LLM response summary is "One finding found"
    // And the raw finding has severity "major"
    // And the raw finding has category "bug"
    // And the raw finding has file "src/orders.ts"
    // And the raw finding has line_start 18
    // And the raw finding has line_end 18
    // And the raw finding has title "Reject cancelled orders"
    // And the raw finding has body "Cancelled orders still reach the fulfillment queue."
    // And the raw finding has suggested_code "return;"
    // And the raw finding has confidence 0.92
    // Given the LLM response input is the already-parsed object for the response
    const input: unknown = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          file: "src/orders.ts",
          line_start: 18,
          line_end: 18,
          title: "Reject cancelled orders",
          body: "Cancelled orders still reach the fulfillment queue.",
          suggested_code: "return;",
          confidence: 0.92,
        }),
      ],
    };

    // When the maintainer calls `parseLLMResponse`
    const findings = parseLLMResponse(input);

    const [finding] = findings;

    // Then parsing succeeds
    expect(findings).toHaveLength(1);

    // And the returned value is a `Finding[]`
    expect(Array.isArray(findings)).toBe(true);

    // And the returned finding has source "llm"
    expect(finding?.source).toBe("llm");

    // And the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("rejects a malformed JSON string with a typed parse error", () => {
    // Given the LLM response input is:
    // """
    // {"summary":"Broken response","findings":[
    // """
    const input = '{"summary":"Broken response","findings":[';

    let parsedFindings: ReturnType<typeof parseLLMResponse> | undefined;
    let thrownError: unknown;

    // When the maintainer calls `parseLLMResponse`
    try {
      parsedFindings = parseLLMResponse(input);
    } catch (error) {
      thrownError = error;
    }

    // Then parsing fails with a typed LLM response parse error
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
    });

    // And no partial findings are returned
    expect(parsedFindings).toBeUndefined();

    // And the error cause contains the JSON syntax failure
    expect(thrownError).toMatchObject({
      cause: expect.any(SyntaxError),
    });
  });

  it("rejects a schema-violating parsed object with a typed parse error", () => {
    // Given the LLM response input is an object with summary "Broken response"
    // And the object contains a finding with line_start 10 and line_end 8
    const input = {
      summary: "Broken response",
      findings: [
        buildRawFinding({
          line_start: 10,
          line_end: 8,
        }),
      ],
    };

    let parsedFindings: ReturnType<typeof parseLLMResponse> | undefined;
    let thrownError: unknown;

    // When the maintainer calls `parseLLMResponse`
    try {
      parsedFindings = parseLLMResponse(input);
    } catch (error) {
      thrownError = error;
    }

    // Then parsing fails with a typed LLM response parse error
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
    });

    // And no partial findings are returned
    expect(parsedFindings).toBeUndefined();

    // And the error cause contains the Zod validation failure
    expect(thrownError).toMatchObject({
      cause: expect.objectContaining({
        issues: [
          expect.objectContaining({
            path: ["findings", 0, "line_end"],
          }),
        ],
      }),
    });
  });

  it("rejects non-object parsed inputs with a typed parse error", () => {
    const inputs = [null, [], 42];

    for (const input of inputs) {
      // Given the LLM response input is <input>
      let parsedFindings: ReturnType<typeof parseLLMResponse> | undefined;
      let thrownError: unknown;

      // When the maintainer calls `parseLLMResponse`
      try {
        parsedFindings = parseLLMResponse(input);
      } catch (error) {
        thrownError = error;
      }

      // Then parsing fails with a typed LLM response parse error
      expect(thrownError).toBeInstanceOf(Error);
      expect(thrownError).toMatchObject({
        name: "LLMResponseParseError",
      });

      // And no partial findings are returned
      expect(parsedFindings).toBeUndefined();

      // And the error cause contains the Zod validation failure
      expect(thrownError).toMatchObject({
        cause: expect.objectContaining({
          issues: [
            expect.objectContaining({
              code: "invalid_type",
              path: [],
            }),
          ],
        }),
      });
    }
  });

  it("assigns a UUID v4 id to a parsed finding", () => {
    // Given the raw LLM response summary is "One finding found"
    // And the raw LLM response contains a finding for file "src/cards.ts"
    // And the raw finding severity is "major"
    // And the raw finding category is "bug"
    // And the raw finding line_start is 8
    // And the raw finding line_end is 8
    // And the raw finding title is "Reject blocked card state"
    // And the raw finding body is "Blocked cards are still treated as active."
    // And the raw finding suggested_code is "return false;"
    // And the raw finding confidence is 0.87
    const response = {
      summary: "One finding found",
      findings: [buildRawFinding()],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(1);

    const [finding] = findings;

    // And the returned finding id matches the UUID v4 format
    expect(finding?.id).toMatch(UuidV4Pattern);

    // And the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("returns a Finding array for a valid response", () => {
    // Given the test fixture contains a valid response with summary "Review completed"
    // And the test fixture contains one finding for file "src/review.ts"
    const response = {
      summary: "Review completed",
      findings: [
        buildRawFinding({
          file: "src/review.ts",
        }),
      ],
    };

    // When the maintainer runs the parser tests
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the valid response test passes
    expect(findings).toHaveLength(1);

    // And the test asserts that a `Finding[]` is returned
    expect(Array.isArray(findings)).toBe(true);

    // And the test asserts that the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("throws a typed parse error for a schema-violating response", () => {
    // Given the test fixture contains a response with summary "Broken response"
    // And the test fixture contains a finding with line_start 22 and line_end 20
    const response = {
      summary: "Broken response",
      findings: [
        buildRawFinding({
          line_start: 22,
          line_end: 20,
        }),
      ],
    };

    let parsedFindings: ReturnType<typeof parseLLMResponse> | undefined;
    let thrownError: unknown;

    // When the maintainer runs the parser tests
    try {
      parsedFindings = parseLLMResponse(response);
    } catch (error) {
      thrownError = error;
    }

    // Then the schema-violating response test passes
    expect(thrownError).toBeInstanceOf(Error);

    // And the test asserts that parsing fails with a typed LLM response parse error
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
    });

    // And the test asserts that no partial findings are returned
    expect(parsedFindings).toBeUndefined();
  });

  it("throws a findings limit validation error for an oversized response", () => {
    // Given the test fixture contains a response with summary "Too many findings"
    // And the test fixture contains 101 findings
    const response = {
      summary: "Too many findings",
      findings: Array.from({ length: 101 }, (_, index) =>
        buildRawFinding({
          file: `src/review-${index}.ts`,
        }),
      ),
    };

    let thrownError: unknown;

    // When the maintainer runs the parser tests
    try {
      parseLLMResponse(response);
    } catch (error) {
      thrownError = error;
    }

    // Then the oversized response test passes
    expect(thrownError).toBeInstanceOf(Error);

    // And the test asserts that parsing fails with a findings limit validation error
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
      issues: [
        expect.objectContaining({
          code: "too_big",
          path: ["findings"],
        }),
      ],
    });
  });

  it("fails loudly if LLM response schema validation is bypassed", () => {
    // Given a parser regression returns raw findings without Zod validation
    const response = {
      summary: "Validation bypass regression",
      findings: [
        {
          ...buildRawFinding(),
          id: NonV4Uuid,
          source: "llm",
        },
      ],
    };

    let thrownError: unknown;

    // When the maintainer runs the parser tests
    try {
      parseLLMResponse(response);
    } catch (error) {
      thrownError = error;
    }

    // Then the parser test suite fails
    expect(thrownError, "missing LLM response schema validation").toBeInstanceOf(Error);

    // And the failure identifies the missing schema validation
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
      issues: [
        expect.objectContaining({
          code: "unrecognized_keys",
          keys: expect.arrayContaining(["id", "source"]),
          path: ["findings", 0],
        }),
      ],
    });
  });

  it("assigns separate UUID v4 ids to multiple parsed findings", () => {
    // Given the raw LLM response summary is "One finding found"
    // And the raw LLM response contains a finding for file "src/cards.ts"
    // And the raw finding severity is "major"
    // And the raw finding category is "bug"
    // And the raw finding line_start is 8
    // And the raw finding line_end is 8
    // And the raw finding title is "Reject blocked card state"
    // And the raw finding body is "Blocked cards are still treated as active."
    // And the raw finding suggested_code is "return false;"
    // And the raw finding confidence is 0.87
    // Given the raw LLM response contains 3 valid findings
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding(),
        buildRawFinding({
          file: "src/deck.ts",
          line_start: 12,
          line_end: 12,
          title: "Reject empty deck state",
          body: "Empty decks are still treated as drawable.",
        }),
        buildRawFinding({
          file: "src/limits.ts",
          line_start: 21,
          line_end: 21,
          title: "Reject negative limit",
          body: "Negative limits are still accepted.",
        }),
      ],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(3);

    const ids = findings.map(({ id }) => id);

    // And each returned finding id matches the UUID v4 format
    for (const id of ids) {
      expect(id).toMatch(UuidV4Pattern);
    }

    // And the 3 returned finding ids are distinct
    expect(new Set(ids).size).toBe(3);
  });

  it("parses a response with two findings", () => {
    // Given the raw LLM response summary is "Two findings found"
    // And the raw LLM response contains 2 findings
    const response = {
      summary: "Two findings found",
      findings: [buildPaymentFinding(), buildPaymentFinding()],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(2);

    // And 2 findings are returned
    expect(findings).toHaveLength(2);
  });

  it("accepts a response with zero findings", () => {
    // Given the raw LLM response summary is "No findings found"
    // And the raw LLM response contains 0 findings
    const response = {
      summary: "No findings found",
      findings: [],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(0);

    // And 0 findings are returned
    expect(findings).toHaveLength(0);
  });

  it("accepts a response with exactly 100 findings", () => {
    // Given the raw LLM response summary is "Maximum findings found"
    // And the raw LLM response contains 100 findings
    const response = {
      summary: "Maximum findings found",
      findings: Array.from({ length: 100 }, () => buildPaymentFinding()),
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(100);

    // And 100 findings are returned
    expect(findings).toHaveLength(100);
  });

  it("rejects a response with 101 findings", () => {
    // Given the raw LLM response summary is "Too many findings found"
    // And the raw LLM response contains 101 findings
    const response = {
      summary: "Too many findings found",
      findings: Array.from({ length: 101 }, () => buildPaymentFinding()),
    };

    let parsedFindings: ReturnType<typeof parseLLMResponse> | undefined;
    let thrownError: unknown;

    // When the maintainer parses the LLM response
    try {
      parsedFindings = parseLLMResponse(response);
    } catch (error) {
      thrownError = error;
    }

    // Then parsing fails with a typed LLM response parse error
    expect(thrownError).toBeInstanceOf(Error);
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
    });

    // And no partial findings are returned
    expect(parsedFindings).toBeUndefined();

    // And the error cause contains the findings limit validation failure
    expect(thrownError).toMatchObject({
      cause: expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "too_big",
            path: ["findings"],
          }),
        ],
      }),
    });
  });

  it("rejects a non-v4 id before a finding is returned", () => {
    // Given a parser regression assigns id "550e8400-e29b-11d4-a716-446655440000"
    const regressionFinding = {
      id: NonV4Uuid,
      severity: "major",
      category: "bug",
      file: "src/cards.ts",
      line_start: 8,
      line_end: 8,
      title: "Reject blocked card state",
      body: "Blocked cards are still treated as active.",
      source: "llm",
      confidence: 0.87,
    };

    // When the maintainer validates the parsed finding
    const validation = FindingSchema.safeParse(regressionFinding);

    // Then validation fails against `FindingSchema`
    expect(validation.success).toBe(false);

    const findings = parseLLMResponse({
      summary: "One finding found",
      findings: [buildRawFinding()],
    });

    // And no finding with the non-v4 id is returned
    expect(findings.map(({ id }) => id)).not.toContain(NonV4Uuid);
  });

  it("returns a committable suggestion for a non-empty single-line replacement", () => {
    // Given the raw finding has severity "minor"
    // And the raw finding has category "maintainability"
    // And the raw finding has file "src/totals.ts"
    // And the raw finding has title "Use explicit zero fallback"
    // And the raw finding has body "The total can be undefined before formatting."
    // And the raw finding has confidence 0.84
    // Given the raw finding line_start is 14
    // And the raw finding line_end is 14
    // And the raw finding suggested_code is "const total = amount ?? 0;"
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          severity: "minor",
          category: "maintainability",
          file: "src/totals.ts",
          line_start: 14,
          line_end: 14,
          title: "Use explicit zero fallback",
          body: "The total can be undefined before formatting.",
          suggested_code: "const total = amount ?? 0;",
          confidence: 0.84,
        }),
      ],
    };

    // When the maintainer computes the committable value
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the committable result is true
    expect(finding?.suggestion?.committable).toBe(true);

    // And the suggestion is returned with code "const total = amount ?? 0;"
    expect(finding?.suggestion?.code).toBe("const total = amount ?? 0;");

    // And suggestion.committable is true
    expect(finding?.suggestion?.committable).toBe(true);
  });

  it("does not mark empty or multiline replacements as committable", () => {
    const examples = ["", "const total = amount ?? 0;\nreturn total;"];

    for (const suggestedCode of examples) {
      const findings = parseLLMResponse({
        summary: "One finding found",
        findings: [
          buildRawFinding({
            line_start: 14,
            line_end: 14,
            suggested_code: suggestedCode,
          }),
        ],
      });

      const [finding] = findings;

      expect(finding?.suggestion?.committable).toBe(false);
    }
  });

  it("does not mark syntactically uncertain single-line replacements as committable", () => {
    const findings = parseLLMResponse({
      summary: "One finding found",
      findings: [
        buildRawFinding({
          line_start: 14,
          line_end: 14,
          suggested_code: "return normalize(value...",
        }),
      ],
    });

    const [finding] = findings;

    expect(finding?.suggestion?.committable).toBe(false);
  });

  it("marks non-committable suggestions as false", () => {
    const examples = [
      {
        line_start: 14,
        line_end: 16,
        suggested_code: "const total = amount ?? 0;",
        requiresSuggestion: true,
      },
      {
        line_start: 14,
        line_end: 14,
        suggested_code: "const total = amount ?? 0;\nreturn total;",
        requiresSuggestion: true,
      },
      {
        line_start: 14,
        line_end: 14,
        suggested_code: "",
        requiresSuggestion: true,
      },
      { line_start: 14, line_end: 14, suggested_code: "   ", requiresSuggestion: false },
      { line_start: 14, line_end: 14, suggested_code: null, requiresSuggestion: false },
    ];

    for (const { requiresSuggestion, ...example } of examples) {
      // Given the raw finding line_start is <line_start>
      // And the raw finding line_end is <line_end>
      // And the raw finding suggested_code is <suggested_code>
      const findings = parseLLMResponse({
        summary: "One finding found",
        findings: [
          buildRawFinding({
            severity: "minor",
            category: "maintainability",
            file: "src/totals.ts",
            title: "Use explicit zero fallback",
            body: "The total can be undefined before formatting.",
            confidence: 0.84,
            ...example,
          }),
        ],
      });

      const [finding] = findings;

      if (requiresSuggestion) {
        expect(finding?.suggestion).toBeDefined();

        // When the maintainer computes the committable value
        // Then the committable result is false
        expect(finding?.suggestion?.committable).toBe(false);
      } else {
        // When the maintainer computes the committable value
        // Then the committable result is false
        expect(finding?.suggestion?.committable).not.toBe(true);
      }
    }
  });

  it("returns no suggestion object for null suggested code", () => {
    // Given the raw finding line_start is 14
    // And the raw finding line_end is 14
    // And the raw finding suggested_code is null
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          severity: "minor",
          category: "maintainability",
          file: "src/totals.ts",
          line_start: 14,
          line_end: 14,
          title: "Use explicit zero fallback",
          body: "The total can be undefined before formatting.",
          suggested_code: null,
          confidence: 0.84,
        }),
      ],
    };

    // When the maintainer converts the raw finding to a public Finding
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the returned finding has no suggestion
    expect(finding?.suggestion).toBeUndefined();

    // And the returned finding still validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("returns no suggestion object for whitespace-only suggested code", () => {
    // Given the raw finding line_start is 14
    // And the raw finding line_end is 14
    // And the raw finding suggested_code is "   "
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          severity: "minor",
          category: "maintainability",
          file: "src/totals.ts",
          line_start: 14,
          line_end: 14,
          title: "Use explicit zero fallback",
          body: "The total can be undefined before formatting.",
          suggested_code: "   ",
          confidence: 0.84,
        }),
      ],
    };

    // When the maintainer converts the raw finding to a public Finding
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the returned finding has no suggestion
    expect(finding?.suggestion).toBeUndefined();

    // And the returned finding still validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });
});
