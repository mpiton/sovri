// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "zod";

const RequiredStringSchema = z.string().trim().min(1);
const SourceUrlSchema = z.string().trim().url();

const ComplianceGapInputSchema = z.strictObject({
  id: RequiredStringSchema.optional(),
  framework_id: RequiredStringSchema,
  control_id: RequiredStringSchema,
  source_url: SourceUrlSchema,
  evidence: RequiredStringSchema,
  status: z.enum(["WARNING", "FAIL"]),
  severity: z.enum(["blocker", "major", "minor", "info", "nitpick"]),
  remediation_guidance: RequiredStringSchema,
});

type ComplianceGapInput = z.infer<typeof ComplianceGapInputSchema>;
type ComplianceGapRequiredField = Exclude<keyof ComplianceGapInput, "id">;

const ComplianceGapRequiredFieldLabels = {
  framework_id: "framework id",
  control_id: "control id",
  source_url: "source URL",
  evidence: "evidence",
  status: "status",
  severity: "severity",
  remediation_guidance: "remediation guidance",
} satisfies Record<ComplianceGapRequiredField, string>;

export const ComplianceControlReferenceSchema = z.strictObject({
  framework_id: RequiredStringSchema,
  control_id: RequiredStringSchema,
  source_url: SourceUrlSchema,
});

export type ComplianceControlReference = z.infer<typeof ComplianceControlReferenceSchema>;

export interface ComplianceGapOutputOptions {
  readonly catalog: readonly ComplianceControlReference[];
}

export const ComplianceGapOutputSchema = z.strictObject({
  type: z.literal("ComplianceGap"),
  framework_id: RequiredStringSchema,
  control_id: RequiredStringSchema,
  source_url: SourceUrlSchema,
  evidence: RequiredStringSchema,
  status: z.enum(["WARNING", "FAIL"]),
  severity: z.enum(["blocker", "major", "minor", "info", "nitpick"]),
  remediation_guidance: RequiredStringSchema,
});

export type ComplianceGapOutput = z.infer<typeof ComplianceGapOutputSchema>;

export type ComplianceGapOutputValidation =
  | {
      readonly publishable: true;
      readonly serialized: ComplianceGapOutput;
    }
  | {
      readonly publishable: false;
      readonly missing_field: string;
    };

export class ComplianceGapOutputValidationError extends Error {
  constructor(public readonly validation: ComplianceGapOutputValidation) {
    super("Compliance gap output is not publishable");
    this.name = "ComplianceGapOutputValidationError";
  }
}

export function validateComplianceGapOutput(
  input: unknown,
  options: ComplianceGapOutputOptions,
): ComplianceGapOutputValidation {
  const missingField = findMissingRequiredField(input);

  if (missingField !== undefined) {
    return { publishable: false, missing_field: missingField };
  }

  const parsed = ComplianceGapInputSchema.safeParse(input);

  if (!parsed.success) {
    return { publishable: false, missing_field: findSchemaFieldLabel(parsed.error.issues) };
  }

  if (!isCataloguedControlReference(parsed.data, options.catalog)) {
    return { publishable: false, missing_field: "catalogued control reference" };
  }

  return { publishable: true, serialized: buildOutput(parsed.data) };
}

export function serializeComplianceGapOutput(
  input: unknown,
  options: ComplianceGapOutputOptions,
): ComplianceGapOutput {
  const validation = validateComplianceGapOutput(input, options);

  if (!validation.publishable) {
    throw new ComplianceGapOutputValidationError(validation);
  }

  return validation.serialized;
}

function buildOutput(input: ComplianceGapInput): ComplianceGapOutput {
  return {
    type: "ComplianceGap",
    framework_id: input.framework_id,
    control_id: input.control_id,
    source_url: input.source_url,
    evidence: input.evidence,
    status: input.status,
    severity: input.severity,
    remediation_guidance: input.remediation_guidance,
  };
}

function findMissingRequiredField(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return "framework id";
  }

  if (typeof input.id === "string" && input.id.trim().length === 0) {
    return "id: must not be blank";
  }

  for (const property of ComplianceGapInputSchema.keyof().options) {
    if (!isRequiredFieldProperty(property)) {
      continue;
    }

    const value = input[property];

    if (typeof value !== "string" || value.trim().length === 0) {
      return ComplianceGapRequiredFieldLabels[property];
    }
  }

  return undefined;
}

function findSchemaFieldLabel(issues: readonly z.core.$ZodIssue[]): string {
  for (const issue of issues) {
    const pathItem = issue.path[0];

    if (typeof pathItem === "string" && isRequiredFieldProperty(pathItem)) {
      return ComplianceGapRequiredFieldLabels[pathItem];
    }
  }

  const firstIssue = issues[0];

  if (firstIssue === undefined) {
    return "invalid compliance gap output";
  }

  const path = firstIssue.path.map(String).join(".");

  return path.length === 0 ? firstIssue.message : `${path}: ${firstIssue.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequiredFieldProperty(property: string): property is ComplianceGapRequiredField {
  return Object.hasOwn(ComplianceGapRequiredFieldLabels, property);
}

function isCataloguedControlReference(
  gap: ComplianceGapInput,
  catalog: readonly ComplianceControlReference[],
): boolean {
  return catalog.some(
    (reference) =>
      reference.framework_id === gap.framework_id &&
      reference.control_id === gap.control_id &&
      reference.source_url === gap.source_url,
  );
}
