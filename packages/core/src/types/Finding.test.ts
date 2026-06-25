// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import * as core from "../index.js";
import {
  CategorySchema,
  ComplianceFrameworkSchema,
  ComplianceReferenceSchema,
  FindingSchema,
  SeveritySchema,
  type Category,
  type ComplianceFramework,
  type ComplianceReference,
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
  recommendation:
    "Guard `foo` for `null` before dereferencing it, or widen the early-return check to cover `foo`.",
  source: "llm",
  confidence: 0.85,
  compliance_references: [],
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
  const validCategories = ["bug", "security"] satisfies readonly Category[];

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

describe("FindingSchema — recommendation (required fix, issue #2450)", () => {
  it("rejects a finding with no recommendation", () => {
    const { recommendation: _dropped, ...withoutRecommendation } = baseFinding;
    expect(FindingSchema.safeParse(withoutRecommendation).success).toBe(false);
  });

  it("rejects an empty recommendation", () => {
    expect(FindingSchema.safeParse({ ...baseFinding, recommendation: "" }).success).toBe(false);
  });

  it("rejects a recommendation longer than 1000 characters", () => {
    expect(
      FindingSchema.safeParse({ ...baseFinding, recommendation: "r".repeat(1001) }).success,
    ).toBe(false);
  });

  it("accepts recommendation at the maximum length (1000)", () => {
    const recommendation = "r".repeat(1000);
    expect(FindingSchema.parse({ ...baseFinding, recommendation }).recommendation).toHaveLength(
      1000,
    );
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

const baseReference = {
  framework: "GDPR",
  identifier: "Art. 32",
  description: "Security of processing",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  applicability: "informational",
};

describe("ComplianceFrameworkSchema (R-01)", () => {
  const frameworks = [
    "CWE",
    "OWASP-TOP10-2021",
    "ISO27001-2022",
    "GDPR",
    "DORA",
    "NIS2",
    "AI-ACT",
    "CRA",
  ] satisfies readonly ComplianceFramework[];

  it.each(frameworks)("accepts %s", (value) => {
    expect(ComplianceFrameworkSchema.parse(value)).toBe(value);
  });

  it.each(["SOC2", "PCI-DSS", "cwe", "gdpr", ""])("rejects %p", (value) => {
    expect(ComplianceFrameworkSchema.safeParse(value).success).toBe(false);
  });

  it("exposes exactly the eight regulated options", () => {
    expect(ComplianceFrameworkSchema.options).toEqual(frameworks);
  });
});

describe("ComplianceReferenceSchema — applicability (R-02)", () => {
  it("accepts an informational reference without a condition", () => {
    expect(ComplianceReferenceSchema.parse(baseReference).applicability).toBe("informational");
  });

  it("accepts an applicable_if reference with a condition", () => {
    const parsed = ComplianceReferenceSchema.parse({
      ...baseReference,
      applicability: "applicable_if",
      condition: "Personal data is processed by the reviewed code",
    });
    expect(parsed.applicability).toBe("applicable_if");
  });

  it("rejects a confirmed applicability (path: applicability)", () => {
    const result = ComplianceReferenceSchema.safeParse({
      framework: "DORA",
      identifier: "Art. 9",
      description: "ICT risk management framework",
      source_url: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj",
      applicability: "confirmed",
      condition: "ICT risk management is in scope",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "applicability")).toBe(
        true,
      );
    }
  });

  it("accepts exactly the two automatic applicability values", () => {
    expect(ComplianceReferenceSchema.safeParse(baseReference).success).toBe(true);
    expect(
      ComplianceReferenceSchema.safeParse({
        ...baseReference,
        applicability: "applicable_if",
        condition: "Personal data is processed",
      }).success,
    ).toBe(true);
    for (const applicability of ["confirmed", "manual", "auto"]) {
      expect(
        ComplianceReferenceSchema.safeParse({ ...baseReference, applicability, condition: "x" })
          .success,
      ).toBe(false);
    }
  });
});

describe("ComplianceReferenceSchema — applicable_if condition (R-03)", () => {
  const isoReference = {
    framework: "ISO27001-2022",
    identifier: "A.5.17",
    description: "Authentication information",
    source_url: "https://www.iso.org/standard/27001",
  };

  it("accepts an applicable_if reference carrying its condition", () => {
    const parsed = ComplianceReferenceSchema.parse({
      ...isoReference,
      applicability: "applicable_if",
      condition: "Authentication information is present in the finding",
    });
    expect(parsed.condition).toBe("Authentication information is present in the finding");
  });

  it("rejects an applicable_if reference without a condition (path: condition)", () => {
    const result = ComplianceReferenceSchema.safeParse({
      ...isoReference,
      applicability: "applicable_if",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "condition")).toBe(true);
    }
  });

  it("accepts an informational reference with the condition omitted", () => {
    const parsed = ComplianceReferenceSchema.parse({
      framework: "CWE",
      identifier: "CWE-798",
      description: "Use of Hard-coded Credentials",
      source_url: "https://cwe.mitre.org/data/definitions/798.html",
      applicability: "informational",
    });
    expect(parsed.condition).toBeUndefined();
  });

  it("rejects an empty-string condition (path: condition)", () => {
    const result = ComplianceReferenceSchema.safeParse({
      ...baseReference,
      applicability: "applicable_if",
      condition: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("condition"))).toBe(true);
    }
  });
});

describe("FindingSchema — audit_reference (R-04)", () => {
  it("accepts a canonical audit reference", () => {
    expect(
      FindingSchema.parse({ ...baseFinding, audit_reference: "SOVRI-AB-1F3C-9D02" })
        .audit_reference,
    ).toBe("SOVRI-AB-1F3C-9D02");
  });

  it("is absent by default", () => {
    expect(FindingSchema.parse(baseFinding).audit_reference).toBeUndefined();
  });

  it.each([
    "SOVRI-AB-1f3c-9D02",
    "SOVRI-ab-1F3C-9D02",
    "SOVRI-AB-1F3-9D02",
    "SOVRI-AB-1F3C-9D02-AAAA",
    "AB-1F3C-9D02",
    "SOVRI-AB-1G3C-9D02",
    "sovri-AB-1F3C-9D02",
  ])("rejects a malformed audit_reference %p (path: audit_reference)", (value) => {
    const result = FindingSchema.safeParse({ ...baseFinding, audit_reference: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "audit_reference")).toBe(
        true,
      );
    }
  });
});

describe("FindingSchema — compliance_references (R-05)", () => {
  it("defaults to an empty array when omitted", () => {
    expect(FindingSchema.parse(baseFinding).compliance_references).toEqual([]);
  });

  it("preserves a single valid reference", () => {
    const parsed = FindingSchema.parse({
      ...baseFinding,
      compliance_references: [baseReference],
    });
    expect(parsed.compliance_references).toHaveLength(1);
    expect(parsed.compliance_references[0]?.identifier).toBe("Art. 32");
  });

  it("preserves an explicit empty array", () => {
    expect(
      FindingSchema.parse({ ...baseFinding, compliance_references: [] }).compliance_references,
    ).toEqual([]);
  });

  it("rejects an invalid nested reference (paths: compliance_references, condition)", () => {
    const result = FindingSchema.safeParse({
      ...baseFinding,
      compliance_references: [
        {
          framework: "ISO27001-2022",
          identifier: "A.5.17",
          description: "Authentication information",
          source_url: "https://www.iso.org/standard/27001",
          applicability: "applicable_if",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths.some((path) => path.includes("compliance_references"))).toBe(true);
      expect(paths.some((path) => path.includes("condition"))).toBe(true);
    }
  });
});

describe("FindingSchema — backward compatibility (R-06)", () => {
  it("parses a pre-v0.3 finding and applies the new defaults", () => {
    const legacyFinding = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      severity: "major",
      category: "bug",
      file: "src/index.ts",
      line_start: 10,
      line_end: 12,
      title: "Possible null dereference",
      body: "Variable foo may be null here.",
      recommendation: "Add a null check on foo before dereferencing it.",
      source: "llm",
      confidence: 0.85,
    };
    const parsed = FindingSchema.parse(legacyFinding);
    expect(parsed.compliance_references).toEqual([]);
    expect(parsed.audit_reference).toBeUndefined();
  });

  it("keeps the severity domain unchanged", () => {
    expect(SeveritySchema.options).toEqual(["blocker", "major", "minor", "info", "nitpick"]);
  });

  it("pins the category domain to the compliance-eligible set (ADR-021, MAT-76)", () => {
    expect(CategorySchema.options).toEqual(["bug", "security"]);
  });
});

describe("@sovri/core — compliance exports (R-07)", () => {
  it("re-exports the compliance schemas from the package root", () => {
    expect(typeof core.ComplianceFrameworkSchema.parse).toBe("function");
    expect(typeof core.ComplianceReferenceSchema.parse).toBe("function");
  });

  it("parses a value typed as the exported ComplianceReference", () => {
    const reference: ComplianceReference = {
      framework: "CWE",
      identifier: "CWE-798",
      description: "Use of Hard-coded Credentials",
      source_url: "https://cwe.mitre.org/data/definitions/798.html",
      applicability: "informational",
    };
    expect(core.ComplianceReferenceSchema.parse(reference).framework).toBe("CWE");
  });
});
