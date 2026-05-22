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

  it("keeps the Anthropic API key value out of captured provider logs", () => {
    const soakLogPath = writeSoakLog(
      [
        "ANTHROPIC_API_KEY configured value: ANTHROPIC_API_KEY_SENTINEL_60",
        "PR: 101",
        "Anthropic HTTP status: 401",
        'Captured log: provider=anthropic level=error message="provider call failed"',
      ].join("\n"),
    );

    // Given `ANTHROPIC_API_KEY` is "ANTHROPIC_API_KEY_SENTINEL_60"
    // And Anthropic returns HTTP 401 for PR 101
    // When Sovri records the failed provider call
    const result = runValidator([
      "provider-logs",
      "--provider",
      "anthropic",
      "--secret",
      "ANTHROPIC_API_KEY_SENTINEL_60",
      "--soak-log",
      soakLogPath,
    ]);

    // Then no captured log line contains "ANTHROPIC_API_KEY_SENTINEL_60"
    // And the provider error log includes the provider name "anthropic"
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("provider log assertion passed");
  });

  it.each([
    {
      secretName: "WEBHOOK_SECRET",
      secretValue: "WEBHOOK_SECRET_SENTINEL_60",
    },
    {
      secretName: "PRIVATE_KEY",
      secretValue: "PRIVATE_KEY_SENTINEL_60",
    },
    {
      secretName: "ANTHROPIC_API_KEY",
      secretValue: "ANTHROPIC_API_KEY_SENTINEL_60",
    },
    {
      secretName: "GitHub installation token",
      secretValue: "GITHUB_INSTALLATION_TOKEN_SENTINEL_60",
    },
  ])("fails when captured logs contain raw $secretName", ({ secretName, secretValue }) => {
    const soakLogPath = writeSoakLog(`Captured log: leaked value ${secretValue}\n`);

    // Given captured logs contain the text "<secret_value>"
    // When the captured container logs are reviewed
    const result = runValidator([
      "log-secrets",
      "--secret-name",
      secretName,
      "--secret-value",
      secretValue,
      "--soak-log",
      soakLogPath,
    ]);

    // Then the log secret assertion fails
    // And the failure mentions "<secret_name>"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(secretName);
  });

  it("fails log secret review when captured logs are missing", () => {
    const soakLogPath = writeSoakLog("Operator note: container logs were not captured\n");

    const result = runValidator([
      "log-secrets",
      "--secret-name",
      "WEBHOOK_SECRET",
      "--secret-value",
      "WEBHOOK_SECRET_SENTINEL_60",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("captured logs are missing");
  });

  it("passes when captured logs contain smoke metadata without secret values", () => {
    const soakLogPath = writeSoakLog(
      [
        "Captured log: delivery_id=delivery-60-101 pr=101 provider=anthropic",
        "Captured log: delivery_id=delivery-60-102 pr=102 provider=anthropic",
        "Captured log: delivery_id=delivery-60-103 pr=103 provider=anthropic",
        "Captured log: delivery_id=delivery-60-104 pr=104 provider=anthropic",
        "Captured log: delivery_id=delivery-60-105 pr=105 provider=anthropic",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, 104, and 105
    // And captured logs contain delivery IDs "delivery-60-101", "delivery-60-102", "delivery-60-103", "delivery-60-104", and "delivery-60-105"
    // When the captured container logs are reviewed
    const result = runValidator([
      "log-secrets",
      "--secret-name",
      "all smoke secrets",
      "--secret-value",
      "WEBHOOK_SECRET_SENTINEL_60",
      "--secret-value",
      "PRIVATE_KEY_SENTINEL_60",
      "--secret-value",
      "ANTHROPIC_API_KEY_SENTINEL_60",
      "--secret-value",
      "GITHUB_INSTALLATION_TOKEN_SENTINEL_60",
      "--secret-value",
      "BEGIN RSA PRIVATE KEY",
      "--soak-log",
      soakLogPath,
    ]);

    // Then no log line contains "WEBHOOK_SECRET_SENTINEL_60"
    // And no log line contains "PRIVATE_KEY_SENTINEL_60"
    // And no log line contains "ANTHROPIC_API_KEY_SENTINEL_60"
    // And no log line contains "GITHUB_INSTALLATION_TOKEN_SENTINEL_60"
    // And no log line contains "BEGIN RSA PRIVATE KEY"
    // And the log secret assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("log secret assertion passed");
  });

  it("rejects a malformed repeated secret value argument", () => {
    const soakLogPath = writeSoakLog("Captured log: delivery_id=delivery-60-101 pr=101\n");

    const result = runValidator([
      "log-secrets",
      "--secret-name",
      "all smoke secrets",
      "--secret-value",
      "WEBHOOK_SECRET_SENTINEL_60",
      "--secret-value",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--secret-value is malformed");
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
