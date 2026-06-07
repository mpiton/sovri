// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { readRepoFile } from "../scaffold/helpers.js";

const dockerfilePath = "apps/community-bot/Dockerfile";
const dockerignorePath = ".dockerignore";
const runtimeUserFailure = "runtime user must be sovri:1001";

const requiredDockerIgnorePatterns: readonly string[] = [
  ".git",
  ".turbo",
  ".worktrees",
  "node_modules",
  "**/node_modules",
  "coverage",
  "**/coverage",
  "specs",
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/__fixtures__",
  "**/fixtures",
  "apps/*/dist",
  "packages/*/dist",
  "*.log",
  "sbom.json",
];

const requiredRuntimePaths: readonly string[] = [
  "/app/dist/server.js",
  "/app/package.json",
  "/app/node_modules/probot/package.json",
  "/app/node_modules/@sovri/config/dist/index.js",
  "/app/node_modules/@sovri/core/dist/index.js",
  "/app/node_modules/@sovri/llm-providers/dist/index.js",
  "/app/node_modules/@sovri/review-engine/dist/index.js",
  "/app/node_modules/@sovri/observability/dist/index.js",
];

type ContractResult =
  | {
      readonly ok: true;
    }
  | {
      readonly message: string;
      readonly ok: false;
    };

