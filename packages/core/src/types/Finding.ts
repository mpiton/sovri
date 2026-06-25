// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "zod";

export const SeveritySchema = z.enum(["blocker", "major", "minor", "info", "nitpick"]);
export type Severity = z.infer<typeof SeveritySchema>;

// Sovri reviews for regulated compliance only: a finding must be a security or correctness weakness
// that can anchor a CWE → framework reference. The generic review categories (performance, style,
// maintainability, documentation, test-coverage) were removed in the compliance pivot (ADR-021,
// MAT-76). They produced only non-compliance noise that the publication gate (MAT-75) already
// dropped, so the taxonomy is now exactly the compliance-eligible set.
export const CategorySchema = z.enum(["bug", "security"]);
export type Category = z.infer<typeof CategorySchema>;

// Minimum LLM-reported confidence for a finding to receive compliance references. Below this, a
// security/bug finding's CWE is treated as too uncertain to anchor a regulatory reference.
export const COMPLIANCE_MIN_CONFIDENCE = 0.7;

const SuggestionSchema = z.object({
  code: z.string(),
  committable: z.boolean(),
});

const CwePattern = /^CWE-\d+$/;
const AuditReferencePattern = /^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/;

export const ComplianceFrameworkSchema = z.enum([
  "CWE",
  "OWASP-TOP10-2021",
  "ISO27001-2022",
  "GDPR",
  "DORA",
  "NIS2",
  "AI-ACT",
  "CRA",
]);
export type ComplianceFramework = z.infer<typeof ComplianceFrameworkSchema>;

export const ComplianceReferenceSchema = z
  .object({
    framework: ComplianceFrameworkSchema,
    identifier: z.string().min(1),
    description: z.string().min(1),
    source_url: z.string().url(),
    applicability: z.enum(["applicable_if", "informational"]),
    condition: z.string().min(1).optional(),
  })
  .superRefine((reference, context) => {
    if (reference.applicability === "applicable_if" && reference.condition === undefined) {
      context.addIssue({
        code: "custom",
        path: ["condition"],
        message: "condition is required when applicability is applicable_if",
      });
    }
  });
export type ComplianceReference = z.infer<typeof ComplianceReferenceSchema>;

export const FindingSchema = z.object({
  id: z.uuidv4(),
  audit_reference: z.string().regex(AuditReferencePattern).optional(),
  severity: SeveritySchema,
  category: CategorySchema,
  file: z.string().min(1),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive(),
  title: z.string().min(1).max(200),
  // `body` states what is wrong and why it matters; `recommendation` states the concrete fix.
  // Splitting the two and requiring `recommendation` is the load-bearing guard against narration:
  // a finding that only restates the diff cannot satisfy a mandatory "what to change" field.
  body: z.string().min(1).max(2000),
  recommendation: z.string().min(1).max(1000),
  suggestion: SuggestionSchema.optional(),
  source: z.enum(["llm", "sarif"]),
  confidence: z.number().min(0).max(1),
  cwe: z.string().regex(CwePattern).optional(),
  compliance_references: z.array(ComplianceReferenceSchema).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;
