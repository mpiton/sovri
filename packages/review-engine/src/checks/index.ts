// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Verdict } from "../walkthrough/index.js";

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

export interface MapChecksInput {
  readonly verdict: Verdict;
  readonly findingCount: number;
  readonly hasSignedAuditEntry: boolean;
}

export function mapChecks(input: MapChecksInput): readonly CheckRunDescriptor[] {
  void input;
  return [];
}
