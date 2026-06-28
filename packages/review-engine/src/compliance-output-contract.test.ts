// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import * as reviewEngine from "./index.js";

const cataloguedControl = {
  framework_id: "GDPR/ePrivacy",
  control_id: "gdpr-eprivacy-consent-tracking",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
} as const;
const catalog = [cataloguedControl];
const sourceUrl = cataloguedControl.source_url;
const remediationGuidance = "Delay non-essential analytics until consent is recorded";

describe("Non-CWE compliance gaps have a complete output contract", () => {
  it.each([
    {
      status: "WARNING",
      severity: "major",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
    },
    {
      status: "FAIL",
      severity: "blocker",
      evidence: "web/app/layout.tsx:18 initializes Google Tag Manager",
    },
  ])(
    "accepts a non-CWE compliance gap with every required output field",
    ({ status, severity, evidence }) => {
      // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
      // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
      // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
      // Given a ComplianceGap "gap-tracker-consent-001"
      // And the gap has framework id "GDPR/ePrivacy"
      // And the gap has control id "gdpr-eprivacy-consent-tracking"
      // And the gap has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
      // And the gap has evidence "<evidence>"
      // And the gap has status "<status>"
      // And the gap has severity "<severity>"
      // And the gap has remediation guidance "Delay non-essential analytics until consent is recorded"
      // And the gap has no CWE
      const gap = {
        id: "gap-tracker-consent-001",
        ...cataloguedControl,
        evidence,
        status,
        severity,
        remediation_guidance: remediationGuidance,
      };

      // When the compliance output contract is validated
      const validation = expectPlainObject(
        callExport("validateComplianceGapOutput", gap, { catalog }),
      );
      const serialized = expectPlainObject(Reflect.get(validation, "serialized"));

      // Then the gap is accepted as a ComplianceGap
      expect(Reflect.get(validation, "publishable")).toBe(true);
      expect(Reflect.get(serialized, "type")).toBe("ComplianceGap");

      // And the serialized gap contains framework id, control id, source URL, evidence, status, severity, and remediation guidance
      expect(Reflect.get(serialized, "framework_id")).toBe("GDPR/ePrivacy");
      expect(Reflect.get(serialized, "control_id")).toBe("gdpr-eprivacy-consent-tracking");
      expect(Reflect.get(serialized, "source_url")).toBe(sourceUrl);
      expect(Reflect.get(serialized, "evidence")).toBe(evidence);
      expect(Reflect.get(serialized, "status")).toBe(status);
      expect(Reflect.get(serialized, "severity")).toBe(severity);
      expect(Reflect.get(serialized, "remediation_guidance")).toBe(remediationGuidance);

      // And the serialized gap does not require a CWE field
      expect(Object.hasOwn(serialized, "cwe")).toBe(false);
    },
  );

  it.each([
    {
      framework_id: "",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: sourceUrl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
      missingField: "framework id",
    },
    {
      framework_id: "GDPR/ePrivacy",
      control_id: "",
      source_url: sourceUrl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
      missingField: "control id",
    },
    {
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: "",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
      missingField: "source URL",
    },
    {
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: sourceUrl,
      evidence: "",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
      missingField: "evidence",
    },
    {
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: sourceUrl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "",
      severity: "major",
      remediation_guidance: remediationGuidance,
      missingField: "status",
    },
    {
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: sourceUrl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "",
      remediation_guidance: remediationGuidance,
      missingField: "severity",
    },
    {
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: sourceUrl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: "",
      missingField: "remediation guidance",
    },
  ])(
    "rejects a non-CWE gap missing $missingField",
    ({
      framework_id,
      control_id,
      source_url,
      evidence,
      status,
      severity,
      remediation_guidance,
      missingField,
    }) => {
      // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
      // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
      // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
      // Given a ComplianceGap "gap-tracker-consent-002"
      // And the gap has framework id "<framework_id>"
      // And the gap has control id "<control_id>"
      // And the gap has source URL "<source_url>"
      // And the gap has evidence "<evidence>"
      // And the gap has status "<status>"
      // And the gap has severity "<severity>"
      // And the gap has remediation guidance "<remediation>"
      const gap = {
        id: "gap-tracker-consent-002",
        framework_id,
        control_id,
        source_url,
        evidence,
        status,
        severity,
        remediation_guidance,
      };

      // When the compliance output contract is validated
      const validation = expectPlainObject(
        callExport("validateComplianceGapOutput", gap, { catalog }),
      );

      // Then the gap is rejected for published output
      expect(Reflect.get(validation, "publishable")).toBe(false);

      // And the rejection identifies "<missing_field>" as missing
      expect(Reflect.get(validation, "missing_field")).toBe(missingField);
    },
  );

  it("serializes a non-CWE compliance gap separately from the Finding contract", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // Given a ComplianceGap "gap-tracker-consent-003" with control id "gdpr-eprivacy-consent-tracking"
    // And the gap has no CWE
    const gap = {
      id: "gap-tracker-consent-003",
      ...cataloguedControl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
    };

    // When the compliance output contract is serialized
    const serialized = expectPlainObject(
      callExport("serializeComplianceGapOutput", gap, { catalog }),
    );

    // Then the serialized object type is "ComplianceGap"
    expect(Reflect.get(serialized, "type")).toBe("ComplianceGap");

    // And the serialized object is not serialized as a "Finding"
    expect(Reflect.get(serialized, "type")).not.toBe("Finding");

    // And no "category: compliance" source model is required
    expect(Object.hasOwn(serialized, "category")).toBe(false);
  });

  it("rejects a non-CWE gap whose source URL is not catalog-backed", () => {
    const gap = {
      id: "gap-tracker-consent-014",
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: "https://example.com/fake",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
    };

    const validation = expectPlainObject(
      callExport("validateComplianceGapOutput", gap, { catalog }),
    );

    expect(Reflect.get(validation, "publishable")).toBe(false);
    expect(Reflect.get(validation, "missing_field")).toBe("catalogued control reference");
  });

  it("rejects a non-CWE gap with a provided blank id", () => {
    const gap = {
      id: " ",
      ...cataloguedControl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
    };

    const validation = expectPlainObject(
      callExport("validateComplianceGapOutput", gap, { catalog }),
    );

    expect(Reflect.get(validation, "publishable")).toBe(false);
    expect(Reflect.get(validation, "missing_field")).toBe("id: must not be blank");
  });

  it("rejects a CWE-bearing Finding-shaped input instead of stripping Finding fields", () => {
    const gap = {
      id: "gap-tracker-consent-015",
      ...cataloguedControl,
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
      cwe: "CWE-79",
      category: "security",
    };

    const validation = expectPlainObject(
      callExport("validateComplianceGapOutput", gap, { catalog }),
    );

    expect(Reflect.get(validation, "publishable")).toBe(false);
    expect(Reflect.get(validation, "missing_field")).toEqual(expect.stringContaining("cwe"));
  });

  it("throws a typed validation error when serializing an unpublishable gap", () => {
    // Given a non-CWE gap whose source URL is not catalog-backed
    const gap = {
      id: "gap-tracker-consent-016",
      framework_id: "GDPR/ePrivacy",
      control_id: "gdpr-eprivacy-consent-tracking",
      source_url: "https://example.com/fake",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
      remediation_guidance: remediationGuidance,
    };

    // When the unpublishable gap is serialized
    let thrown: unknown;
    try {
      callExport("serializeComplianceGapOutput", gap, { catalog });
    } catch (error) {
      thrown = error;
    }

    // Then it throws the typed validation error carrying the non-publishable payload
    const error = expectPlainObject(thrown);
    expect(Reflect.get(error, "name")).toBe("ComplianceGapOutputValidationError");
    const validation = expectPlainObject(Reflect.get(error, "validation"));
    expect(Reflect.get(validation, "publishable")).toBe(false);
    expect(Reflect.get(validation, "missing_field")).toBe("catalogued control reference");
  });
});

function callExport(name: string, ...args: readonly unknown[]): unknown {
  const exported: unknown = Reflect.get(reviewEngine, name);
  expect(exported, `${name} export is missing`).toBeTypeOf("function");

  if (typeof exported !== "function") {
    throw new TypeError(`${name} export is not callable`);
  }

  return Reflect.apply(exported, undefined, args);
}

function expectPlainObject(value: unknown): object {
  expect(value).toEqual(expect.any(Object));

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a plain object");
  }

  return value;
}
