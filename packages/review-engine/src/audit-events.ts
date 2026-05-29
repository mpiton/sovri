// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createHash } from "node:crypto";

import type { AuditTrailLogicalEvent, AuditTrailSink } from "@sovri/compliance";
import type { Finding, PullRequest } from "@sovri/core";
import type { LLMProvider } from "@sovri/llm-providers";
import type { Logger } from "@sovri/observability";

const ErrorMessageMaxLength = 500;

/**
 * The PII-free taxonomy carried by a `review.failed` event's `error_code`. Drawn
 * from the failure kind, never from user content, so the audit code is stable and
 * greppable.
 */
type AuditFailureCode = "limit_exceeded" | "provider_error" | "parse_error" | "unexpected_error";

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
  systemPrompt: string,
  userPrompt: string,
  tokensIn: number,
  tokensOut: number,
): AuditTrailLogicalEvent {
  return {
    ts: new Date().toISOString(),
    event: "llm.called",
    prompt_hash: hashPrompt(systemPrompt, userPrompt),
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

export function reviewFailedEvent(code: AuditFailureCode, message: string): AuditTrailLogicalEvent {
  return {
    ts: new Date().toISOString(),
    event: "review.failed",
    error_code: code,
    error_message: sanitizeErrorMessage(message),
  };
}

function sanitizeErrorMessage(message: string): string {
  return message.length <= ErrorMessageMaxLength
    ? message
    : message.slice(0, ErrorMessageMaxLength);
}

function hashPrompt(systemPrompt: string, userPrompt: string): string {
  return `sha256:${createHash("sha256").update(`${systemPrompt}\n${userPrompt}`).digest("hex")}`;
}
