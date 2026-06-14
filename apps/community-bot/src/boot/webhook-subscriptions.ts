// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// Webhook subscription self-check. At boot the bot compares the webhook events its registered
// handlers require against the events the GitHub App is actually subscribed to, so a missing
// subscription (which silently drops @sovri-bot commands) is surfaced instead of failing silently.

/**
 * Compute which of the {@link required} webhook events are not present in {@link subscribed}.
 * Pure set difference, preserving the order of {@link required}.
 */
export function computeMissingWebhookEvents(
  required: readonly string[],
  subscribed: readonly string[],
): readonly string[] {
  const subscribedEvents = new Set(subscribed);
  return required.filter((event) => !subscribedEvents.has(event));
}

// Webhook events the bot's registered handlers require. `pull_request.opened` and
// `pull_request.synchronize` need the `pull_request` event; the `@sovri-bot` command handler
// (`issue_comment.created`) needs the `issue_comment` event. Keep in sync with
// registerWebhookHandlers in ../handlers/index.ts.
export const REQUIRED_WEBHOOK_EVENTS: readonly string[] = ["pull_request", "issue_comment"];

// Minimal logger surface used by the self-check: a single structured warn call. The bot's Pino
// logger satisfies this; tests pass a fake.
export type WebhookSubscriptionLogger = {
  readonly warn: (mergingObject: Record<string, unknown>, message: string) => void;
};

// Minimal app-authenticated Octokit surface: GET /app returns the GitHub App's subscribed events.
export type AppEventsOctokit = {
  readonly request: (
    route: "GET /app",
  ) => Promise<{ readonly data: { readonly events?: readonly string[] } }>;
};

/** Fetch the GitHub App's subscribed webhook events via `GET /app` (app-JWT authenticated). */
export async function fetchAppSubscribedEvents(
  octokit: AppEventsOctokit,
): Promise<readonly string[]> {
  const response = await octokit.request("GET /app");
  return response.data.events ?? [];
}

/**
 * Validate at boot that the GitHub App is subscribed to every webhook event the registered handlers
 * require. Logs a warning naming any missing event, or a warning that the check could not run when
 * the subscribed events cannot be fetched. Always resolves: startup continues regardless.
 */
export async function validateWebhookSubscriptions(deps: {
  readonly fetchSubscribedEvents: () => Promise<readonly string[]>;
  readonly logger: WebhookSubscriptionLogger;
  readonly required?: readonly string[];
}): Promise<void> {
  const required = deps.required ?? REQUIRED_WEBHOOK_EVENTS;

  let subscribed: readonly string[];
  try {
    subscribed = await deps.fetchSubscribedEvents();
  } catch (cause) {
    deps.logger.warn(
      { err: cause },
      "Webhook subscription self-check could not run: failed to fetch the GitHub App's subscribed events. @sovri-bot commands may be silently ignored if a required event is not subscribed.",
    );
    return;
  }

  const missing = computeMissingWebhookEvents(required, subscribed);
  if (missing.length > 0) {
    deps.logger.warn(
      { missingWebhookEvents: missing },
      `GitHub App is not subscribed to required webhook event(s): ${missing.join(", ")}. @sovri-bot commands depending on them will be silently ignored until the subscription is added.`,
    );
  }
}