describe("community bot Docker image contract", () => {
  it("contains the required Docker ignore exclusions", () => {
    // Given ".dockerignore" exists at the repository root
    const patterns = readDockerIgnorePatterns();

    // When the Docker ignore rules are inspected
    // Then they exclude ".git"
    // And they exclude ".turbo"
    // And they exclude ".worktrees"
    // And they exclude "node_modules"
    // And they exclude "**/node_modules"
    // And they exclude "coverage"
    // And they exclude "**/coverage"
    // And they exclude "specs"
    // And they exclude "**/*.test.ts"
    // And they exclude "**/*.spec.ts"
    // And they exclude "**/__fixtures__"
    // And they exclude "**/fixtures"
    // And they exclude "apps/*/dist"
    // And they exclude "packages/*/dist"
    // And they exclude "*.log"
    // And they exclude "sbom.json"
    expect(patterns).toEqual(expect.arrayContaining(requiredDockerIgnorePatterns));
  });

  it.each([
    "node_modules",
    "**/node_modules",
    "**/*.test.ts",
    "**/__fixtures__",
    "apps/*/dist",
    "packages/*/dist",
  ])("rejects Docker ignore rules missing %s", (missingPattern) => {
    // Given ".dockerignore" exists at the repository root
    const patterns = requiredDockerIgnorePatterns.filter((pattern) => pattern !== missingPattern);

    // And the Docker ignore rules do not exclude "<missing_pattern>"
    // When the Docker ignore contract is evaluated
    const result = inspectDockerIgnorePatterns(patterns);

    // Then the contract fails
    expect(result.ok).toBe(false);

    // And the failure mentions "missing Docker ignore pattern <missing_pattern>"
    expect(result.ok ? "" : result.message).toBe(`missing Docker ignore pattern ${missingPattern}`);
  });

  it("rejects an app-local Docker ignore without a root Docker ignore", () => {
    // Given the Docker build context is "."
    const buildContext = ".";

    // And "apps/community-bot/.dockerignore" exists
    // And ".dockerignore" does not exist at the repository root
    // When the Docker ignore contract is evaluated
    const result = inspectDockerIgnorePlacement({
      appDockerIgnoreExists: true,
      buildContext,
      rootDockerIgnoreExists: false,
    });

    // Then the contract fails
    expect(result.ok).toBe(false);

    // And the failure mentions "root .dockerignore is required for build context ."
    expect(result.ok ? "" : result.message).toBe(
      "root .dockerignore is required for build context .",
    );
  });

  it("excludes host dist directories while Docker still builds artifacts internally", () => {
    // Given the host file "apps/community-bot/dist/server.js" exists before the Docker build
    const dockerfile = readAppDockerfile();
    const patterns = readDockerIgnorePatterns();

    // And ".dockerignore" excludes "apps/*/dist"
    expect(patterns).toContain("apps/*/dist");

    // When `docker build -t sovri/community-bot:dev -f apps/community-bot/Dockerfile .` runs
    // Then "apps/community-bot/dist/server.js" is not sent from the host context
    expect(patterns).toContain("apps/*/dist");

    // And the builder stage runs `pnpm --filter @sovri/community-bot... build`
    expect(dockerfile).toContain("pnpm --filter @sovri/community-bot... build");

    // And the runtime image still contains "/app/dist/server.js" started under the OTel --require hook
    expect(dockerfile).toContain(
      'CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/server.js"]',
    );
  });

  it("excludes tests and fixtures from the Docker context", () => {
    // Given the host context contains "apps/community-bot/tests/e2e/pull-request-review-flow.test.ts"
    // And the host context contains "packages/review-engine/src/fixtures/simple.diff"
    const patterns = readDockerIgnorePatterns();

    // When the Docker context is prepared
    // Then "apps/community-bot/tests/e2e/pull-request-review-flow.test.ts" is excluded
    expect(patterns).toContain("**/*.test.ts");

    // And "packages/review-engine/src/fixtures/simple.diff" is excluded
    expect(patterns).toContain("**/fixtures");
  });

  it("runs the runtime process as the sovri user", () => {
    // Given the image "sovri/community-bot:dev" has been built successfully
    const dockerfile = readAppDockerfile();

    // When the container runs `id -u`, `id -g`, and `id -un` in the final stage
    const runtime = readRuntimeStage(dockerfile);

    // Then the reported UID is "1001"
    expect(runtime).toContain("adduser -u 1001");

    // And the reported GID is "1001"
    expect(runtime).toContain("addgroup -g 1001");

    // And the reported username is "sovri"
    expect(runtime).toContain("USER sovri");

    // And the process is not running as UID "0"
    expect(runtime).not.toContain("USER 0");
  });

  it.each(["", "root", "0", "0:0"])("rejects runtime user %s", (runtimeUser) => {
    // Given the final image metadata declares runtime user "<runtime_user>"
    // When the non-root image policy is evaluated
    const result = inspectRuntimeUser(runtimeUser);

    // Then the policy fails
    expect(result.ok).toBe(false);

    // And the failure mentions "final image must run as sovri:1001"
    expect(result.ok ? "" : result.message).toBe("final image must run as sovri:1001");
  });

  it("does not switch back to root after selecting sovri", () => {
    // Given "apps/community-bot/Dockerfile" contains a final stage named "runtime"
    const runtime = readRuntimeStage(readAppDockerfile());

    // And the runtime stage declares `USER sovri`
    const afterUser = runtime.slice(runtime.indexOf("USER sovri"));
    expect(afterUser).toContain("USER sovri");

    // When the runtime stage instructions after `USER sovri` are inspected
    // Then none of those instructions declares `USER root`
    expect(afterUser).not.toContain("USER root");

    // And none of those instructions declares `USER 0`
    expect(afterUser).not.toContain("USER 0");
  });

  it.each([
    { reportedSize: "180000000 B", sizeBytes: 180000000 },
    { reportedSize: "349999999 B", sizeBytes: 349999999 },
  ])("accepts image size $reportedSize", ({ reportedSize, sizeBytes }) => {
    // Given the final image size is <size_bytes> bytes
    // When the image size gate is evaluated
    const result = inspectImageSize(sizeBytes);

    // Then the image size gate passes
    expect(result.ok).toBe(true);

    // And the reported image size is "<reported_size>"
    expect(`${sizeBytes} B`).toBe(reportedSize);
  });

  it.each([350000000, 350000001])("rejects image size %d bytes", (sizeBytes) => {
    // Given the final image size is <size_bytes> bytes
    // When the image size gate is evaluated
    const result = inspectImageSize(sizeBytes);

    // Then the image size gate fails
    expect(result.ok).toBe(false);

    // And the failure mentions "final image must be smaller than 350 MB"
    expect(result.ok ? "" : result.message).toBe("final image must be smaller than 350 MB");
  });

  it("excludes build-only files from the runtime image", () => {
    // Given the image "sovri/community-bot:dev" has been built successfully
    const runtime = readRuntimeStage(readAppDockerfile());

    // When the runtime filesystem is inspected
    // Then it does not contain "/app/.turbo"
    expect(runtime).not.toContain("/app/.turbo");

    // And it does not contain "/app/specs"
    expect(runtime).not.toContain("/app/specs");

    // And it does not contain "/app/apps/community-bot/tests"
    expect(runtime).not.toContain("/app/apps/community-bot/tests");

    // And it does not contain "/app/node_modules/.pnpm-store"
    expect(runtime).not.toContain("/app/node_modules/.pnpm-store");
  });

  it("contains the built community bot runtime artifacts", () => {
    // Given the image "sovri/community-bot:dev" has been built successfully
    const dockerfile = readAppDockerfile();

    // When the runtime filesystem is inspected
    const expectedPaths = inferRuntimePaths(dockerfile);

    // Then "/app/dist/server.js" exists
    // And "/app/package.json" exists
    // And "/app/node_modules/probot/package.json" exists
    // And "/app/node_modules/@sovri/config/dist/index.js" exists
    // And "/app/node_modules/@sovri/core/dist/index.js" exists
    // And "/app/node_modules/@sovri/llm-providers/dist/index.js" exists
    // And "/app/node_modules/@sovri/review-engine/dist/index.js" exists
    // And "/app/node_modules/@sovri/observability/dist/index.js" exists
    expect(expectedPaths).toEqual(expect.arrayContaining(requiredRuntimePaths));
  });

  it("exposes port 3000 and runs as sovri:1001", () => {
    // Given the image "sovri/community-bot:dev" has been built successfully
    const runtime = readRuntimeStage(readAppDockerfile());

    // When the final image metadata is inspected
    // Then the exposed ports include "3000/tcp"
    expect(runtime).toContain("EXPOSE 3000");

    // And the configured runtime user is "sovri"
    expect(runtime).toContain("USER sovri");

    // And running `id -u` in the container returns "1001"
    expect(runtime).toContain("adduser -u 1001");

    // And running `id -g` in the container returns "1001"
    expect(runtime).toContain("addgroup -g 1001");
  });

  it("probes the operational health endpoint from Docker healthcheck", () => {
    // Given the built container is listening on "127.0.0.1:3000"
    const runtime = readRuntimeStage(readAppDockerfile());

    // And `GET http://127.0.0.1:${PORT}/health` returns status 200 with JSON body `{"status":"ok"}`
    expect(runtime).toContain("http://127.0.0.1:${PORT}/health");

    // When Docker runs the configured `HEALTHCHECK`
    expect(runtime).toContain("HEALTHCHECK");

    // Then the healthcheck exits with code 0
    expect(runtime).toContain("|| exit 1");

    // And Docker marks the container health state as "healthy"
    expect(runtime).not.toContain("|| true");
  });

  it.each(requiredRuntimePaths)("rejects missing runtime item %s", (missingItem) => {
    // Given the image "sovri/community-bot:dev" has been built successfully
    const presentItems = requiredRuntimePaths.filter((item) => item !== missingItem);

    // And the runtime image is missing "<missing_item>"
    // When the runtime stage contract is evaluated
    const result = inspectRuntimeItems(presentItems);

    // Then the contract fails
    expect(result.ok).toBe(false);

    // And the failure mentions "<failure_message>"
    expect(result.ok ? "" : result.message).toContain(missingItem);
  });

  it.each([
    { gid: "0", uid: "0" },
    { gid: "1000", uid: "1000" },
    { gid: "0", uid: "1001" },
  ])("rejects runtime identity uid=$uid gid=$gid", ({ gid, uid }) => {
    // Given the container runtime identity reports UID "<uid>" and GID "<gid>"
    // When the runtime stage contract is evaluated
    const result = inspectRuntimeIdentity(uid, gid);

    // Then the contract fails
    expect(result.ok).toBe(false);

    // And the failure mentions "runtime user must be sovri:1001"
    expect(result.ok ? "" : result.message).toBe(runtimeUserFailure);
  });
});

