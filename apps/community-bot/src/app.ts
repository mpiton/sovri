// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Probot } from "probot";

import { registerCommandHandlers } from "./commands/index.js";
import { registerGitHubAdapters } from "./github/index.js";
import { registerWebhookHandlers } from "./handlers/index.js";

export type { CommunityBotDependencies } from "./types.js";

export default function registerCommunityBot(app: Probot): void {
  registerGitHubAdapters(app);
  registerCommandHandlers(app);
  registerWebhookHandlers(app);
}
