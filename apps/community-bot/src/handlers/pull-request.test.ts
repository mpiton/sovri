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

// Builds a validation error whose rendered comment (before any cap) is exactly
// `length` characters, padded with a plain ASCII message so no secret-shaped
// fragment is present to skew the length via redaction.
function validationErrorRenderingTo(length: number): SovriConfigValidationError {
  const prefix = "Config error in .sovri.yml: field: ";
  return validationError([{ message: "a".repeat(length - prefix.length), path: ["field"] }]);
}

// Rule R-03 — the actionable comment is length-capped at MaxLoggedErrorMessageLength (240)
describe("describeReviewFailure — actionable comment length cap", () => {
  // Given a review fails at the config_load stage
  // And the cause is a SovriConfigValidationError for ".sovri.yml"

  it("posts a message at the 240-char cap whole", async () => {
    // Given the rendered failure comment is 240 characters long
    const error = validationErrorRenderingTo(240);

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the failure comment is 240 characters long
    expect(comment).toHaveLength(240);
    // And the failure comment does not end with "..."
    expect(comment?.endsWith("...")).toBe(false);
  });

  it.each([241, 600])(
    "truncates a rendered %i-char message to 240 + ellipsis",
    async (rendered) => {
      // Given the rendered failure comment would be <rendered> characters long
      const error = validationErrorRenderingTo(rendered);

      // When the bot describes the review failure
      const comment = await failureCommentFor(error);

      // Then the failure comment is 243 characters long
      expect(comment).toHaveLength(243);
      // And the failure comment ends with "..."
      expect(comment?.endsWith("...")).toBe(true);
    },
  );
});

// Rule R-04 — the comment echoes only trusted data, never secret-shaped fragments
describe("describeReviewFailure — secret-shaped fragment redaction", () => {
  // Given a review fails at the config_load stage
  // And the cause is a SovriConfigValidationError for ".sovri.yml"

  it("echoes an ordinary field path unchanged", async () => {
    // Given the validation issues are: limits | Unrecognized key
    const error = validationError([{ message: "Unrecognized key", path: ["limits"] }]);

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the failure comment contains "limits: Unrecognized key"
    expect(comment).toContain("limits: Unrecognized key");
    // And the failure comment does not contain "[Redacted]"
    expect(comment).not.toContain("[Redacted]");
  });

  it.each([
    { fragment: "apiKey", path: ["llm", "apiKey"] },
    { fragment: "api_key", path: ["llm", "api_key"] },
    { fragment: "token", path: ["llm", "token"] },
    { fragment: "secret", path: ["secret"] },
  ])("redacts the secret-shaped path $fragment", async ({ fragment, path }) => {
    // Given the validation issues are: <path> | Unrecognized key
    const error = validationError([{ message: "Unrecognized key", path }]);

    // When the bot describes the review failure
    const comment = await failureCommentFor(error);

    // Then the failure comment contains "[Redacted]"
    expect(comment).toContain("[Redacted]");
    // And the failure comment does not contain "<fragment>"
    expect(comment).not.toContain(fragment);
  });

  it("redacts only the secret-shaped path when ordinary and secret paths are mixed", async () => {
    const error = validationError([
      { message: "Unrecognized key", path: ["limits"] },
      { message: "Required", path: ["llm", "apiKey"] },
    ]);

    const comment = await failureCommentFor(error);

    // The ordinary path is echoed unchanged...
    expect(comment).toContain("limits: Unrecognized key");
    // ...while the secret-shaped path in the same comment is redacted.
    expect(comment).toContain("[Redacted]");
    expect(comment).not.toContain("apiKey");
  });
});
