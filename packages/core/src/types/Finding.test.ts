// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  CategorySchema,
  FindingSchema,
  SeveritySchema,
  type Category,
  type Finding,
  type Severity,
} from "./Finding.js";

const baseFinding: Finding = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  severity: "major",
  category: "bug",
  file: "src/index.ts",
  line_start: 10,
  line_end: 12,
  title: "Possible null dereference",
  body: "Variable `foo` may be `null` here because the early-return guard above only checks `bar`.",
  source: "llm",
  confidence: 0.85,
};

describe("SeveritySchema", () => {
  const validSeverities = [
    "blocker",
    "major",
    "minor",
    "info",
    "nitpick",
  ] satisfies readonly Severity[];

  it.each(validSeverities)("accepts %s", (value) => {
    expect(SeveritySchema.parse(value)).toBe(value);
  });

  it("rejects an unknown severity", () => {
    expect(SeveritySchema.safeParse("critical").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(SeveritySchema.safeParse("").success).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(SeveritySchema.safeParse(0).success).toBe(false);
    expect(SeveritySchema.safeParse(null).success).toBe(false);
    expect(SeveritySchema.safeParse(undefined).success).toBe(false);
  });
});

describe("CategorySchema", () => {
  const validCategories = [
    "bug",
    "security",
    "performance",
    "maintainability",
    "style",
    "documentation",
    "test-coverage",
  ] satisfies readonly Category[];

  it.each(validCategories)("accepts %s", (value) => {
    expect(CategorySchema.parse(value)).toBe(value);
  });

  it("rejects an unknown category", () => {
    expect(CategorySchema.safeParse("typo").success).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(CategorySchema.safeParse(null).success).toBe(false);
  });
});

describe("FindingSchema — happy paths", () => {
  it("accepts a minimal valid finding (no optional fields)", () => {
    const parsed = FindingSchema.parse(baseFinding);
    expect(parsed).toEqual(baseFinding);
    expect(parsed.suggestion).toBeUndefined();
    expect(parsed.cwe).toBeUndefined();
  });

  it("accepts a finding with a committable suggestion", () => {
    const parsed = FindingSchema.parse({
      ...baseFinding,
      suggestion: { code: "if (foo != null) {\n  foo.bar;\n}", committable: true },
    });
    expect(parsed.suggestion).toEqual({
      code: "if (foo != null) {\n  foo.bar;\n}",
      committable: true,
    });
  });

  it("accepts a SARIF finding with a CWE identifier", () => {
    const parsed = FindingSchema.parse({
      ...baseFinding,
      source: "sarif",
      cwe: "CWE-79",
    });
    expect(parsed.source).toBe("sarif");
    expect(parsed.cwe).toBe("CWE-79");
  });

  it("accepts confidence at the inclusive boundaries (0 and 1)", () => {
    expect(FindingSchema.parse({ ...baseFinding, confidence: 0 }).confidence).toBe(0);
    expect(FindingSchema.parse({ ...baseFinding, confidence: 1 }).confidence).toBe(1);
  });

  it("accepts title at the maximum length (200)", () => {
    const title = "t".repeat(200);
    expect(FindingSchema.parse({ ...baseFinding, title }).title).toHaveLength(200);
  });

  it("accepts body at the maximum length (2000)", () => {
    const body = "b".repeat(2000);
    expect(FindingSchema.parse({ ...baseFinding, body }).body).toHaveLength(2000);
  });

  it("accepts line_start === line_end (single-line finding)", () => {
    expect(FindingSchema.parse({ ...baseFinding, line_start: 5, line_end: 5 }).line_end).toBe(5);
  });
});

describe("FindingSchema — id (uuid)", () => {
  it("rejects a non-uuid id", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, id: "" }).success).toBe(false);
  });

  it("rejects a malformed uuid (wrong segment count)", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, id: "550e8400-e29b-41d4-a716" }).success).toBe(
      false,
    );
  });

  it("rejects a non-v4 uuid", () => {
    expect(
      FindingSchema.safeParse({ ...baseFinding, id: "550e8400-e29b-11d4-a716-446655440000" })
        .success,
    ).toBe(false);
  });
});

describe("FindingSchema — file", () => {
  it("rejects an empty file path", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, file: "" }).success).toBe(false);
  });

  it("rejects a non-string file", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, file: 42 }).success).toBe(false);
  });
});

