// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ComplianceFramework } from "./schema.js";

interface RequiredReference {
  readonly framework: ComplianceFramework;
  readonly identifier: string;
}

interface ReferenceLike {
  readonly framework: string;
  readonly identifier: string;
}

const requiredReferenceByCwe: Record<string, RequiredReference> = {
  "CWE-200": { framework: "GDPR", identifier: "Art. 32" },
  "CWE-284": { framework: "DORA", identifier: "Art. 9" },
  "CWE-639": { framework: "ISO27001-2022", identifier: "A.5.15" },
  "CWE-770": { framework: "DORA", identifier: "Art. 9" },
  "CWE-863": { framework: "DORA", identifier: "Art. 9" },
  "CWE-918": { framework: "AI-ACT", identifier: "Art. 12" },
};

export function findMissingRequiredReference(
  canonicalCweId: string,
  references: readonly ReferenceLike[],
): RequiredReference | undefined {
  const required = requiredReferenceByCwe[canonicalCweId];
  if (required === undefined) {
    return undefined;
  }

  const isPresent = references.some(
    (reference) =>
      reference.framework === required.framework && reference.identifier === required.identifier,
  );

  return isPresent ? undefined : required;
}

export const FLAGSHIP_CREDENTIALS_CWE_ID = "CWE-798";

const flagshipRequiredFrameworks = [
  "OWASP-TOP10-2021",
  "GDPR",
  "ISO27001-2022",
  "DORA",
  "NIS2",
] as const satisfies readonly ComplianceFramework[];

export interface FlagshipAuditFailure {
  readonly cwe_id: string;
  readonly missingFrameworks: readonly ComplianceFramework[];
}

export function auditFlagshipCredentials(entry: {
  readonly cwe_id: string;
  readonly references: readonly ReferenceLike[];
}): FlagshipAuditFailure | undefined {
  if (entry.cwe_id !== FLAGSHIP_CREDENTIALS_CWE_ID) {
    return undefined;
  }

  const presentFrameworks = new Set(entry.references.map((reference) => reference.framework));
  const missingFrameworks = flagshipRequiredFrameworks.filter(
    (framework) => !presentFrameworks.has(framework),
  );

  return missingFrameworks.length === 0
    ? undefined
    : { cwe_id: FLAGSHIP_CREDENTIALS_CWE_ID, missingFrameworks };
}
