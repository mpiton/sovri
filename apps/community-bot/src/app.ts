// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ApplicationFunctionOptions, Probot } from "probot";

import { registerCommandHandlers } from "./commands/index.js";
import { registerGitHubAdapters } from "./github/index.js";
import { registerWebhookHandlers } from "./handlers/index.js";
import { registerOperationalRoutes } from "./operational-routes.js";

export type { CommunityBotDependencies } from "./types.js";

export function app(probot: Probot, options: ApplicationFunctionOptions): void {
  registerOperationalRoutes(options.addHandler);
  registerGitHubAdapters(probot);
  registerCommandHandlers(probot);
  registerWebhookHandlers(probot);
}
