// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, type Finding, type z } from "@sovri/core";
import { v4 as uuidv4 } from "uuid";

import { LLMResponseSchema, type LLMRawFinding } from "./schema.js";
import { isSyntacticallySane } from "./syntax-sanity.js";

export interface LLMResponseParseErrorOptions {
  readonly cause?: unknown;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
}

export class LLMResponseParseError extends Error {
  public override readonly name = "LLMResponseParseError";
  public readonly issues?: ReadonlyArray<z.core.$ZodIssue>;

  public constructor(message: string, options: LLMResponseParseErrorOptions = {}) {
    super(message, errorOptions(options.cause));

    if (options.issues !== undefined) {
      this.issues = [...options.issues];
    }
  }
}

export function parseLLMResponse(json: unknown): Finding[] {
  const parsedJson = parseJsonInput(json);
  const result = LLMResponseSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new LLMResponseParseError("Unable to parse LLM response", {
      cause: result.error,
      issues: result.error.issues,
    });
  }

  const response = result.data;
  return response.findings.map(toFinding);
}

function parseJsonInput(json: unknown): unknown {
  if (typeof json !== "string") {
    return json;
  }

  try {
    const parsedJson: unknown = JSON.parse(json);
    return parsedJson;
  } catch (error) {
    throw new LLMResponseParseError("Unable to parse LLM response", {
      cause: error,
    });
  }
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

  if (finding.suggested_code.length > 0 && finding.suggested_code.trim().length === 0) {
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
    !finding.suggested_code.includes("\r") &&
    isSyntacticallySane(finding.suggested_code)
  );
}

function errorOptions(cause: unknown): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}
