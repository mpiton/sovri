// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Probot } from "probot";

export {
  postReview,
  ReviewPostError,
  validatePullRequestReviewRequest,
  WALKTHROUGH_MARKER,
} from "./comment-poster.js";
export type {
  CommentPosterOctokit,
  PullRequestReviewRequest,
  ReviewPostInput,
} from "./comment-poster.js";

export function registerGitHubAdapters(_app: Probot): void {
  // GitHub API adapters are added by focused review workflow scenarios.
}
