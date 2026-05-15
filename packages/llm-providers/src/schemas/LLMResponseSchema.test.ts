// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  LLMFindingSchema,
  LLMResponseSchema,
  type LLMFinding,
  type LLMResponse,
} from "./LLMResponseSchema.js";

const baseFinding: LLMFinding = {
  severity: "major",
  category: "bug",
  file: "src/index.ts",
  line_start: 10,
  line_end: 12,
  title: "Possible null dereference",
  body: "Variable `foo` may be `null` here because the guard above only checks `bar`.",
};

const baseResponse: LLMResponse = {
  summary: "Two issues found in the auth handler.",
  findings: [baseFinding],
  walkthrough_markdown: "# Walkthrough\n\nThe auth handler ...",
};

describe("LLMFindingSchema — happy paths", () => {
  it("accepts a minimal valid finding (no optional fields)", () => {
    const parsed = LLMFindingSchema.parse(baseFinding);
    expect(parsed).toEqual(baseFinding);
    expect(parsed.cwe).toBeUndefined();
  });

  it("accepts a finding with a CWE identifier", () => {
    const parsed = LLMFindingSchema.parse({ ...baseFinding, cwe: "CWE-79" });
    expect(parsed.cwe).toBe("CWE-79");
  });

  it("accepts line_start equal to line_end", () => {
    const parsed = LLMFindingSchema.parse({
      ...baseFinding,
      line_start: 7,
      line_end: 7,
    });
    expect(parsed.line_start).toBe(parsed.line_end);
  });
});

describe("LLMFindingSchema — validation", () => {
  it.each(["CWE-", "cwe-79", "79", "CWE_79", " CWE-79"])("rejects malformed cwe %p", (cwe) => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, cwe }).success).toBe(false);
  });

  it("rejects an unknown severity", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, severity: "critical" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown category", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, category: "typo" }).success).toBe(false);
  });

  it.each([0, -1, 1.5])("rejects non-positive integer line_start %s", (value) => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, line_start: value }).success).toBe(false);
  });

  it("rejects an empty file path", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, file: "" }).success).toBe(false);
  });

  it("rejects a title longer than 200 chars", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, title: "x".repeat(201) }).success).toBe(
      false,
    );
  });

  it("rejects a body longer than 2000 chars", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, body: "x".repeat(2001) }).success).toBe(
      false,
    );
  });

  const requiredKeys = [
    "severity",
    "category",
    "file",
    "line_start",
    "line_end",
    "title",
    "body",
  ] as const;

  it.each(requiredKeys)("rejects when %s is missing", (key) => {
    const finding = { ...baseFinding } as Record<string, unknown>;
    delete finding[key];
    expect(LLMFindingSchema.safeParse(finding).success).toBe(false);
  });
});

describe("LLMFindingSchema — hardening", () => {
  it.each(["/etc/passwd", "/var/log/auth.log"])("rejects absolute file path %p", (file) => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, file }).success).toBe(false);
  });

  it.each(["../etc/passwd", "src/../../../etc/passwd", "../../."])(
    "rejects traversal segment in file path %p",
    (file) => {
      expect(LLMFindingSchema.safeParse({ ...baseFinding, file }).success).toBe(false);
    },
  );

  it.each(["src//a.ts", "src/a.ts/", "/src/a.ts", "src/./a.ts"])(
    "rejects non-canonical path %p (empty / current-dir segments)",
    (file) => {
      expect(LLMFindingSchema.safeParse({ ...baseFinding, file }).success).toBe(false);
    },
  );

  it("rejects a Windows-style drive separator in file path", () => {
    expect(
      LLMFindingSchema.safeParse({ ...baseFinding, file: "C:\\Windows\\system32" }).success,
    ).toBe(false);
  });

  it.each(["a\u0000b", "a\nb", "a\rb"])("rejects control bytes in file path %j", (file) => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, file }).success).toBe(false);
  });

  it("rejects file paths longer than 1024 chars", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, file: "x".repeat(1025) }).success).toBe(
      false,
    );
  });

  it("rejects line_start above the per-file ceiling (1_000_000)", () => {
    expect(
      LLMFindingSchema.safeParse({ ...baseFinding, line_start: 1_000_001, line_end: 1_000_002 })
        .success,
    ).toBe(false);
  });

  it("rejects line_end above the per-file ceiling (1_000_000)", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, line_end: 1_000_001 }).success).toBe(false);
  });

  it("rejects when line_start > line_end", () => {
    expect(
      LLMFindingSchema.safeParse({ ...baseFinding, line_start: 12, line_end: 10 }).success,
    ).toBe(false);
  });

  it("rejects CWE numbers with more than 7 digits", () => {
    expect(
      LLMFindingSchema.safeParse({ ...baseFinding, cwe: `CWE-${"9".repeat(8)}` }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict object guards against LLM smuggling)", () => {
    expect(LLMFindingSchema.safeParse({ ...baseFinding, extra: "smuggled" }).success).toBe(false);
  });
});

