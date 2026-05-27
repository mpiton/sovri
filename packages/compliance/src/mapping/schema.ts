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

const classicBufferOverflowCweId = "CWE-120";
const isoSecureCodingFramework = "ISO27001-2022";
const isoSecureCodingIdentifier = "A.8.28";
const missingAuthorizationCweId = "CWE-862";
const doraFramework = "DORA";
const cweIdentifierPattern = /^CWE-(\d+)$/u;

function buildCanonicalMitreUrl(cweId: string): string | undefined {
  const cweIdMatch = cweIdentifierPattern.exec(cweId);
  const cweNumber = cweIdMatch?.[1];
  if (cweNumber === undefined) {
    return undefined;
  }

  const canonicalCweNumber = Number.parseInt(cweNumber, 10).toString();

  return `https://cwe.mitre.org/data/definitions/${canonicalCweNumber}.html`;
}

export const ComplianceMappingEntrySchema = z
  .object({
    cwe_id: z.string().regex(/^CWE-\d+$/),
    title: z.string().min(1),
    mitre_url: z.string().url(),
    impacts: z.array(z.string()),
    references: z.array(ComplianceReferenceEntrySchema),
  })
  .superRefine((entry, context) => {
    const canonicalMitreUrl = buildCanonicalMitreUrl(entry.cwe_id);
    if (canonicalMitreUrl !== undefined && entry.mitre_url !== canonicalMitreUrl) {
      context.addIssue({
        code: "custom",
        path: ["mitre_url"],
        message: `${entry.cwe_id} requires canonical MITRE URL ${canonicalMitreUrl}`,
      });
    }

    if (entry.cwe_id === classicBufferOverflowCweId) {
      const hasIsoSecureCodingReference = entry.references.some(
        (reference) =>
          reference.framework === isoSecureCodingFramework &&
          reference.identifier === isoSecureCodingIdentifier,
      );

      if (!hasIsoSecureCodingReference) {
        context.addIssue({
          code: "custom",
          path: ["references"],
          message: `${classicBufferOverflowCweId} requires ${isoSecureCodingFramework} reference ${isoSecureCodingIdentifier}`,
        });
      }
    }

    if (entry.cwe_id === missingAuthorizationCweId) {
      const hasDoraReference = entry.references.some(
        (reference) => reference.framework === doraFramework,
      );

      if (!hasDoraReference) {
        context.addIssue({
          code: "custom",
          path: ["references"],
          message: `${missingAuthorizationCweId} requires ${doraFramework} reference`,
        });
      }
    }
  });
export type ComplianceMappingEntry = z.infer<typeof ComplianceMappingEntrySchema>;
