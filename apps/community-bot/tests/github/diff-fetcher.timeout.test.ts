// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDiff } from "../../src/github/diff-fetcher.js";
import {
  PullNumber,
  Repo,
  buildFile,
  buildFiles,
  buildTextDiff,
  createFakeDiffFetcher,
} from "./diff-fetcher.test-helpers.js";

describe("GitHub diff fetcher timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds when the raw diff arrives before 30000 ms", async () => {
    vi.useFakeTimers();
    // Given GitHub returns a parseable raw unified diff after 12000 ms.
    const fake = createFakeDiffFetcher({
      raw: { data: buildTextDiff(), delayMs: 12_000, kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);
    await vi.advanceTimersByTimeAsync(12_000);

    // Then fetching succeeds.
    await expect(result).resolves.toMatchObject({ files: [{ path: "src/app.ts" }] });
  });

  it.each([
    { outcome: "succeeds", responseMs: 29_999 },
    { outcome: "succeeds", responseMs: 30_000 },
    { outcome: "times out", responseMs: 30_001 },
  ])("handles timeout boundary response after $responseMs ms as $outcome", async (testCase) => {
    vi.useFakeTimers();
    // Given GitHub returns a parseable raw unified diff after <response-ms> ms.
    const fake = createFakeDiffFetcher({
      raw: { data: buildTextDiff(), delayMs: testCase.responseMs, kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);
    const expectation =
      testCase.outcome === "succeeds"
        ? expect(result).resolves.toMatchObject({ files: [{ path: "src/app.ts" }] })
        : expect(result).rejects.toMatchObject({ name: "DiffFetchTimeoutError" });
    await vi.advanceTimersByTimeAsync(testCase.responseMs);

    // Then fetching matches the timeout boundary outcome.
    await expectation;
  });

  it("applies one overall timeout to paginated fallback", async () => {
    vi.useFakeTimers();
    // Given the raw diff endpoint is not feasible for pull request 42.
    const fake = createFakeDiffFetcher({
      pageDelaysMs: [25_000, 6_000],
      pages: [buildFiles(100, "src/page-1-file"), [buildFile({ filename: "src/page-2.ts" })]],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);
    const expectation = expect(result).rejects.toMatchObject({ name: "DiffFetchTimeoutError" });
    await vi.advanceTimersByTimeAsync(30_001);

    // Then fetching fails with a typed diff fetch timeout error.
    await expectation;
  });
});
