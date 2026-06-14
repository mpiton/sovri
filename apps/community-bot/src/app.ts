// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import type { ApplicationFunctionOptions, Probot } from "probot";

import { createLogger } from "@sovri/observability";

import {
  fetchAppSubscribedEvents,
  validateWebhookSubscriptions,
} from "./boot/webhook-subscriptions.js";
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
  // Fire-and-forget boot self-check: it never throws and must not block handler registration.
  void runWebhookSubscriptionSelfCheck(probot);
}

function runWebhookSubscriptionSelfCheck(probot: Probot): Promise<void> {
  const logger = createLogger("community-bot.boot");
  return validateWebhookSubscriptions({
    fetchSubscribedEvents: async () => fetchAppSubscribedEvents(await probot.auth()),
    logger,
  });
}