describe("LLMResponseSchema — happy paths", () => {
  it("accepts a response with one finding", () => {
    const parsed = LLMResponseSchema.parse(baseResponse);
    expect(parsed.findings).toHaveLength(1);
  });

  it("accepts a response with zero findings", () => {
    const parsed = LLMResponseSchema.parse({ ...baseResponse, findings: [] });
    expect(parsed.findings).toEqual([]);
  });

  it("accepts exactly 100 findings (boundary)", () => {
    const findings = Array.from({ length: 100 }, () => baseFinding);
    expect(LLMResponseSchema.safeParse({ ...baseResponse, findings }).success).toBe(true);
  });
});

describe("LLMResponseSchema — validation", () => {
  it("rejects an empty summary", () => {
    expect(LLMResponseSchema.safeParse({ ...baseResponse, summary: "" }).success).toBe(false);
  });

  it("rejects a summary longer than 2000 chars", () => {
    expect(
      LLMResponseSchema.safeParse({ ...baseResponse, summary: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  const requiredKeys = ["summary", "findings", "walkthrough_markdown"] as const;

  it.each(requiredKeys)("rejects when %s is missing", (key) => {
    const response = { ...baseResponse } as Record<string, unknown>;
    delete response[key];
    expect(LLMResponseSchema.safeParse(response).success).toBe(false);
  });

  it("rejects a non-array findings field", () => {
    expect(LLMResponseSchema.safeParse({ ...baseResponse, findings: "nope" }).success).toBe(false);
  });

  it("rejects when a finding inside the array is invalid", () => {
    const bad = { ...baseFinding, severity: "critical" };
    expect(LLMResponseSchema.safeParse({ ...baseResponse, findings: [bad] }).success).toBe(false);
  });
});

describe("LLMResponseSchema — hardening", () => {
  it("rejects more than 100 findings (DoS guard)", () => {
    const overflow = Array.from({ length: 101 }, () => baseFinding);
    expect(LLMResponseSchema.safeParse({ ...baseResponse, findings: overflow }).success).toBe(
      false,
    );
  });

  it("rejects an empty walkthrough_markdown", () => {
    expect(LLMResponseSchema.safeParse({ ...baseResponse, walkthrough_markdown: "" }).success).toBe(
      false,
    );
  });

  it("rejects walkthrough_markdown longer than 50000 chars", () => {
    expect(
      LLMResponseSchema.safeParse({
        ...baseResponse,
        walkthrough_markdown: "x".repeat(50_001),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict object guards against LLM smuggling)", () => {
    expect(LLMResponseSchema.safeParse({ ...baseResponse, extra: 1 }).success).toBe(false);
  });
});

describe("LLMResponseSchema — type inference", () => {
  it("round-trips through parse and preserves the typed shape", () => {
    const parsed = LLMResponseSchema.parse(baseResponse);
    const typed: LLMResponse = parsed;
    expect(typed).toEqual(baseResponse);
  });
});
