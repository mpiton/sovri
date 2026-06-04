// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createHash } from "node:crypto";

import type { AuditTrailLogicalEvent, AuditTrailSink } from "@sovri/compliance";
import type { Finding, PullRequest } from "@sovri/core";
import type { LLMProvider } from "@sovri/llm-providers";
import type { Logger } from "@sovri/observability";

/**
 * The PII-free taxonomy carried by a `review.failed` event's `error_code`. Drawn
 * from the failure kind, never from user content, so the audit code is stable and
 * greppable.
 */
type AuditFailureCode = "limit_exceeded" | "provider_error" | "parse_error" | "unexpected_error";

// Fixed, content-free `error_message` per code. Raw provider / exception text (which can
// echo prompt or diff content) is NEVER written to the signed trail — it stays in the
// returned Review and the logs. The trail records only the failure category.
const AuditFailureMessages: Record<AuditFailureCode, string> = {
  limit_exceeded: "Pull request exceeds configured review limits",
  provider_error: "LLM provider call failed",
  parse_error: "LLM response failed schema validation",
  unexpected_error: "Unexpected error during review",
};

/**
 * Domain separator for prompt digests so this SHA-256 namespace cannot collide
 * with other length-delimited hashes that may use the same prompt bytes.
 */
const PromptHashDomain = "sovri.review-engine.prompt-sha256.v1";

/**
 * Append one unsigned logical event to an injected sink. An audit failure is logged
 * and swallowed: the trail is best-effort observability and must never break the
 * business review.
 */
export async function emitAuditEvent(
  sink: AuditTrailSink | undefined,
  event: AuditTrailLogicalEvent,
  logger?: Logger,
): Promise<void> {
  if (sink === undefined) {
    return;
  }

  try {
    await sink.append(event);
  } catch (error) {
    logger?.error({ err: error, event: event.event }, "Audit trail append failed");
  }
}

export function reviewStartedEvent(
  pullRequest: PullRequest,
  provider: LLMProvider,
): AuditTrailLogicalEvent {
  return {
    ts: new Date().toISOString(),
    event: "review.started",
    pr_id: pullRequest.number,
    commit_sha: pullRequest.head_sha,
    llm_provider: provider.name,
    llm_model: provider.model,
  };
}

export function llmCalledEvent(
  promptSha256: string,
  tokensIn: number,
  tokensOut: number,
): AuditTrailLogicalEvent {
  return {
    ts: new Date().toISOString(),
    event: "llm.called",
    prompt_hash: `sha256:${promptSha256}`,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  };
}

/**
 * Build a `finding.created` event for a final finding. Returns `undefined` for a
 * finding with no `audit_reference`: such a finding cannot be referenced in the
 * trail, so it is not recorded. Findings produced by the review path always carry
 * one, so the emitted count matches `review.findings.length`.
 */
export function findingCreatedEvent(finding: Finding): AuditTrailLogicalEvent | undefined {
  if (finding.audit_reference === undefined) {
    return undefined;
  }

  return {
    ts: new Date().toISOString(),
    event: "finding.created",
    audit_reference: finding.audit_reference,
    severity: finding.severity,
    compliance_references: finding.compliance_references.map(
      (reference) => `${reference.framework}:${reference.identifier}`,
    ),
    ...(finding.cwe === undefined ? {} : { cwe: finding.cwe }),
  };
}

export function reviewCompletedEvent(): AuditTrailLogicalEvent {
  return { ts: new Date().toISOString(), event: "review.completed" };
}

export function reviewFailedEvent(code: AuditFailureCode): AuditTrailLogicalEvent {
  return {
    ts: new Date().toISOString(),
    event: "review.failed",
    error_code: code,
    error_message: AuditFailureMessages[code],
  };
}

export function computePromptSha256(systemPrompt: string, userPrompt: string): string {
  const hash = createHash("sha256");
  updateLengthDelimitedHashPart(hash, PromptHashDomain);
  updateLengthDelimitedHashPart(hash, systemPrompt);
  updateLengthDelimitedHashPart(hash, userPrompt);

  return hash.digest("hex");
}

function updateLengthDelimitedHashPart(hash: ReturnType<typeof createHash>, value: string): void {
  hash.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8");
  hash.update(value, "utf8");
  hash.update(";", "utf8");
}