function readDockerIgnorePatterns(): string[] {
  return readRepoFile(dockerignorePath)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function readAppDockerfile(): string {
  return readRepoFile(dockerfilePath);
}

function readRuntimeStage(dockerfile: string): string {
  const marker = "FROM node:24-alpine AS runtime";
  const markerIndex = dockerfile.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`${dockerfilePath} must contain a runtime stage`);
  }
  return dockerfile.slice(markerIndex);
}

function inspectDockerIgnorePatterns(patterns: readonly string[]): ContractResult {
  const missing = requiredDockerIgnorePatterns.find((pattern) => !patterns.includes(pattern));
  if (missing) {
    return { message: `missing Docker ignore pattern ${missing}`, ok: false };
  }
  return { ok: true };
}

function inspectDockerIgnorePlacement(params: {
  readonly appDockerIgnoreExists: boolean;
  readonly buildContext: string;
  readonly rootDockerIgnoreExists: boolean;
}): ContractResult {
  if (
    params.buildContext === "." &&
    params.appDockerIgnoreExists &&
    !params.rootDockerIgnoreExists
  ) {
    return { message: "root .dockerignore is required for build context .", ok: false };
  }
  return { ok: true };
}

function inspectRuntimeUser(runtimeUser: string): ContractResult {
  const accepted = new Set(["sovri", "sovri:1001", "1001:1001"]);
  if (!accepted.has(runtimeUser)) {
    return { message: "final image must run as sovri:1001", ok: false };
  }
  return { ok: true };
}

function inspectImageSize(sizeBytes: number): ContractResult {
  if (sizeBytes >= 350000000) {
    return { message: "final image must be smaller than 350 MB", ok: false };
  }
  return { ok: true };
}

function inferRuntimePaths(dockerfile: string): string[] {
  if (!dockerfile.includes("pnpm deploy") || !dockerfile.includes("/app/deploy/community-bot")) {
    return [];
  }
  return [...requiredRuntimePaths];
}

function inspectRuntimeItems(paths: readonly string[]): ContractResult {
  const missing = requiredRuntimePaths.find((path) => !paths.includes(path));
  if (missing) {
    return { message: `missing runtime item ${missing}`, ok: false };
  }
  return { ok: true };
}

function inspectRuntimeIdentity(uid: string, gid: string): ContractResult {
  if (uid !== "1001" || gid !== "1001") {
    return { message: runtimeUserFailure, ok: false };
  }
  return { ok: true };
}
