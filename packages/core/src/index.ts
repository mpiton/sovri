// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Re-export Zod so every Sovri workspace member binds to a single instance.
export { z } from "zod";

export {
  CategorySchema,
  FindingSchema,
  SeveritySchema,
  type Category,
  type Finding,
  type Severity,
} from "./types/Finding.js";

export { ReviewSchema, type Review } from "./types/Review.js";

export {
  DiffSchema,
  FileChangeSchema,
  FileChangeStatusSchema,
  PullRequestSchema,
  type Diff,
  type FileChange,
  type FileChangeStatus,
  type PullRequest,
} from "./types/PullRequest.js";

export { computeSeverityRank, type SeverityRank } from "./helpers/severity.js";
export { groupFindingsByFile } from "./helpers/grouping.js";
export { applyIgnoreRules } from "./helpers/ignore-rules.js";
