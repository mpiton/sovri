// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export const compliancePackageName = "@sovri/compliance";

export { getCweMap } from "./mapping/loader.js";
export {
  ComplianceFrameworkSchema,
  ComplianceMappingEntrySchema,
  ComplianceReferenceApplicabilitySchema,
  ComplianceReferenceEntrySchema,
  type ComplianceFramework,
  type ComplianceMappingEntry,
  type ComplianceReferenceApplicability,
  type ComplianceReferenceEntry,
} from "./mapping/schema.js";
