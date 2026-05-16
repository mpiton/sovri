// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, type Finding } from "@sovri/core";
import { v4 as uuidv4 } from "uuid";

import { LLMResponseSchema, type LLMRawFinding } from "./schema.js";

export function parseLLMResponse(json: unknown): Finding[] {
  const response = LLMResponseSchema.parse(json);
  return response.findings.map(toFinding);
}

function toFinding(finding: LLMRawFinding): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    severity: finding.severity,
    category: finding.category,
    file: finding.file,
    line_start: finding.line_start,
    line_end: finding.line_end,
    title: finding.title,
    body: finding.body,
    suggestion: toSuggestion(finding),
    source: "llm",
    confidence: finding.confidence,
    cwe: finding.cwe,
  });
}

function toSuggestion(finding: LLMRawFinding): Finding["suggestion"] {
  if (finding.suggested_code === undefined || finding.suggested_code === null) {
    return undefined;
  }

  return {
    code: finding.suggested_code,
    committable: isCommittableSuggestion(finding),
  };
}

function isCommittableSuggestion(finding: LLMRawFinding): boolean {
  return (
    finding.line_start === finding.line_end &&
    finding.suggested_code !== undefined &&
    finding.suggested_code !== null &&
    finding.suggested_code.trim().length > 0 &&
    !finding.suggested_code.includes("\n") &&
    !finding.suggested_code.includes("\r")
  );
}
