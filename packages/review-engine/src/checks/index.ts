// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z, type Review } from "@sovri/core";

import { computeVerdict } from "../walkthrough/verdict.js";

export type CheckRunName = "Sovri / review" | "Sovri / provenance" | "Sovri / license-scan";

export type CheckRunStatus = "completed";

export type CheckRunConclusion = "success" | "neutral" | "failure";

export interface CheckRunDescriptor {
  readonly name: CheckRunName;
  readonly status: CheckRunStatus;
  readonly conclusion: CheckRunConclusion;
  readonly title: string;
  readonly summary: string;
}

export type ReviewWithCheckRunDescriptors = Review & {
  readonly check_run_descriptors: readonly CheckRunDescriptor[];
};

type ReviewCheckDescriptorInput = Pick<Review, "findings" | "status">;

export const MapChecksInputSchema = z
  .object({
    verdict: z
      .object({
        kind: z.enum(["approve", "comment", "request-changes"]),
        label: z.string().trim().min(1),
      })
      .strict(),
    findingCount: z.number().int().nonnegative(),
    hasSignedAuditEntry: z.boolean(),
    // True once at least one SARIF report was ingested for this review; flips the
    // license-scan row off its v1.0 placeholder. Defaults false (no scan consumed).
    sarifIngested: z.boolean().default(false),
  })
  .strict();

export type MapChecksInput = z.infer<typeof MapChecksInputSchema>;

const ReviewConclusionByVerdictKind: Record<MapChecksInput["verdict"]["kind"], CheckRunConclusion> =
  {
    approve: "success",
    comment: "neutral",
    "request-changes": "failure",
  };

function formatFindingSummary(findingCount: number): string {
  const noun = findingCount === 1 ? "finding" : "findings";
  return `${String(findingCount)} ${noun} found.`;
}

function mapProvenanceDescriptor(hasSignedAuditEntry: boolean): CheckRunDescriptor {
  if (hasSignedAuditEntry) {
    return {
      name: "Sovri / provenance",
      status: "completed",
      conclusion: "success",
      title: "Sovri provenance verified",
      summary: "A signed audit entry is attached.",
    };
  }

  return {
    name: "Sovri / provenance",
    status: "completed",
    conclusion: "neutral",
    title: "Sovri provenance unavailable",
    summary: "No signed audit trail is attached.",
  };
}

export function mapChecks(input: unknown): readonly CheckRunDescriptor[] {
  const parsedInput = MapChecksInputSchema.parse(input);
  return [
    {
      name: "Sovri / review",
      status: "completed",
      conclusion: ReviewConclusionByVerdictKind[parsedInput.verdict.kind],
      title: "Sovri review completed",
      summary: formatFindingSummary(parsedInput.findingCount),
    },
    mapProvenanceDescriptor(parsedInput.hasSignedAuditEntry),
    mapLicenseScanDescriptor(parsedInput.sarifIngested),
  ];
}

// The license-scan row doubles as the scanner-ingestion row: when a SARIF report
// was ingested for this review its conclusion turns success, otherwise it stays
// the neutral v1.0 placeholder.
function mapLicenseScanDescriptor(sarifIngested: boolean): CheckRunDescriptor {
  if (sarifIngested) {
    return {
      name: "Sovri / license-scan",
      status: "completed",
      conclusion: "success",
      title: "Sovri SARIF scan ingested",
      summary: "Scanner findings were merged into the review.",
    };
  }

  return {
    name: "Sovri / license-scan",
    status: "completed",
    conclusion: "neutral",
    title: "Sovri license scan pending",
    summary: "License scan available in v1.0",
  };
}

export interface CheckRunDescriptorOptions {
  readonly sarifIngested?: boolean;
}

export function buildReviewCheckDescriptors(
  review: ReviewCheckDescriptorInput,
  options: CheckRunDescriptorOptions = {},
): readonly CheckRunDescriptor[] {
  return mapChecks({
    verdict: computeReviewVerdict(review),
    findingCount: review.findings.length,
    hasSignedAuditEntry: reviewHasSignedAuditEntry(review),
    sarifIngested: options.sarifIngested ?? false,
  });
}

export function attachCheckRunDescriptors(
  review: Review,
  options: CheckRunDescriptorOptions = {},
): ReviewWithCheckRunDescriptors {
  return {
    ...review,
    check_run_descriptors: buildReviewCheckDescriptors(review, options),
  };
}

function computeReviewVerdict(review: ReviewCheckDescriptorInput): MapChecksInput["verdict"] {
  if (review.status === "failed") {
    return { kind: "request-changes", label: "Review failed" };
  }

  return computeVerdict(review.findings);
}

function reviewHasSignedAuditEntry(review: ReviewCheckDescriptorInput): boolean {
  const provenance = Reflect.get(review, "provenance");
  if (!isJsonObject(provenance)) {
    return false;
  }

  const signedAuditEntry = Reflect.get(provenance, "signed_audit_entry");
  return typeof signedAuditEntry === "string" && signedAuditEntry.trim().length > 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
