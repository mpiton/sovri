// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "@sovri/core";

const SourceMetadataSchema = z.object({
  description: z.string().optional(),
  url: z.string().optional(),
});

export const FrameworkCatalogSchema = z
  .object({
    id: z.string().optional(),
    jurisdiction: z.string().optional(),
    name: z.string().optional(),
    scope: z.string().optional(),
    source: SourceMetadataSchema.optional(),
    version: z.string().optional(),
  })
  .strict();
export type FrameworkCatalog = z.infer<typeof FrameworkCatalogSchema>;

export const ControlCatalogSchema = z
  .object({
    applicability: z.string().optional(),
    description: z.string().optional(),
    id: z.string().optional(),
    remediation: z.string().optional(),
    severity: z.string().optional(),
    title: z.string().optional(),
    weight: z.number().optional(),
  })
  .strict();
export type ControlCatalog = z.infer<typeof ControlCatalogSchema>;

export const RuleCatalogSchema = z
  .object({
    expected_evidence: z.string().optional(),
    execution_policy: z.string().optional(),
    id: z.string().optional(),
    input_scope: z.string().optional(),
    result_policy: z.string().optional(),
    rule_type: z.string().optional(),
  })
  .strict();
export type RuleCatalog = z.infer<typeof RuleCatalogSchema>;

const FrameworkReferenceCatalogSchema = z.object({
  framework: z.string().optional(),
  reference: z.string().optional(),
  version: z.string().optional(),
});

export const MappingCatalogSchema = z
  .object({
    control_id: z.string().optional(),
    framework_references: z.array(FrameworkReferenceCatalogSchema).optional(),
  })
  .strict();
export type MappingCatalog = z.infer<typeof MappingCatalogSchema>;

export const CatalogSchemasByFile = {
  "control.yaml": ControlCatalogSchema,
  "framework.yaml": FrameworkCatalogSchema,
  "mapping.yaml": MappingCatalogSchema,
  "rule.yaml": RuleCatalogSchema,
} as const;
