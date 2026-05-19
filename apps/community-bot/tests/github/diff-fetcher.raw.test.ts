// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { fetchDiff } from "../../src/github/diff-fetcher.js";
import {
  PullNumber,
  Repo,
  type RawBehavior,
  buildBinaryDiff,
  buildFile,
  buildTextDiff,
  createFakeDiffFetcher,
} from "./diff-fetcher.test-helpers.js";

describe("GitHub diff fetcher raw endpoint", () => {
  it("returns a DiffSchema-valid raw pull request diff", async () => {
    // Given GitHub returns this raw unified diff for pull request 42.
    const fake = createFakeDiffFetcher({ raw: { data: buildTextDiff(), kind: "success" } });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then the returned value validates against `DiffSchema`.
    expect(diff.files).toHaveLength(1);
    // And `unified_diff` equals the raw unified diff.
    expect(diff.unified_diff).toBe(buildTextDiff());
    // And file 1 has path "src/app.ts".
    expect(diff.files[0]?.path).toBe("src/app.ts");
    // And file 1 has status "modified".
    expect(diff.files[0]?.status).toBe("modified");
    // And file 1 has sha "2222222222222222222222222222222222222222".
    expect(diff.files[0]?.sha).toBe("2222222222222222222222222222222222222222");
  });

  it("uses the raw diff Accept header and avoids listFiles when raw diff is parseable", async () => {
    // Given GitHub accepts `application/vnd.github.v3.diff` for pull request 42.
    const fake = createFakeDiffFetcher({ raw: { data: buildTextDiff(), kind: "success" } });

    // When the bot fetches the pull request diff.
    await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then the request includes `Accept: application/vnd.github.v3.diff`.
    expect(fake.rawCalls).toEqual([
      {
        accept: "application/vnd.github.v3.diff",
        pullNumber: 42,
        route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      },
    ]);
    // And no `pulls.listFiles` request is made.
    expect(fake.listFilesCalls).toEqual([]);
  });

  it("keeps binary file changes visible and schema-valid", async () => {
    // Given GitHub returns a raw binary unified diff for pull request 42.
    const fake = createFakeDiffFetcher({ raw: { data: buildBinaryDiff(), kind: "success" } });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then the returned value validates against `DiffSchema`.
    expect(diff.files).toHaveLength(1);
    // And file 1 has path "assets/logo.png".
    expect(diff.files[0]?.path).toBe("assets/logo.png");
    // And file 1 has patch null.
    expect(diff.files[0]?.patch).toBeNull();
  });

  it("returns an empty valid Diff for an empty raw diff", async () => {
    // Given GitHub returns an empty raw unified diff for pull request 42.
    const fake = createFakeDiffFetcher({ raw: { data: "", kind: "success" } });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then `unified_diff` equals an empty string.
    expect(diff.unified_diff).toBe("");
    // And `files` contains 0 files.
    expect(diff.files).toEqual([]);
  });

  it("rejects GitHub 404 without falling back to listFiles", async () => {
    // Given GitHub returns 404 for pull request 42 in "octo-org/sovri-target".
    const fake = createFakeDiffFetcher({ raw: { kind: "error", status: 404 } });

    // When the bot calls `fetchDiff(octokit, repo, 42)`.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);

    // Then the promise rejects with a typed diff fetch error named "DiffFetchError".
    await expect(result).rejects.toMatchObject({ name: "DiffFetchError", status: 404 });
    // And no `Diff` value is returned.
    expect(fake.listFilesCalls).toEqual([]);
  });

  it("falls back from unparseable raw body and HTTP 502 but not HTTP 404", async () => {
    const cases = [
      { expectedFallbackCalls: 1, raw: { data: "not a git diff", kind: "success" } },
      { expectedFallbackCalls: 1, raw: { kind: "error", status: 502 } },
      { expectedFallbackCalls: 0, raw: { kind: "error", status: 404 } },
    ] satisfies {
      readonly expectedFallbackCalls: number;
      readonly raw: RawBehavior;
    }[];

    await Promise.all(
      cases.map(async (testCase) => {
        // Given GitHub raw diff behavior is concrete for pull request 42.
        const fake = createFakeDiffFetcher({
          pages: [[buildFile({ filename: "src/fallback.ts" })]],
          raw: testCase.raw,
        });

        // When the bot fetches the pull request diff.
        const result = fetchDiff(fake.octokit, Repo, PullNumber);

        if (testCase.expectedFallbackCalls === 0) {
          // Then fetching fails with DiffFetchError.
          await expect(result).rejects.toMatchObject({ name: "DiffFetchError" });
        } else {
          // Then fetching succeeds with fallback files.
          await expect(result).resolves.toMatchObject({ files: [{ path: "src/fallback.ts" }] });
        }
        // And the `pulls.listFiles` fallback usage matches feasibility.
        expect(fake.listFilesCalls).toHaveLength(testCase.expectedFallbackCalls);
      }),
    );
  });
});
