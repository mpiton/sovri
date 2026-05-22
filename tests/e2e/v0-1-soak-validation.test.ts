// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const validatorPath = join(repoRoot, "scripts/validate-v0-1-soak.mjs");
const tempDirs: string[] = [];

describe("v0.1 soak evidence validation", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it.each([
    {
      evidence: "pulled ghcr.io/mpiton/sovri/community-bot:v0.1.0",
      provenanceMode: "GHCR pull",
    },
    {
      evidence:
        "built sovri/community-bot:smoke from Dockerfile at commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      provenanceMode: "local build",
    },
  ])("accepts recorded image provenance for $provenanceMode", ({ evidence, provenanceMode }) => {
    const soakLogPath = writeSoakLog(`Image provenance: ${evidence}\n`);

    // Given the running container image was prepared by "<provenance_mode>"
    // And the soak log records "<evidence>"
    const result = runValidator([
      "image-provenance",
      "--provenance-mode",
      provenanceMode,
      "--soak-log",
      soakLogPath,
    ]);

    // When image provenance is evaluated
    // Then the image provenance assertion passes
    expect(result.status, result.stderr).toBe(0);
  });

  it("fails Anthropic key wiring when Anthropic authentication fails without a crash", () => {
    const soakLogPath = writeSoakLog(
      [
        "ANTHROPIC_API_KEY value: invalid",
        "PR: 101",
        "Anthropic HTTP status: 401",
        "Successful review comment posted: false",
        "Container restart count: 0",
        "Health status after failed review: 200",
      ].join("\n"),
    );

    // Given `ANTHROPIC_API_KEY` is set to an invalid value
    // And Anthropic returns HTTP 401 for PR 101
    // When Sovri reviews PR 101
    const result = runValidator(["anthropic-key", "--pr", "101", "--soak-log", soakLogPath]);

    // Then no successful review comment is posted on PR 101
    // And the container restart count remains 0
    // And `GET /health` returns 200 after the failed review attempt
    // And the Anthropic key wiring assertion fails
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Anthropic key wiring assertion failed");
  });

  it("passes Anthropic key wiring when the smoke PR review completes", () => {
    const soakLogPath = writeSoakLog(
      [
        "ANTHROPIC_API_KEY value: valid Anthropic API key",
        "Repository: mpiton/forgent",
        "PR: 101",
        "Changed lines: 128",
        "Structured Anthropic response received: true",
        "First PR comment posted: true",
      ].join("\n"),
    );

    // Given `ANTHROPIC_API_KEY` is set to a valid Anthropic API key
    // And PR 101 in "mpiton/forgent" has 128 changed lines
    // When Sovri reviews PR 101
    const result = runValidator([
      "anthropic-key",
      "--repo",
      "mpiton/forgent",
      "--pr",
      "101",
      "--changed-lines",
      "128",
      "--soak-log",
      soakLogPath,
    ]);

    // Then Sovri receives a structured Anthropic response
    // And Sovri posts a first PR comment on PR 101
    // And the Anthropic key wiring assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Anthropic key wiring assertion passed");
  });
});

function runValidator(args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [validatorPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function writeSoakLog(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sovri-v0-1-soak-"));
  tempDirs.push(dir);
  const path = join(dir, "v0.1-soak.md");
  writeFileSync(path, content);
  return path;
}
