// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { load as parseYaml } from "js-yaml";

import { z } from "@sovri/core";

export interface CatalogYamlValidationInput {
  readonly file: string;
  readonly frameworkFamily: string;
  readonly relatedControl?: ControlCatalog;
  readonly yaml: string;
}

export interface CatalogYamlValidationIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export type CatalogYamlValidationResult =
  | {
      readonly data: unknown;
      readonly success: true;
    }
  | {
      readonly error: {
        readonly issues: readonly CatalogYamlValidationIssue[];
      };
      readonly success: false;
    };

const SourceMetadataSchema = z.object({
  description: z.string().optional(),
  url: z.string().optional(),
});

const SupportedControlApplicabilities = ["project-wide", "file", "diff"] as const;

export const FrameworkCatalogSchema = z
  .object({
    id: z.string().optional(),
    jurisdiction: z.string().optional(),
    name: z.string().optional(),
    scope: z.string().optional(),
    source: SourceMetadataSchema.optional(),
    version: z.string(),
  })
  .strict();
export type FrameworkCatalog = z.infer<typeof FrameworkCatalogSchema>;

export const ControlCatalogSchema = z
  .object({
    applicability: z.enum(SupportedControlApplicabilities).optional(),
    description: z.string().optional(),
    id: z.string().optional(),
    remediation: z.string(),
    severity: z.string().optional(),
    title: z.string().optional(),
    weight: z.number().optional(),
  })
  .strict();
export type ControlCatalog = z.infer<typeof ControlCatalogSchema>;

const SupportedRuleExecutionTypes = [
  "automatic",
  "static-analysis",
  "manual",
  "evidence-only",
] as const;
const SupportedRuleExecutionTypeList = SupportedRuleExecutionTypes.map((ruleType) =>
  JSON.stringify(ruleType),
).join(", ");
const SupportedRuleExecutionTypeSet = new Set<string>(SupportedRuleExecutionTypes);
const SupportedRuleInputScopes = ["project", "file", "diff"] as const;

function ruleExecutionTypeError(ruleType: string): string {
  if (SupportedRuleExecutionTypeSet.has(ruleType.toLowerCase())) {
    return `rule_type values are case-sensitive; rule_type must be one of ${SupportedRuleExecutionTypeList}`;
  }

  if (ruleType.trimStart() !== ruleType) {
    return `leading whitespace is not trimmed; rule_type must be one of ${SupportedRuleExecutionTypeList}`;
  }

  if (ruleType.trimEnd() !== ruleType) {
    return `trailing whitespace is not trimmed; rule_type must be one of ${SupportedRuleExecutionTypeList}`;
  }

  return `rule_type must be one of ${SupportedRuleExecutionTypeList}`;
}

const RuleExecutionTypeCatalogSchema = z
  .string()
  .superRefine((ruleType, context) => {
    if (SupportedRuleExecutionTypeSet.has(ruleType)) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: ruleExecutionTypeError(ruleType),
    });
  })
  .pipe(z.enum(SupportedRuleExecutionTypes));

export const RuleCatalogSchema = z
  .object({
    expected_evidence: z.string(),
    execution_policy: z.string(),
    id: z.string().optional(),
    input_scope: z.enum(SupportedRuleInputScopes).optional(),
    result_policy: z.string().optional(),
    rule_type: RuleExecutionTypeCatalogSchema,
  })
  .strict();
export type RuleCatalog = z.infer<typeof RuleCatalogSchema>;

const VersionedFrameworkReferencePattern = /^[^:\s]+:[^:\s]+:[^:\s]+$/u;

const VersionedFrameworkReferenceStringSchema = z
  .string()
  .regex(VersionedFrameworkReferencePattern, {
    error: "framework references must include a version",
  });

const FrameworkReferenceCatalogSchema = z.union([
  VersionedFrameworkReferenceStringSchema,
  z.object({
    framework: z.string().optional(),
    reference: z.string().optional(),
    version: z.string().optional(),
  }),
]);

type FrameworkReferenceCatalog = z.infer<typeof FrameworkReferenceCatalogSchema>;

