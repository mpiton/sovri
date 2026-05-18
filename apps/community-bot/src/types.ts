// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { SovriConfig } from "@sovri/config";
import type { Logger } from "@sovri/observability";
import type { ReviewPullRequestOptions } from "@sovri/review-engine";

export type CommunityBotDependencies = {
  readonly config: SovriConfig;
  readonly logger: Logger;
  readonly reviewOptions: ReviewPullRequestOptions;
};
