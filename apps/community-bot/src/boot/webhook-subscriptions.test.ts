// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it, vi } from "vitest";

import { registerWebhookHandlers, type WebhookRegistrar } from "../handlers/index.js";
import {
  type AppEventsOctokit,
  computeMissingWebhookEvents,
  fetchAppSubscribedEvents,
  REQUIRED_WEBHOOK_EVENTS,
  validateWebhookSubscriptions,
} from "./webhook-subscriptions.js";

// Acceptance test for GitHub issue #2578 (bug-2504, rule R-01,
// r01-detect-required-vs-subscribed.feature). At boot the bot determines the set of webhook events
// its registered handlers require, and compares it against the App's actually subscribed events.
// Pure detection kernel: required \ subscribed -> missing. No I/O, no framework adapters.

// Background: the bot's registered handlers require the webhook events "pull_request" and
// "issue_comment".
const REQUIRED: readonly string[] = ["pull_request", "issue_comment"];

describe("computeMissingWebhookEvents (R-01)", () => {
  it("reports no missing events when all required events are subscribed", () => {
    // Given the GitHub App is subscribed to the events "pull_request, issue_comment"
    // When the bot computes which required events are missing
    // Then the missing events are ""
    expect(computeMissingWebhookEvents(REQUIRED, ["pull_request", "issue_comment"])).toEqual([]);
  });

  it("reports issue_comment as missing when the command event is not subscribed", () => {
    // Given the GitHub App is subscribed to the events "issues, pull_request"
    // When the bot computes which required events are missing
    // Then the missing events are "issue_comment"
    expect(computeMissingWebhookEvents(REQUIRED, ["issues", "pull_request"])).toEqual([
      "issue_comment",
    ]);
  });

  // Scenario Outline: Missing set across subscription shapes.
  it.each<{ subscribed: readonly string[]; missing: readonly string[] }>([
    { subscribed: ["pull_request", "issue_comment"], missing: [] },
    { subscribed: ["pull_request", "issue_comment", "push"], missing: [] },
    { subscribed: ["issues", "pull_request"], missing: ["issue_comment"] },
    { subscribed: ["issues", "issue_comment"], missing: ["pull_request"] },
    { subscribed: ["push"], missing: ["pull_request", "issue_comment"] },
    { subscribed: [], missing: ["pull_request", "issue_comment"] },
  ])("given subscribed $subscribed the missing events are $missing", ({ subscribed, missing }) => {
    // When the bot computes which required events are missing
    // Then the missing events match the expected set, ordered as required
    expect(computeMissingWebhookEvents(REQUIRED, subscribed)).toEqual(missing);
  });
});

// Acceptance tests for issue #2579 (R-02, r02-warn-on-missing-event.feature): when a required event
// is not subscribed, the bot logs a warning naming the missing event(s); startup still continues.
describe("validateWebhookSubscriptions (R-02: warn on missing event)", () => {
  it("logs a startup warning naming the missing command event and continues", async () => {
    // Given the GitHub App is subscribed to the events "issues, pull_request"
    const logger = { warn: vi.fn() };
    // When the bot validates its webhook subscriptions at boot
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: async () => ["issues", "pull_request"],
      logger,
      required: REQUIRED,
    });
    // Then a startup warning is logged that names the missing event "issue_comment"
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("issue_comment"),
    );
    // And startup continues (the call resolved without throwing).
  });

  it("names every missing event when several are missing and continues", async () => {
    // Given the GitHub App is subscribed to the events "push"
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: async () => ["push"],
      logger,
      required: REQUIRED,
    });
    // Then the same startup warning names "pull_request" and "issue_comment"
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("pull_request"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("issue_comment"),
    );
  });

  // @e2e: boot reads the App's subscribed events via GET /app and warns on the gap.
  it("reads the App's subscribed events from GET /app and warns on the gap", async () => {
    const request = vi.fn(
      async (_route: "GET /app"): Promise<{ data: { events?: readonly string[] } }> => ({
        data: { events: ["issues", "pull_request"] },
      }),
    );
    const octokit: AppEventsOctokit = { request };
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: () => fetchAppSubscribedEvents(octokit),
      logger,
      required: REQUIRED,
    });
    expect(request).toHaveBeenCalledWith("GET /app");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("issue_comment"),
    );
  });
});

// Acceptance tests for issue #2580 (R-03, r03-no-warning-when-complete.feature): when every required
// event is present, no warning is logged.
describe("validateWebhookSubscriptions (R-03: quiet when complete)", () => {
  it("logs no warning when exactly the required events are subscribed", async () => {
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: async () => ["pull_request", "issue_comment"],
      logger,
      required: REQUIRED,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs no warning when required events plus unrelated extras are subscribed", async () => {
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: async () => ["pull_request", "issue_comment", "issues", "push"],
      logger,
      required: REQUIRED,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// Acceptance tests for issue #2581 (R-04, r04-warn-when-check-cannot-run.feature): when the App's
// subscribed events cannot be fetched, warn that the check could not run; startup continues.
describe("validateWebhookSubscriptions (R-04: check cannot run)", () => {
  it("warns that the check could not run when the subscription fetch errors", async () => {
    const request = vi.fn(
      async (_route: "GET /app"): Promise<{ data: { events?: readonly string[] } }> => {
        throw Object.assign(new Error("Internal Server Error"), { status: 500 });
      },
    );
    const octokit: AppEventsOctokit = { request };
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: () => fetchAppSubscribedEvents(octokit),
      logger,
      required: REQUIRED,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("could not run"),
    );
  });

  it("warns that the check could not run when the subscription fetch times out", async () => {
    const request = vi.fn(
      async (_route: "GET /app"): Promise<{ data: { events?: readonly string[] } }> => {
        throw new Error("GitHub App request timed out");
      },
    );
    const octokit: AppEventsOctokit = { request };
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: () => fetchAppSubscribedEvents(octokit),
      logger,
      required: REQUIRED,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("could not run"),
    );
  });
});

// A 200 OK with no `events` field is a successful fetch, not a fetch failure: it means the App is
// subscribed to nothing, so every required event is missing. Distinct from R-04 ("could not run").
describe("validateWebhookSubscriptions (GitHub App reports no events)", () => {
  it("treats a response without an events field as zero subscribed and warns on every required event", async () => {
    const request = vi.fn(
      async (_route: "GET /app"): Promise<{ data: { events?: readonly string[] } }> => ({
        data: {},
      }),
    );
    const octokit: AppEventsOctokit = { request };
    const logger = { warn: vi.fn() };
    await validateWebhookSubscriptions({
      fetchSubscribedEvents: () => fetchAppSubscribedEvents(octokit),
      logger,
      required: REQUIRED,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("pull_request"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("issue_comment"),
    );
  });
});

// Drift guard: REQUIRED_WEBHOOK_EVENTS is documented to mirror the events registerWebhookHandlers
// subscribes to. Enforce it here so adding/removing a handler without updating the constant fails CI.
describe("REQUIRED_WEBHOOK_EVENTS stays in sync with registered handlers", () => {
  it("equals the unique event prefixes the bot's handlers register", () => {
    const registeredEvents: string[] = [];
    const recordingRegistrar: WebhookRegistrar = {
      on(eventName): void {
        registeredEvents.push(eventName);
      },
    };

    registerWebhookHandlers(recordingRegistrar);

    const requiredFromHandlers = [
      ...new Set(registeredEvents.map((eventName) => eventName.split(".")[0] ?? eventName)),
    ];
    expect([...REQUIRED_WEBHOOK_EVENTS]).toEqual(requiredFromHandlers);
  });
});
