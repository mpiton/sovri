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

const requiredReferencesByCwe: Record<string, readonly RequiredReference[]> = {
  "CWE-200": [{ framework: "GDPR", identifier: "Art. 32" }],
  "CWE-284": [
    { framework: "GDPR", identifier: "Art. 32" },
    { framework: "DORA", identifier: "Art. 9" },
  ],
  "CWE-639": [
    { framework: "GDPR", identifier: "Art. 32" },
    { framework: "ISO27001-2022", identifier: "A.5.15" },
  ],
  "CWE-770": [
    { framework: "DORA", identifier: "Art. 9" },
    { framework: "NIS2", identifier: "Art. 21(2)(b)" },
  ],
  "CWE-863": [
    { framework: "GDPR", identifier: "Art. 32" },
    { framework: "DORA", identifier: "Art. 9" },
  ],
  "CWE-918": [{ framework: "AI-ACT", identifier: "Art. 12" }],
};

function hasReference(references: readonly ReferenceLike[], required: RequiredReference): boolean {
  return references.some(
    (reference) =>
      reference.framework === required.framework && reference.identifier === required.identifier,
  );
}

export function findMissingRequiredReference(
  canonicalCweId: string,
  references: readonly ReferenceLike[],
): RequiredReference | undefined {
  const required = requiredReferencesByCwe[canonicalCweId];
  if (required === undefined) {
    return undefined;
  }

  return required.find((candidate) => !hasReference(references, candidate));
}

const FLAGSHIP_CREDENTIALS_CWE_ID = "CWE-798";

const flagshipRequiredReferences: readonly RequiredReference[] = [
  { framework: "OWASP-TOP10-2021", identifier: "A07:2021" },
  { framework: "GDPR", identifier: "Art. 32" },
  { framework: "ISO27001-2022", identifier: "A.5.17" },
  { framework: "DORA", identifier: "Art. 9" },
  { framework: "NIS2", identifier: "Art. 21(2)(i)" },
];

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

  const missingFrameworks = flagshipRequiredReferences
    .filter((required) => !hasReference(entry.references, required))
    .map((required) => required.framework);

  return missingFrameworks.length === 0
    ? undefined
    : { cwe_id: FLAGSHIP_CREDENTIALS_CWE_ID, missingFrameworks };
}
