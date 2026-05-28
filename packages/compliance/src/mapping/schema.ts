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

const officialSourceHostByFramework = {
  CWE: "cwe.mitre.org",
  "OWASP-TOP10-2021": "owasp.org",
  "ISO27001-2022": "www.iso.org",
  GDPR: "eur-lex.europa.eu",
  DORA: "eur-lex.europa.eu",
  NIS2: "eur-lex.europa.eu",
  "AI-ACT": "eur-lex.europa.eu",
  CRA: "eur-lex.europa.eu",
} satisfies Record<ComplianceFramework, string>;

export const ComplianceReferenceApplicabilitySchema = z.enum(["applicable_if", "informational"]);
export type ComplianceReferenceApplicability = z.infer<
  typeof ComplianceReferenceApplicabilitySchema
>;

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

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

    const expectedSourceHost = officialSourceHostByFramework[reference.framework];
    const sourceUrl = parseUrl(reference.source_url);
    if (sourceUrl !== undefined && sourceUrl.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["source_url"],
        message: `${reference.framework} source_url must use HTTPS: ${reference.source_url}`,
      });
    }

    if (sourceUrl !== undefined && sourceUrl.host !== expectedSourceHost) {
      context.addIssue({
        code: "custom",
        path: ["source_url"],
        message: `${reference.framework} source_url must use official host ${expectedSourceHost}: ${reference.source_url}`,
      });
    }
  });
export type ComplianceReferenceEntry = z.infer<typeof ComplianceReferenceEntrySchema>;

const classicBufferOverflowCweId = "CWE-120";
const isoSecureCodingFramework = "ISO27001-2022";
const isoSecureCodingIdentifier = "A.8.28";
const missingAuthorizationCweId = "CWE-862";
const doraFramework = "DORA";
const doraIctRiskManagementIdentifier = "Art. 9";
const webVulnerabilityCweIds = new Set(["CWE-79", "CWE-89"]);
const gdprFramework = "GDPR";
const gdprArt32Identifier = "Art. 32";
const cweIdentifierPattern = /^CWE-(\d+)$/u;

function getCanonicalCweNumber(cweId: string): string | undefined {
  const cweIdMatch = cweIdentifierPattern.exec(cweId);
  const cweNumber = cweIdMatch?.[1];
  if (cweNumber === undefined) {
    return undefined;
  }

  return Number.parseInt(cweNumber, 10).toString();
}

function buildCanonicalMitreUrl(cweId: string): string | undefined {
  const canonicalCweNumber = getCanonicalCweNumber(cweId);
  if (canonicalCweNumber === undefined) {
    return undefined;
  }

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
    const canonicalCweNumber = getCanonicalCweNumber(entry.cwe_id);
    const canonicalCweId =
      canonicalCweNumber === undefined ? undefined : `CWE-${canonicalCweNumber}`;

    const canonicalMitreUrl = buildCanonicalMitreUrl(entry.cwe_id);
    if (canonicalMitreUrl !== undefined && entry.mitre_url !== canonicalMitreUrl) {
      context.addIssue({
        code: "custom",
        path: ["mitre_url"],
        message: `${entry.cwe_id} requires canonical MITRE URL ${canonicalMitreUrl}`,
      });
    }

    if (canonicalCweId === classicBufferOverflowCweId) {
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

    if (canonicalCweId === missingAuthorizationCweId) {
      const hasDoraReference = entry.references.some(
        (reference) =>
          reference.framework === doraFramework &&
          reference.identifier === doraIctRiskManagementIdentifier,
      );

      if (!hasDoraReference) {
        context.addIssue({
          code: "custom",
          path: ["references"],
          message: `${missingAuthorizationCweId} requires ${doraFramework} reference ${doraIctRiskManagementIdentifier}`,
        });
      }
    }

    if (canonicalCweId !== undefined && webVulnerabilityCweIds.has(canonicalCweId)) {
      const hasGdprArt32Reference = entry.references.some(
        (reference) =>
          reference.framework === gdprFramework && reference.identifier === gdprArt32Identifier,
      );

      if (!hasGdprArt32Reference) {
        context.addIssue({
          code: "custom",
          path: ["references"],
          message: `${entry.cwe_id} requires ${gdprFramework} reference ${gdprArt32Identifier}`,
        });
      }
    }
  });
export type ComplianceMappingEntry = z.infer<typeof ComplianceMappingEntrySchema>;
