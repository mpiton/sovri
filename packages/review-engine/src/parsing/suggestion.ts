// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding } from "@sovri/core";

import { isSyntacticallySane } from "./syntax-sanity.js";

export type SuggestedCodeFinding = {
  readonly line_start: number;
  readonly line_end: number;
  readonly suggested_code?: string | null | undefined;
};

export function toFindingSuggestion(finding: SuggestedCodeFinding): Finding["suggestion"] {
  if (finding.suggested_code === undefined || finding.suggested_code === null) {
    return undefined;
  }

  if (finding.suggested_code.length > 0 && finding.suggested_code.trim().length === 0) {
    return undefined;
  }

  return {
    code: finding.suggested_code,
    committable: isCommittableSuggestion(finding),
  };
}

function isCommittableSuggestion(finding: SuggestedCodeFinding): boolean {
  return (
    finding.line_start === finding.line_end &&
    finding.suggested_code !== undefined &&
    finding.suggested_code !== null &&
    finding.suggested_code.trim().length > 0 &&
    !finding.suggested_code.includes("\n") &&
    !finding.suggested_code.includes("\r") &&
    isSyntacticallySane(finding.suggested_code)
  );
}
