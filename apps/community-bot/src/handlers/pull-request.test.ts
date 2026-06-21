// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { SovriConfigParseError, SovriConfigValidationError } from "@sovri/config";
import { z } from "@sovri/core";

import { reportPullRequestReviewFailure, type ReviewCommentTarget } from "./pull-request.js";

// Drives the real failure reporter with a captured comment sink, returning the
// exact body the bot would post to the PR author for the given error.
async function failureCommentFor(error: unknown): Promise<string | undefined> {
  const target: ReviewCommentTarget = { number: 1, repoFullName: "acme/widgets" };
  let posted: string | undefined;
  await reportPullRequestReviewFailure({
    commentTarget: target,
    dependencies: {
      logger: { error: () => {}, info: () => {} },
      postErrorComment: async (_target, message) => {
        posted = message;
      },
    },
    error,
    failureStage: "config_load",
    logContext: {},
  });
  return posted;
}

// Builds a SovriConfigValidationError for ".sovri.yml" from the given Zod
// issues (field path + schema message), mirroring how the config loader raises it.
function validationError(
  issues: ReadonlyArray<{ readonly path: readonly string[]; readonly message: string }>,
): SovriConfigValidationError {
  const zodIssues = issues.map((issue) => ({
    code: "custom" as const,
    message: issue.message,
    path: [...issue.path],
  }));
  return new SovriConfigValidationError(".sovri.yml", new z.ZodError(zodIssues));
}

// Rule R-01 — a schema validation failure names the offending .sovri.yml field(s)
describe("describeReviewFailure — SovriConfigValidationError", () => {
  // Given a review fails at the config_load stage
  // And the cause is a SovriConfigValidationError for ".sovri.yml"

  it("names two schema issues in the failure comment", async () => {
    // Given the validation issues are: limits | Unrecognized key, llm | Required
    const error = validationError([
      { message: "Unrecognized key", path: ["limits"] },
      { message: "Required", path: ["llm"] },
    ]);

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the failure comment names both offending fields, joined with "; "
    expect(comment).toBe("Config error in .sovri.yml: limits: Unrecognized key; llm: Required");
    // And the failure comment is not "review failed"
    expect(comment).not.toBe("review failed");
  });

  it("renders a root-level issue as (root)", async () => {
    // Given the validation issues are: (empty path) | Expected object, received string
    const error = validationError([{ message: "Expected object, received string", path: [] }]);

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the empty path renders as (root)
    expect(comment).toBe("Config error in .sovri.yml: (root): Expected object, received string");
  });

  it("renders a nested path dot-joined", async () => {
    // Given the validation issues are: llm.timeout | Required
    const error = validationError([{ message: "Required", path: ["llm", "timeout"] }]);

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the nested path is rendered dot-joined
    expect(comment).toBe("Config error in .sovri.yml: llm.timeout: Required");
  });
});

// Rule R-02 — a YAML syntax failure surfaces an actionable, file-named comment
describe("describeReviewFailure — SovriConfigParseError", () => {
  // Given a review fails at the config_load stage
  // And the cause is a SovriConfigParseError for ".sovri.yml"

  it("names the file and is not the generic message", async () => {
    const error = new SovriConfigParseError(
      ".sovri.yml",
      new Error("bad indentation of a mapping entry at line 3"),
    );

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the failure comment names ".sovri.yml"
    expect(comment).toContain(".sovri.yml");
    // And the failure comment is not "review failed"
    expect(comment).not.toBe("review failed");
  });
});
