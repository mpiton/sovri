// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { HttpResponse, http } from "msw";

export type HandlerContract = {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly supportsJsonSchema?: boolean;
};

export const GitHubPullRequestFilesUrl =
  "https://api.github.com/repos/octo-org/sovri-target/pulls/42/files";
export const GitHubPullRequestReviewsUrl =
  "https://api.github.com/repos/octo-org/sovri-target/pulls/42/reviews";
export const GitHubIssueCommentsUrl =
  "https://api.github.com/repos/octo-org/sovri-target/issues/42/comments";
export const AnthropicMessagesUrl = "https://api.anthropic.com/v1/messages";

export const handlerContracts: readonly HandlerContract[] = [
  { method: "GET", url: GitHubPullRequestFilesUrl },
  { method: "POST", url: GitHubPullRequestReviewsUrl },
  { method: "POST", url: GitHubIssueCommentsUrl },
  { method: "POST", url: AnthropicMessagesUrl, supportsJsonSchema: true },
];

const GhPullRequestFilesFixture = readJsonFixture("gh-pr-files.json");
const AnthropicReviewFixture = readJsonFixture("anthropic-review.json");
const AnthropicEmptyFixture = readJsonFixture("anthropic-empty.json");

export const handlers = [
  http.get(GitHubPullRequestFilesUrl, () => HttpResponse.json(GhPullRequestFilesFixture)),
  http.post(GitHubPullRequestReviewsUrl, async ({ request }) => {
    const body: unknown = await request.json();

    return HttpResponse.json({ body: readBody(body), id: 98765 });
  }),
  http.post(GitHubIssueCommentsUrl, async ({ request }) => {
    const body: unknown = await request.json();

    return HttpResponse.json({ body: readBody(body), id: 87654 }, { status: 201 });
  }),
  http.post(AnthropicMessagesUrl, async ({ request }) => {
    const body: unknown = await request.json();

    if (usesJsonSchemaOutput(body)) {
      return HttpResponse.json(AnthropicReviewFixture);
    }

    return HttpResponse.json(AnthropicEmptyFixture);
  }),
];

function readJsonFixture(name: string): unknown {
  const value: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );

  return value;
}

function readBody(value: unknown): string {
  if (typeof value !== "object" || value === null || !("body" in value)) {
    return "";
  }

  const body = value.body;
  return typeof body === "string" ? body : "";
}

function usesJsonSchemaOutput(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("output_config" in value)) {
    return false;
  }

  const outputConfig = value.output_config;
  if (typeof outputConfig !== "object" || outputConfig === null || !("format" in outputConfig)) {
    return false;
  }

  const format = outputConfig.format;
  return (
    typeof format === "object" &&
    format !== null &&
    "type" in format &&
    format.type === "json_schema"
  );
}
