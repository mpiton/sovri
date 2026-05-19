// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { fetchDiff } from "../../src/github/diff-fetcher.js";
import {
  PullNumber,
  Repo,
  buildFile,
  buildFiles,
  createFakeDiffFetcher,
} from "./diff-fetcher.test-helpers.js";

describe("GitHub diff fetcher listFiles fallback", () => {
  it("reads every fallback page and preserves the final file", async () => {
    // Given GitHub `pulls.listFiles` returns 100 files on page 1.
    const firstPage = buildFiles(100, "src/page-1-file");
    // And GitHub `pulls.listFiles` returns 1 file on page 2.
    const secondPage = [buildFile({ filename: "src/page-2-file-101.ts" })];
    const fake = createFakeDiffFetcher({
      pages: [firstPage, secondPage],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then GitHub receives `pulls.listFiles` requests for pages 1 and 2.
    expect(fake.listFilesCalls.map((call) => call.page)).toEqual([1, 2]);
    // And `files` contains 101 files.
    expect(diff.files).toHaveLength(101);
    // And file 101 has path "src/page-2-file-101.ts".
    expect(diff.files[100]?.path).toBe("src/page-2-file-101.ts");
  });

  it("rejects when the fallback reaches GitHub's 3000-file listing cap", async () => {
    // Given GitHub `pulls.listFiles` returns 30 pages of 100 files each
    // (GitHub caps the endpoint at 3000 files, so the bot cannot tell whether
    // the listing is complete or truncated once it reaches that count).
    const pages = Array.from({ length: 30 }, (_, index) =>
      buildFiles(100, `src/page-${String(index + 1)}-file`),
    );
    const fake = createFakeDiffFetcher({
      pages: [...pages, []],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);

    // Then fetching fails with a typed diff fetch error named "DiffFetchError".
    await expect(result).rejects.toThrow(
      "Pull request diff reaches GitHub's 3000-file listing cap",
    );
  });

  it("rejects more than 3000 changed files", async () => {
    // Given GitHub `pulls.listFiles` returns 30 pages of 100 files each.
    const pages = Array.from({ length: 30 }, (_, index) =>
      buildFiles(100, `src/page-${String(index + 1)}-file`),
    );
    const fake = createFakeDiffFetcher({
      pages: [...pages, [buildFile({ filename: "src/file-3001.ts" })]],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);

    // Then fetching fails with a typed diff fetch error named "DiffFetchError".
    await expect(result).rejects.toThrow(
      "Pull request diff reaches GitHub's 3000-file listing cap",
    );
  });

  it("preserves file order across fallback pages", async () => {
    // Given GitHub `pulls.listFiles` page 1 contains "src/a.ts" then "src/b.ts".
    const firstPage = [
      buildFile({ filename: "src/a.ts" }),
      buildFile({ filename: "src/b.ts" }),
      ...buildFiles(98, "src/filler"),
    ];
    const fake = createFakeDiffFetcher({
      pages: [firstPage, [buildFile({ filename: "src/c.ts" })]],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then `files` contains paths in this order.
    expect(diff.files[0]?.path).toBe("src/a.ts");
    expect(diff.files[1]?.path).toBe("src/b.ts");
    expect(diff.files[100]?.path).toBe("src/c.ts");
  });

  it("accepts zero fallback files", async () => {
    // Given GitHub `pulls.listFiles` returns 0 files on page 1.
    const fake = createFakeDiffFetcher({
      pages: [[]],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then `unified_diff` equals an empty string.
    expect(diff.unified_diff).toBe("");
    // And `files` contains 0 files.
    expect(diff.files).toEqual([]);
  });

  it("rejects unmappable GitHub file data before returning a Diff", async () => {
    // Given GitHub `pulls.listFiles` returns a file with path "".
    const fake = createFakeDiffFetcher({
      pages: [[buildFile({ filename: "" })]],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const result = fetchDiff(fake.octokit, Repo, PullNumber);

    // Then fetching fails with a typed diff fetch error named "DiffFetchError".
    await expect(result).rejects.toMatchObject({ name: "DiffFetchError" });
  });

  it("does not evaluate executable-looking fallback patch content", async () => {
    // Given the execution sentinel `globalThis.__sovriDiffExecuted` is undefined.
    expect(Reflect.get(globalThis, "__sovriDiffExecuted")).toBeUndefined();
    const fake = createFakeDiffFetcher({
      pages: [
        [
          buildFile({
            filename: "src/fallback-payload.ts",
            patch: "@@ -0,0 +1 @@\n+globalThis.__sovriDiffExecuted = true;",
          }),
        ],
      ],
      raw: { data: "not a git diff", kind: "success" },
    });

    // When the bot fetches the pull request diff.
    const diff = await fetchDiff(fake.octokit, Repo, PullNumber);

    // Then the returned `unified_diff` contains the payload string.
    expect(diff.unified_diff).toContain("+globalThis.__sovriDiffExecuted = true;");
    // And the execution sentinel is still undefined.
    expect(Reflect.get(globalThis, "__sovriDiffExecuted")).toBeUndefined();
  });
});
