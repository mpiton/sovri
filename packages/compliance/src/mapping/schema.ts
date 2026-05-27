// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

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

export const ComplianceReferenceApplicabilitySchema = z.enum(["applicable_if", "informational"]);
export type ComplianceReferenceApplicability = z.infer<
  typeof ComplianceReferenceApplicabilitySchema
>;

export const ComplianceReferenceEntrySchema = z
  .object({
    framework: ComplianceFrameworkSchema,
    identifier: z.string().min(1),
    description: z.string().min(1),
    source_url: z.string().url(),
    applicability: ComplianceReferenceApplicabilitySchema,
    condition: z.string().min(1).optional(),
  })
  .superRefine((reference, context) => {
    if (
      reference.applicability === "applicable_if" &&
      (reference.condition === undefined || reference.condition.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["condition"],
        message: "condition is required when applicability is applicable_if",
      });
    }
  });
export type ComplianceReferenceEntry = z.infer<typeof ComplianceReferenceEntrySchema>;

export const ComplianceMappingEntrySchema = z.object({
  cwe_id: z.string().regex(/^CWE-\d+$/),
  title: z.string().min(1),
  mitre_url: z.string().url(),
  impacts: z.array(z.string()),
  references: z.array(ComplianceReferenceEntrySchema),
});
export type ComplianceMappingEntry = z.infer<typeof ComplianceMappingEntrySchema>;
