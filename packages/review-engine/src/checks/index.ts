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
    {
      name: "Sovri / license-scan",
      status: "completed",
      conclusion: "neutral",
      title: "Sovri license scan pending",
      summary: "License scan available in v1.0",
    },
  ];
}

export function buildReviewCheckDescriptors(
  review: Pick<Review, "findings">,
): readonly CheckRunDescriptor[] {
  return mapChecks({
    verdict: computeVerdict(review.findings),
    findingCount: review.findings.length,
    hasSignedAuditEntry: false,
  });
}

export function attachCheckRunDescriptors(review: Review): ReviewWithCheckRunDescriptors {
  return {
    ...review,
    check_run_descriptors: buildReviewCheckDescriptors(review),
  };
}
