// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createLogger } from "@sovri/observability";
import type { Probot } from "probot";

const logger = createLogger("community-bot.webhooks");

export function registerWebhookHandlers(app: Probot): void {
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    logger.info(
      {
        action: context.payload.action,
        deliveryId: context.id,
        event: context.name,
      },
      "Received pull request webhook",
    );
  });
}