describe("FindingSchema — line bounds (positive int)", () => {
  it.each([0, -1, 1.5])("rejects line_start = %p", (value) => {
    expect(FindingSchema.safeParse({ ...baseFinding, line_start: value }).success).toBe(false);
  });

  it.each([0, -1, 2.7])("rejects line_end = %p", (value) => {
    expect(FindingSchema.safeParse({ ...baseFinding, line_end: value }).success).toBe(false);
  });

  it("rejects a non-numeric line_start", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, line_start: "10" }).success).toBe(false);
  });
});

describe("FindingSchema — title length", () => {
  it("rejects an empty title", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, title: "" }).success).toBe(false);
  });

  it("rejects a title longer than 200 characters", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, title: "t".repeat(201) }).success).toBe(false);
  });
});

describe("FindingSchema — body length", () => {
  it("rejects an empty body", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, body: "" }).success).toBe(false);
  });

  it("rejects a body longer than 2000 characters", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, body: "b".repeat(2001) }).success).toBe(false);
  });
});

describe("FindingSchema — source enum", () => {
  it("accepts llm", () => {
    expect(FindingSchema.parse({ ...baseFinding, source: "llm" }).source).toBe("llm");
  });

  it("accepts sarif", () => {
    expect(FindingSchema.parse({ ...baseFinding, source: "sarif" }).source).toBe("sarif");
  });

  it("rejects an unknown source", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, source: "human" }).success).toBe(false);
  });
});

describe("FindingSchema — confidence (0..1)", () => {
  it.each([-0.01, 1.01, -1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects confidence = %p",
    (value) => {
      expect(FindingSchema.safeParse({ ...baseFinding, confidence: value }).success).toBe(false);
    },
  );

  it("rejects a non-numeric confidence", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, confidence: "0.5" }).success).toBe(false);
  });
});

describe("FindingSchema — suggestion", () => {
  it("is absent by default", () => {
    expect(FindingSchema.parse(baseFinding).suggestion).toBeUndefined();
  });

  it("rejects a suggestion missing committable", () => {
    expect(
      FindingSchema.safeParse({
        ...baseFinding,
        suggestion: { code: "x" },
      }).success,
    ).toBe(false);
  });

  it("rejects a suggestion with a non-string code", () => {
    expect(
      FindingSchema.safeParse({
        ...baseFinding,
        suggestion: { code: 42, committable: true },
      }).success,
    ).toBe(false);
  });

  it("rejects a suggestion with a non-boolean committable", () => {
    expect(
      FindingSchema.safeParse({
        ...baseFinding,
        suggestion: { code: "x", committable: "true" },
      }).success,
    ).toBe(false);
  });

  it("accepts an empty suggestion code (no minimum length)", () => {
    const parsed = FindingSchema.parse({
      ...baseFinding,
      suggestion: { code: "", committable: false },
    });
    expect(parsed.suggestion).toEqual({ code: "", committable: false });
  });
});

describe("FindingSchema — cwe", () => {
  it("is absent by default", () => {
    expect(FindingSchema.parse(baseFinding).cwe).toBeUndefined();
  });

  it("accepts CWE-79", () => {
    expect(FindingSchema.parse({ ...baseFinding, cwe: "CWE-79" }).cwe).toBe("CWE-79");
  });

  it("accepts a multi-digit CWE", () => {
    expect(FindingSchema.parse({ ...baseFinding, cwe: "CWE-1234567" }).cwe).toBe("CWE-1234567");
  });

  it("rejects a lowercase prefix", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, cwe: "cwe-79" }).success).toBe(false);
  });

  it("rejects a CWE with no digits", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, cwe: "CWE-" }).success).toBe(false);
  });

  it("rejects extra leading characters", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, cwe: "XCWE-79" }).success).toBe(false);
  });

  it("rejects trailing characters after the digits", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, cwe: "CWE-79x" }).success).toBe(false);
  });
});

describe("FindingSchema — required field omissions", () => {
  const requiredKeys = [
    "id",
    "severity",
    "category",
    "file",
    "line_start",
    "line_end",
    "title",
    "body",
    "source",
    "confidence",
  ] as const;

  it.each(requiredKeys)("rejects a finding missing %s", (key) => {
    const broken = { ...baseFinding } as Record<string, unknown>;
    delete broken[key];
    expect(FindingSchema.safeParse(broken).success).toBe(false);
  });
});

describe("FindingSchema — type inference", () => {
  it("infers a Finding whose runtime parse round-trips", () => {
    const finding: Finding = { ...baseFinding };
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("infers Severity as the schema's literal union", () => {
    const s: Severity = "blocker";
    expect(SeveritySchema.parse(s)).toBe("blocker");
  });

  it("infers Category as the schema's literal union", () => {
    const c: Category = "security";
    expect(CategorySchema.parse(c)).toBe("security");
  });
});
