// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { reportPullRequestReviewFailure } from "../../src/handlers/pull-request.js";
import { resolveDeploymentLlmConfig } from "../../src/runtime-env.js";

describe("pull request failure reporting — DeploymentConfigError", () => {
  it("posts the real no-provider guidance instead of the generic failure", async () => {
    // Drive the production path: a deployment with no provider keys and no
    // explicit provider yields the real DeploymentConfigError, so a regression
    // in the message text is caught here (no hand-written stand-in).
    const error = captureError(() => resolveDeploymentLlmConfig({}));

    const posted = await postFailure(error);

    expect(posted).toHaveLength(1);
    const comment = posted[0] ?? "";
    expect(comment).toContain("SOVRI_DEFAULT_LLM_PROVIDER");
    expect(comment).toContain("anthropic");
    expect(comment).toContain("mistral");
    expect(comment).not.toContain("ANTHROPIC_API_KEY is required");
    expect(comment).not.toBe("review failed");
  });
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the deployment configuration to throw");
}

async function postFailure(error: unknown): Promise<string[]> {
  const posted: string[] = [];
  await reportPullRequestReviewFailure({
    commentTarget: { number: 31, repoFullName: "acme/widgets" },
    dependencies: {
      logger: silentLogger(),
      postErrorComment: async (_target, body) => {
        posted.push(body);
      },
    },
    error,
    failureStage: "config_load",
    logContext: {},
  });
  return posted;
}

function silentLogger(): {
  error: (...args: readonly unknown[]) => void;
  info: (...args: readonly unknown[]) => void;
} {
  return {
    error: () => {},
    info: () => {},
  };
}