function frameworkReferenceComponents(
  reference: FrameworkReferenceCatalog,
): readonly (string | undefined)[] {
  if (typeof reference === "string") {
    return reference.split(":");
  }

  if (VersionedFrameworkReferencePattern.test(String(reference.reference))) {
    return String(reference.reference).split(":");
  }

  return [reference.framework, reference.version, reference.reference];
}

function frameworkReferenceDeduplicationKey(reference: FrameworkReferenceCatalog): string {
  return JSON.stringify(frameworkReferenceComponents(reference));
}

function frameworkReferenceDescription(reference: FrameworkReferenceCatalog): string {
  if (typeof reference === "string") {
    return reference;
  }

  return frameworkReferenceComponents(reference).join(":");
}

const FrameworkReferenceListCatalogSchema = z
  .array(FrameworkReferenceCatalogSchema)
  .min(1)
  .superRefine((references, context) => {
    const seenReferences = new Set<string>();

    references.forEach((reference, index) => {
      const deduplicationKey = frameworkReferenceDeduplicationKey(reference);

      if (seenReferences.has(deduplicationKey)) {
        context.addIssue({
          code: "custom",
          message: `duplicate framework reference "${frameworkReferenceDescription(reference)}"`,
          path: [index],
        });
        return;
      }

      seenReferences.add(deduplicationKey);
    });
  });

export const MappingCatalogSchema = z
  .object({
    control_id: z.string(),
    framework_references: FrameworkReferenceListCatalogSchema,
  })
  .strict();
export type MappingCatalog = z.infer<typeof MappingCatalogSchema>;

export const CatalogSchemasByFile = {
  "control.yaml": ControlCatalogSchema,
  "framework.yaml": FrameworkCatalogSchema,
  "mapping.yaml": MappingCatalogSchema,
  "rule.yaml": RuleCatalogSchema,
} as const;

function isCatalogSchemaFile(file: string): file is keyof typeof CatalogSchemasByFile {
  return Object.hasOwn(CatalogSchemasByFile, file);
}

function projectWideControlInputScopeIssue(
  rule: RuleCatalog,
  relatedControl: ControlCatalog | undefined,
): CatalogYamlValidationIssue | undefined {
  if (
    relatedControl?.applicability !== "project-wide" ||
    (rule.input_scope !== "file" && rule.input_scope !== "diff")
  ) {
    return undefined;
  }

  return {
    message: "project-wide controls require project-level input scope",
    path: ["input_scope"],
  };
}

export function validateCatalogYaml(
  input: CatalogYamlValidationInput,
): CatalogYamlValidationResult {
  if (input.yaml.trim().length === 0) {
    return {
      error: {
        issues: [
          {
            message: "catalog YAML cannot be empty",
            path: [input.file],
          },
        ],
      },
      success: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(input.yaml, { filename: input.file });
  } catch {
    return {
      error: {
        issues: [
          {
            message: "invalid YAML syntax",
            path: [input.file],
          },
        ],
      },
      success: false,
    };
  }

  if (parsed === null || parsed === undefined) {
    return {
      error: {
        issues: [
          {
            message: "catalog YAML cannot be empty",
            path: [input.file],
          },
        ],
      },
      success: false,
    };
  }

  if (!isCatalogSchemaFile(input.file)) {
    return {
      error: {
        issues: [
          {
            message: `unsupported catalog YAML file "${input.file}"`,
            path: [input.file],
          },
        ],
      },
      success: false,
    };
  }

  const schema = CatalogSchemasByFile[input.file];
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      error: {
        issues: result.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map((segment) =>
            typeof segment === "number" ? segment : String(segment),
          ),
        })),
      },
      success: false,
    };
  }

  if (input.file === "rule.yaml") {
    const projectWideInputScopeIssue = projectWideControlInputScopeIssue(
      result.data as RuleCatalog,
      input.relatedControl,
    );
    if (projectWideInputScopeIssue !== undefined) {
      return {
        error: {
          issues: [projectWideInputScopeIssue],
        },
        success: false,
      };
    }
  }

  return {
    data: result.data,
    success: true,
  };
}
