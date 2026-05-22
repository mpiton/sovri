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

  it("fails local build image provenance when the source commit is missing", () => {
    const soakLogPath = writeSoakLog(
      "Image provenance: built sovri/community-bot:smoke from Dockerfile\n",
    );

    // Given the running container image was prepared by "local build"
    // And the soak log records "built sovri/community-bot:smoke from Dockerfile"
    // But the soak log does not record a Sovri commit SHA
    const result = runValidator([
      "image-provenance",
      "--provenance-mode",
      "local build",
      "--soak-log",
      soakLogPath,
    ]);

    // When image provenance is evaluated
    // Then the image provenance assertion fails
    // And the failure mentions "local build must record the source commit"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local build must record the source commit");
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

  it("fails Anthropic key wiring when the Anthropic API key is unset", () => {
    const soakLogPath = writeSoakLog(
      [
        "Repository: mpiton/forgent",
        "PR: 101",
        "Changed lines: 128",
        "Successful review comment posted: false",
      ].join("\n"),
    );

    // Given `ANTHROPIC_API_KEY` is unset
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

    // Then no successful review comment is posted on PR 101
    // And the Anthropic key wiring assertion fails
    // And the failure mentions "ANTHROPIC_API_KEY"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Anthropic key wiring assertion failed");
    expect(result.stderr).toContain("ANTHROPIC_API_KEY");
  });

  it("treats an empty Anthropic API key as missing", () => {
    const soakLogPath = writeSoakLog(
      [
        "ANTHROPIC_API_KEY value:    ",
        "Repository: mpiton/forgent",
        "PR: 101",
        "Changed lines: 128",
        "Successful review comment posted: false",
      ].join("\n"),
    );

    // Given `ANTHROPIC_API_KEY` is "   "
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

    // Then no successful review comment is posted on PR 101
    // And the Anthropic key wiring assertion fails
    // And the failure mentions "ANTHROPIC_API_KEY"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ANTHROPIC_API_KEY");
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
    const soakLogPath = writeSoakLog(
      [
        "Qualifying PR: 101",
        "Qualifying PR: 102",
        "Qualifying PR: 103",
        "Qualifying PR: 104",
        "Operator note: container logs were not captured",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And no captured container stdout is available
    // When the captured container logs are reviewed
    const result = runValidator([
      "log-secrets",
      "--secret-name",
      "WEBHOOK_SECRET",
      "--secret-value",
      "WEBHOOK_SECRET_SENTINEL_60",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the log secret assertion fails
    // And the failure mentions "missing docker logs evidence"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing docker logs evidence");
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

  it("fails no-crash validation when the container restarts during the smoke set", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "Container restart count after PR 103: 1",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And the container restart count is 0 before PR 101
    // When the container restart count becomes 1 after PR 103
    const result = runValidator([
      "no-crash",
      "--from-pr",
      "101",
      "--to-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the no-crash assertion fails
    // And the failure mentions "container restarted during the smoke PR set"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("container restarted during the smoke PR set");
  });

  it("fails no-crash validation when restart evidence is incomplete", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Captured log: delivery_id=delivery-60-101 pr=101 provider=anthropic",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // But restart count evidence is missing for the smoke range
    const result = runValidator([
      "no-crash",
      "--from-pr",
      "101",
      "--to-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the no-crash assertion fails instead of assuming no restart occurred
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("restart evidence is incomplete");
  });

  it("fails no-crash validation when container restart evidence is missing", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Captured log: delivery_id=delivery-60-101 pr=101 provider=anthropic",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And no Docker restart-count evidence is available for "sovri-community-bot-v0-1-soak"
    // When the no-crash assertion is evaluated
    const result = runValidator([
      "no-crash",
      "--from-pr",
      "101",
      "--to-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the no-crash assertion fails
    // And the failure mentions "missing container restart evidence"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing container restart evidence");
  });

  it("fails no-crash validation when restart evidence stops before the final PR", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "Container restart count after PR 102: 0",
      ].join("\n"),
    );

    // Given restart count evidence exists for the start of the smoke range
    // But the last restart count evidence stops before PR 104
    const result = runValidator([
      "no-crash",
      "--from-pr",
      "101",
      "--to-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the no-crash assertion fails instead of accepting truncated evidence
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("restart evidence is incomplete");
  });

  it("fails no-crash validation when the baseline restart count is malformed", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: unavailable",
        "Container restart count after PR 104: 0",
      ].join("\n"),
    );

    // Given restart count evidence reaches the end of the smoke range
    // But the baseline restart count cannot be parsed
    const result = runValidator([
      "no-crash",
      "--from-pr",
      "101",
      "--to-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the no-crash assertion fails instead of accepting malformed evidence
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("restart evidence is incomplete");
  });

  it("accepts four completed smoke PRs with no restart and no exit event", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "Container restart count after PR 104: 0",
        "Container exit event: none for sovri-community-bot-v0-1-soak",
        "Latest GET /health response status: 200",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And no container exit event is recorded
    const result = runNoCrashValidator(soakLogPath);

    // Then the no-crash assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no-crash outcome: accepted");
    expect(result.stdout).toContain("reason: no crash evidence");
  });

  it("accepts five completed smoke PRs with no exit event and health after each review", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Smoke PR: 105 qualifying=true",
        "Container restart count before PR 101: 0",
        "GET /health before PR 101: 200",
        "Container restart count after PR 105: 0",
        "Container exit event: none for sovri-community-bot-v0-1-soak",
        "GET /health after PR 101: 200",
        "GET /health after PR 102: 200",
        "GET /health after PR 103: 200",
        "GET /health after PR 104: 200",
        "GET /health after PR 105: 200",
      ].join("\n"),
    );

    // Given five qualifying PRs complete
    // And the bot records no container exit event
    // And health is checked before PR 101 and after each review comment
    const result = runNoCrashValidatorForRange(soakLogPath, { fromPr: "101", toPr: "105" });

    // Then the no-crash assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no-crash outcome: accepted");
    expect(result.stdout).toContain("reason: no crash evidence");
  });

  it("rejects five completed smoke PRs when health after a review comment is missing", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Smoke PR: 105 qualifying=true",
        "Container restart count before PR 101: 0",
        "GET /health before PR 101: 200",
        "Container restart count after PR 105: 0",
        "Community bot process exit code: 0",
        "GET /health after PR 101: 200",
        "GET /health after PR 102: 200",
        "GET /health after PR 104: 200",
        "GET /health after PR 105: 200",
        "Latest GET /health response status: 200",
      ].join("\n"),
    );

    // Given five qualifying PRs complete
    // But health evidence is missing after PR 103
    const result = runNoCrashValidatorForRange(soakLogPath, { fromPr: "101", toPr: "105" });

    // Then the no-crash assertion fails instead of relying on the latest health line
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("health evidence is incomplete");
  });

  it("accepts the healthy crash evidence matrix row", () => {
    const result = runNoCrashValidator(
      writeCrashEvidenceLog({ exitCode: 0, healthStatus: 200, restartDelta: 0 }),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And the container restart count changes by 0
    // And the Community bot process exit code is 0
    // And the latest `GET /health` response status is 200
    // When the no-crash assertion is evaluated
    // Then the no-crash outcome is "accepted"
    // And the reason is "no crash evidence"
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no-crash outcome: accepted");
    expect(result.stdout).toContain("reason: no crash evidence");
  });

  it("rejects the crash evidence matrix row when the container restarted", () => {
    const result = runNoCrashValidator(
      writeCrashEvidenceLog({ exitCode: 0, healthStatus: 200, restartDelta: 1 }),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And the container restart count changes by 1
    // And the Community bot process exit code is 0
    // And the latest `GET /health` response status is 200
    // When the no-crash assertion is evaluated
    // Then the no-crash outcome is "rejected"
    // And the reason is "container restarted"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("reason: container restarted");
  });

  it("rejects the crash evidence matrix row when the process exits with code 1", () => {
    const result = runNoCrashValidator(
      writeCrashEvidenceLog({ exitCode: 1, healthStatus: 200, restartDelta: 0 }),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And the container restart count changes by 0
    // And the Community bot process exit code is 1
    // And the latest `GET /health` response status is 200
    // When the no-crash assertion is evaluated
    // Then the no-crash outcome is "rejected"
    // And the reason is "process exited with code 1"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("reason: process exited with code 1");
  });

  it("rejects the crash evidence matrix row when the process exits with code 137", () => {
    const result = runNoCrashValidator(
      writeCrashEvidenceLog({ exitCode: 137, healthStatus: 200, restartDelta: 0 }),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And the container restart count changes by 0
    // And the Community bot process exit code is 137
    // And the latest `GET /health` response status is 200
    // When the no-crash assertion is evaluated
    // Then the no-crash outcome is "rejected"
    // And the reason is "process exited with code 137"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("reason: process exited with code 137");
  });

  it("rejects the crash evidence matrix row when health fails", () => {
    const result = runNoCrashValidator(
      writeCrashEvidenceLog({ exitCode: 0, healthStatus: 503, restartDelta: 0 }),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And the container restart count changes by 0
    // And the Community bot process exit code is 0
    // And the latest `GET /health` response status is 503
    // When the no-crash assertion is evaluated
    // Then the no-crash outcome is "rejected"
    // And the reason is "/health failed"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("reason: /health failed");
  });

  it("rejects no-crash validation when process exit evidence is missing", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "Container restart count after PR 104: 0",
        "Latest GET /health response status: 200",
      ].join("\n"),
    );

    const result = runNoCrashValidator(soakLogPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("reason: crash evidence is incomplete");
  });

  it("rejects no-crash validation when health evidence is malformed", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "Container restart count after PR 104: 0",
        "Community bot process exit code: 0",
        "Latest GET /health response status: unavailable",
      ].join("\n"),
    );

    const result = runNoCrashValidator(soakLogPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("reason: crash evidence is incomplete");
  });

  it("rejects no-crash validation when health fails during the smoke set", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "GET /health before PR 101: 200",
        "Container restart count after PR 104: 0",
        "Community bot process exit code: 0",
        "GET /health after PR 101: 200",
        "GET /health after PR 102: 503",
      ].join("\n"),
    );

    // Given health is 200 before PR 101
    // When health returns 503 after PR 102
    const result = runNoCrashValidator(soakLogPath);

    // Then the no-crash assertion fails
    // And the failure mentions "/health failed during the smoke PR set"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no-crash outcome: rejected");
    expect(result.stderr).toContain("/health failed during the smoke PR set");
  });

  it("uses the latest crash evidence line when duplicate fields are captured", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 qualifying=true",
        "Smoke PR: 102 qualifying=true",
        "Smoke PR: 103 qualifying=true",
        "Smoke PR: 104 qualifying=true",
        "Container restart count before PR 101: 0",
        "Container restart count after PR 104: 0",
        "Community bot process exit code: 1",
        "Community bot process exit code: 0",
        "Latest GET /health response status: 503",
        "Latest GET /health response status: 200",
      ].join("\n"),
    );

    const result = runNoCrashValidator(soakLogPath);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no-crash outcome: accepted");
    expect(result.stdout).toContain("reason: no crash evidence");
  });

  it("accepts GitHub App installation evidence with required access to the test repo", () => {
    const soakLogPath = writeSoakLog(
      [
        "Repository: mpiton/forgent",
        "Installed GitHub App: Sovri Community Bot",
        "Sovri Community Bot permission: pull_requests=write",
        "Sovri Community Bot permission: contents=read",
        "Sovri Community Bot permission: issues=write",
        "Sovri Community Bot permission: metadata=read",
        "Sovri Community Bot webhook event: pull_request",
        "Sovri Community Bot webhook event: issue_comment",
        "GitHub webhook delivered: pull_request.opened repo=mpiton/forgent signed=true",
        "GitHub API call: GET /repos/mpiton/forgent/pulls/101/files status=200",
        "GitHub API call: POST /repos/mpiton/forgent/pulls/101/reviews status=201",
      ].join("\n"),
    );

    // Given "Sovri Community Bot" is installed on "mpiton/forgent"
    // And the installation grants every required permission
    // And the installation subscribes to every required webhook event
    const result = runValidator([
      "github-app-installation",
      "--repo",
      "mpiton/forgent",
      "--expected-app",
      "Sovri Community Bot",
      "--soak-log",
      soakLogPath,
    ]);

    // Then GitHub delivers a signed pull_request.opened webhook
    // And Sovri can call the required pull request file and review endpoints
    // And the GitHub App installation assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("GitHub App installation assertion passed");
  });

  it("accepts GitHub App API access evidence for any pull request number", () => {
    const soakLogPath = writeSoakLog(
      [
        "Repository: mpiton/forgent",
        "Installed GitHub App: Sovri Community Bot",
        "Sovri Community Bot permission: pull_requests=write",
        "Sovri Community Bot permission: contents=read",
        "Sovri Community Bot permission: issues=write",
        "Sovri Community Bot permission: metadata=read",
        "Sovri Community Bot webhook event: pull_request",
        "Sovri Community Bot webhook event: issue_comment",
        "GitHub webhook delivered: pull_request.opened repo=mpiton/forgent signed=true",
        "GitHub API call: GET /repos/mpiton/forgent/pulls/202/files status=200",
        "GitHub API call: POST /repos/mpiton/forgent/pulls/202/reviews status=201",
      ].join("\n"),
    );

    const result = runValidator([
      "github-app-installation",
      "--repo",
      "mpiton/forgent",
      "--expected-app",
      "Sovri Community Bot",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("GitHub App installation assertion passed");
  });

  it("rejects a different GitHub App even when it has the required access", () => {
    const soakLogPath = writeSoakLog(
      [
        "Repository: mpiton/forgent",
        "Installed GitHub App: Other Review Bot",
        "Other Review Bot required permissions granted: true",
        "Other Review Bot required webhook events subscribed: true",
        "Installed GitHub App: Sovri Community Bot: false",
      ].join("\n"),
    );

    // Given "Other Review Bot" is installed on "mpiton/forgent"
    // And "Other Review Bot" grants every required permission
    // And "Other Review Bot" subscribes to every required webhook event
    // But "Sovri Community Bot" is not installed on "mpiton/forgent"
    // When the GitHub App installation assertion is evaluated
    const result = runValidator([
      "github-app-installation",
      "--repo",
      "mpiton/forgent",
      "--expected-app",
      "Sovri Community Bot",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the GitHub App installation assertion fails
    // And the failure mentions "Sovri Community Bot"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Sovri Community Bot");
  });

  it("rejects a missing GitHub App installation on the target repository", () => {
    const soakLogPath = writeSoakLog(
      [
        "Repository: mpiton/other-repo",
        "Installed GitHub App: Sovri Community Bot",
        "GitHub installation token: unavailable repo=mpiton/forgent",
      ].join("\n"),
    );

    // Given "Sovri Community Bot" is installed on "mpiton/other-repo"
    // But "Sovri Community Bot" is not installed on "mpiton/forgent"
    // When a pull request is opened in "mpiton/forgent"
    const result = runValidator([
      "github-app-installation",
      "--repo",
      "mpiton/forgent",
      "--expected-app",
      "Sovri Community Bot",
      "--soak-log",
      soakLogPath,
    ]);

    // Then GitHub does not deliver a usable installation token for "mpiton/forgent"
    // And the GitHub App installation assertion fails
    // And the failure mentions "app not installed on mpiton/forgent"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("app not installed on mpiton/forgent");
  });

  it.each([
    { access: "write", permission: "pull_requests" },
    { access: "read", permission: "contents" },
    { access: "write", permission: "issues" },
    { access: "read", permission: "metadata" },
  ])(
    "rejects GitHub App installation evidence missing $permission:$access",
    ({ access, permission }) => {
      const permissionLines = [
        "Sovri Community Bot permission: pull_requests=write",
        "Sovri Community Bot permission: contents=read",
        "Sovri Community Bot permission: issues=write",
        "Sovri Community Bot permission: metadata=read",
      ].filter((line) => line !== `Sovri Community Bot permission: ${permission}=${access}`);
      const soakLogPath = writeSoakLog(
        [
          "Repository: mpiton/forgent",
          "Installed GitHub App: Sovri Community Bot",
          ...permissionLines,
          "Sovri Community Bot webhook event: pull_request",
          "Sovri Community Bot webhook event: issue_comment",
          "GitHub webhook delivered: pull_request.opened repo=mpiton/forgent signed=true",
          "GitHub API call: GET /repos/mpiton/forgent/pulls/101/files status=200",
          "GitHub API call: POST /repos/mpiton/forgent/pulls/101/reviews status=201",
        ].join("\n"),
      );

      // Given "Sovri Community Bot" is installed on "mpiton/forgent"
      // And the installation is missing "<permission>: <access>"
      // When the GitHub App installation assertion is evaluated
      const result = runValidator([
        "github-app-installation",
        "--repo",
        "mpiton/forgent",
        "--expected-app",
        "Sovri Community Bot",
        "--soak-log",
        soakLogPath,
      ]);

      // Then the GitHub App installation assertion fails
      // And the failure mentions "<permission>: <access>"
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${permission}: ${access}`);
    },
  );

  it.each(["pull_request", "issue_comment"])(
    "rejects GitHub App installation evidence missing %s webhook subscription",
    (missingEvent) => {
      const eventLines = [
        "Sovri Community Bot webhook event: pull_request",
        "Sovri Community Bot webhook event: issue_comment",
      ].filter((line) => line !== `Sovri Community Bot webhook event: ${missingEvent}`);
      const soakLogPath = writeSoakLog(
        [
          "Repository: mpiton/forgent",
          "Installed GitHub App: Sovri Community Bot",
          "Sovri Community Bot permission: pull_requests=write",
          "Sovri Community Bot permission: contents=read",
          "Sovri Community Bot permission: issues=write",
          "Sovri Community Bot permission: metadata=read",
          ...eventLines,
          "GitHub webhook delivered: pull_request.opened repo=mpiton/forgent signed=true",
          "GitHub API call: GET /repos/mpiton/forgent/pulls/101/files status=200",
          "GitHub API call: POST /repos/mpiton/forgent/pulls/101/reviews status=201",
        ].join("\n"),
      );

      // Given "Sovri Community Bot" is installed on "mpiton/forgent"
      // And the installation grants every required permission
      // But the installation is not subscribed to the "<event>" webhook event
      // When the GitHub App installation assertion is evaluated
      const result = runValidator([
        "github-app-installation",
        "--repo",
        "mpiton/forgent",
        "--expected-app",
        "Sovri Community Bot",
        "--soak-log",
        soakLogPath,
      ]);

      // Then the GitHub App installation assertion fails
      // And the failure mentions "<event> event"
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${missingEvent} event`);
    },
  );

  it("rejects the expected GitHub App when it is installed on a different repository", () => {
    const soakLogPath = writeSoakLog(
      [
        "Repository: mpiton/forgent",
        "Installed GitHub App: Other Review Bot",
        "Other Review Bot required permissions granted: true",
        "Other Review Bot required webhook events subscribed: true",
        "Repository: mpiton/other-repo",
        "Installed GitHub App: Sovri Community Bot",
      ].join("\n"),
    );

    const result = runValidator([
      "github-app-installation",
      "--repo",
      "mpiton/forgent",
      "--expected-app",
      "Sovri Community Bot",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Sovri Community Bot");
  });

  it("excludes draft, 500-line, and wrong-branch PRs from the smoke PR count", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 target_branch=main draft=false changed_lines=128",
        "Smoke PR: 102 target_branch=main draft=true changed_lines=240",
        "Smoke PR: 103 target_branch=main draft=false changed_lines=500",
        "Smoke PR: 104 target_branch=main draft=false changed_lines=42",
        "Smoke PR: 105 target_branch=develop draft=false changed_lines=120",
      ].join("\n"),
    );

    // Given the smoke run contains these PRs:
    // | pr  | target_branch | draft | changed_lines |
    // | 101 | main          | false | 128           |
    // | 102 | main          | true  | 240           |
    // | 103 | main          | false | 500           |
    // | 104 | main          | false | 42            |
    // | 105 | develop       | false | 120           |
    // When the smoke PR count is evaluated
    const result = runValidator([
      "smoke-pr-count",
      "--target-branch",
      "main",
      "--minimum-count",
      "4",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the qualifying PR count is 2
    // And PR 102 is excluded because it is a draft
    // And PR 103 is excluded because changed lines are not < 500
    // And PR 105 is excluded because it does not target "main"
    // And the smoke PR count assertion fails
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("qualifying PR count: 2");
    expect(result.stderr).toContain("PR 102 is excluded because it is a draft");
    expect(result.stderr).toContain("PR 103 is excluded because changed lines are not < 500");
    expect(result.stderr).toContain('PR 105 is excluded because it does not target "main"');
  });

  it("classifies five qualifying PRs as the target smoke count", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 target_branch=main draft=false changed_lines=128",
        "Smoke PR: 102 target_branch=main draft=false changed_lines=240",
        "Smoke PR: 103 target_branch=main draft=false changed_lines=499",
        "Smoke PR: 104 target_branch=main draft=false changed_lines=42",
        "Smoke PR: 105 target_branch=main draft=false changed_lines=312",
      ].join("\n"),
    );

    // Given the smoke run contains five non-draft PRs on main below 500 changed lines
    // When the smoke PR count is evaluated
    const result = runValidator([
      "smoke-pr-count",
      "--target-branch",
      "main",
      "--minimum-count",
      "4",
      "--target-count",
      "5",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the qualifying PR count is 5
    // And the smoke run is classified as "target count reached"
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("qualifying PR count: 5");
    expect(result.stdout).toContain("smoke run classification: target count reached");
    expect(result.stdout).toContain("smoke PR count assertion passed");
  });

  it("classifies four qualifying PRs as the minimum smoke count", () => {
    const soakLogPath = writeSoakLog(
      [
        "Smoke PR: 101 target_branch=main draft=false changed_lines=128",
        "Smoke PR: 102 target_branch=main draft=false changed_lines=240",
        "Smoke PR: 103 target_branch=main draft=false changed_lines=499",
        "Smoke PR: 104 target_branch=main draft=false changed_lines=42",
      ].join("\n"),
    );

    // Given the smoke run contains four non-draft PRs on main below 500 changed lines
    // When the smoke PR count is evaluated
    const result = runValidator([
      "smoke-pr-count",
      "--target-branch",
      "main",
      "--minimum-count",
      "4",
      "--target-count",
      "5",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the qualifying PR count is 4
    // And the smoke run is classified as "minimum count reached"
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("qualifying PR count: 4");
    expect(result.stdout).toContain("smoke run classification: minimum count reached");
    expect(result.stdout).toContain("smoke PR count assertion passed");
  });

  it.each([
    {
      changedLines: 0,
      classification: "excluded",
      draft: false,
      expectedStatus: "rejected",
      pr: "101",
      reason: "no changed lines",
      targetBranch: "main",
    },
    {
      changedLines: 1,
      classification: "included",
      draft: false,
      expectedStatus: "accepted",
      pr: "106",
      reason: "at least one changed line",
      targetBranch: "main",
    },
    {
      changedLines: 499,
      classification: "included",
      draft: false,
      expectedStatus: "accepted",
      pr: "102",
      reason: "below 500 changed lines",
      targetBranch: "main",
    },
    {
      changedLines: 500,
      classification: "excluded",
      draft: false,
      expectedStatus: "rejected",
      pr: "103",
      reason: "changed lines are not < 500",
      targetBranch: "main",
    },
    {
      changedLines: 120,
      classification: "excluded",
      draft: true,
      expectedStatus: "rejected",
      pr: "104",
      reason: "draft PR",
      targetBranch: "main",
    },
    {
      changedLines: 120,
      classification: "excluded",
      draft: false,
      expectedStatus: "rejected",
      pr: "105",
      reason: "wrong target branch",
      targetBranch: "develop",
    },
  ])(
    "classifies PR $pr as $classification because $reason",
    ({ changedLines, classification, draft, expectedStatus, pr, reason, targetBranch }) => {
      const soakLogPath = writeSoakLog(
        [
          `Smoke PR: ${pr} target_branch=${targetBranch} draft=${draft} changed_lines=${changedLines}`,
        ].join("\n"),
      );

      const result = runValidator([
        "smoke-pr-count",
        "--target-branch",
        "main",
        "--minimum-count",
        "1",
        "--target-count",
        "1",
        "--soak-log",
        soakLogPath,
      ]);

      const output = expectedStatus === "accepted" ? result.stdout : result.stderr;

      expect(result.status === 0 ? "accepted" : "rejected").toBe(expectedStatus);
      expect(output).toContain(`PR ${pr} qualification: ${classification} reason=${reason}`);
    },
  );

  it.each(["not-a-number", "4oops", "-1"])(
    "rejects malformed minimum smoke PR count argument %s",
    (minimumCount) => {
      const soakLogPath = writeSoakLog(
        [
          "Smoke PR: 101 target_branch=main draft=false changed_lines=128",
          "Smoke PR: 102 target_branch=main draft=false changed_lines=240",
          "Smoke PR: 103 target_branch=main draft=false changed_lines=42",
          "Smoke PR: 104 target_branch=main draft=false changed_lines=120",
        ].join("\n"),
      );

      const result = runValidator([
        "smoke-pr-count",
        "--target-branch",
        "main",
        "--minimum-count",
        minimumCount,
        "--soak-log",
        soakLogPath,
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--minimum-count is invalid");
    },
  );

  it("fails soak log validation when a qualifying PR has duplicate evidence rows", () => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
        "| https://github.com/mpiton/forgent/pull/101 | 32.100s | 1 | 3 |",
        "| https://github.com/mpiton/forgent/pull/102 | 44.800s | 1 | 3 |",
        "| https://github.com/mpiton/forgent/pull/103 | 58.400s | 3 | 4 |",
        "| https://github.com/mpiton/forgent/pull/104 | 76.300s | 0 | 3 |",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And "evals/v0.1-soak.md" contains two rows for "https://github.com/mpiton/forgent/pull/101"
    // When the soak log is validated
    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--qualifying-pr",
      "102",
      "--qualifying-pr",
      "103",
      "--qualifying-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the soak log content assertion fails
    // And the failure mentions "duplicate evidence row for PR 101"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("duplicate evidence row for PR 101");
  });

  it("fails soak log validation when a qualifying PR row is missing", () => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
        "| https://github.com/mpiton/forgent/pull/102 | 44.800s | 1 | 3 |",
        "| https://github.com/mpiton/forgent/pull/103 | 58.400s | 3 | 4 |",
      ].join("\n"),
    );

    // Given the smoke set contains qualifying PRs 101, 102, 103, and 104
    // And "evals/v0.1-soak.md" contains rows for PRs 101, 102, and 103
    // When the soak log is validated
    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--qualifying-pr",
      "102",
      "--qualifying-pr",
      "103",
      "--qualifying-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the soak log content assertion fails
    // And the failure mentions "missing evidence row for PR 104"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing evidence row for PR 104");
  });

  it("does not count free-text PR URLs as soak log evidence rows", () => {
    const soakLogPath = writeSoakLog(
      [
        "Operator note: PR https://github.com/mpiton/forgent/pull/104 was reviewed manually",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
        "| https://github.com/mpiton/forgent/pull/102 | 44.800s | 1 | 3 |",
        "| https://github.com/mpiton/forgent/pull/103 | 58.400s | 3 | 4 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--qualifying-pr",
      "102",
      "--qualifying-pr",
      "103",
      "--qualifying-pr",
      "104",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing evidence row for PR 104");
  });

  it.each([
    {
      field: "PR URL",
      rows: [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| | 31.200s | 2 | 4 |",
      ],
    },
    {
      field: "latency",
      rows: [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | | 2 | 4 |",
      ],
    },
    {
      field: "finding count",
      rows: [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | | 4 |",
      ],
    },
    {
      field: "manual quality rating",
      rows: [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | |",
      ],
    },
  ])("fails soak log validation when required field $field is omitted", ({ field, rows }) => {
    const soakLogPath = writeSoakLog(rows.join("\n"));

    // Given "evals/v0.1-soak.md" contains a row for "https://github.com/mpiton/forgent/pull/101"
    // And the row omits "<field>"
    // When the soak log is validated
    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the soak log content assertion fails
    // And the failure mentions "<field>"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(field);
  });

  it("ignores unrelated Markdown tables before the soak evidence table", () => {
    const soakLogPath = writeSoakLog(
      [
        "| metric | latency |",
        "| --- | --- |",
        "| startup | 12s |",
        "",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    {
      outcome: "rejected",
      rating: "0",
      reason: "rating is below the 1-5 scale",
    },
    {
      outcome: "rejected",
      rating: "1",
      reason: "review is not coherent enough",
    },
    {
      outcome: "rejected",
      rating: "2",
      reason: "review is not coherent enough",
    },
    {
      outcome: "accepted",
      rating: "3",
      reason: "coherent but noisy",
    },
    {
      outcome: "accepted",
      rating: "5",
      reason: "merge-review quality",
    },
    {
      outcome: "rejected",
      rating: "6",
      reason: "rating is above the 1-5 scale",
    },
  ])("classifies manual quality rating $rating as $outcome", ({ outcome, rating, reason }) => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        `| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | ${rating} |`,
      ].join("\n"),
    );

    // Given "evals/v0.1-soak.md" contains a row for "https://github.com/mpiton/forgent/pull/101"
    // And the manual quality rating is <rating>
    // When the soak log is validated
    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);
    const output = outcome === "accepted" ? result.stdout : result.stderr;

    // Then the quality rating outcome is "<outcome>"
    // And the reason is "<reason>"
    expect(result.status === 0 ? "accepted" : "rejected").toBe(outcome);
    expect(output).toContain(`quality rating outcome: ${outcome}`);
    expect(output).toContain(`reason: ${reason}`);
  });

  it("uses the complete soak evidence table when an earlier Markdown table also has a PR URL column", () => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | note |",
        "| --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | queued for smoke |",
        "",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status, result.stderr).toBe(0);
  });

  it("uses the target repository soak evidence table when an earlier complete table belongs to another repository", () => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/other-repo/pull/101 | 12.000s | 0 | 3 |",
        "",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status, result.stderr).toBe(0);
  });

  it("aggregates target repository evidence rows across multiple complete soak tables", () => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
        "",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/102 | 44.800s | 1 | 3 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--qualifying-pr",
      "102",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status, result.stderr).toBe(0);
  });

  it("fails committed soak log evidence when no PR rows are present", () => {
    const soakLogPath = writeSoakLog(
      [
        "Evidence repository: mpiton/sovri",
        "Committed soak log path: evals/v0.1-soak.md",
        "Latest evidence commit SHA: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
      ].join("\n"),
    );

    // Given "evals/v0.1-soak.md" is committed in "mpiton/sovri"
    // And the committed file has 0 PR evidence rows
    // When the committed evidence is inspected
    const result = runValidator([
      "soak-log-commit",
      "--repo",
      "mpiton/sovri",
      "--path",
      "evals/v0.1-soak.md",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the soak log commit assertion fails
    // And the failure mentions "soak log has no PR evidence rows"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("soak log has no PR evidence rows");
  });

  it("fails committed soak log evidence when metadata only partially matches", () => {
    const soakLogPath = writeSoakLog(
      [
        "Evidence repository: mpiton/sovri-fork",
        "Committed soak log path: evals/v0.1-soak.md.bak",
        "Latest evidence commit SHA: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/sovri/pull/101 | 31.200s | 2 | 4 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-commit",
      "--repo",
      "mpiton/sovri",
      "--path",
      "evals/v0.1-soak.md",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("soak log must be committed to mpiton/sovri");
  });

  it("fails committed soak log evidence when PR rows belong to another repository", () => {
    const soakLogPath = writeSoakLog(
      [
        "Evidence repository: mpiton/sovri",
        "Committed soak log path: evals/v0.1-soak.md",
        "Latest evidence commit SHA: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | 2 | 4 |",
      ].join("\n"),
    );

    const result = runValidator([
      "soak-log-commit",
      "--repo",
      "mpiton/sovri",
      "--path",
      "evals/v0.1-soak.md",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("soak log has no PR evidence rows");
  });

  it("fails committed soak log evidence when the soak log is untracked locally", () => {
    const soakLogPath = writeSoakLog(
      [
        "Evidence repository: mpiton/sovri",
        "Committed soak log path: evals/v0.1-soak.md",
        "Latest evidence commit SHA: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "git status --short evals/v0.1-soak.md: ?? evals/v0.1-soak.md",
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/sovri/pull/101 | 31.200s | 2 | 4 |",
      ].join("\n"),
    );

    // Given "evals/v0.1-soak.md" exists only in the working tree
    // And `git status --short evals/v0.1-soak.md` reports "?? evals/v0.1-soak.md"
    // When the committed evidence is inspected
    const result = runValidator([
      "soak-log-commit",
      "--repo",
      "mpiton/sovri",
      "--path",
      "evals/v0.1-soak.md",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the soak log commit assertion fails
    // And the failure mentions "soak log must be committed"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("soak log must be committed");
  });

  it("accepts escaped private key newline startup evidence", () => {
    const soakLogPath = writeSoakLog(
      [
        "PRIVATE_KEY storage: escaped-newlines",
        "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
        "Private key line break normalization: true",
        "Community bot startup: success",
      ].join("\n"),
    );

    // Given `PRIVATE_KEY` is stored as one environment value with literal "\n" line breaks
    // And the value decodes to a valid 2048-bit RSA PEM key
    // When the Community bot starts
    const result = runValidator(["private-key-newlines", "--soak-log", soakLogPath]);

    // Then Sovri normalizes the private key line breaks
    // And startup succeeds
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("private key newline assertion passed");
  });

  it("rejects invalid private key material before webhook processing", () => {
    const soakLogPath = writeSoakLog(
      [
        "APP_ID value: 123456",
        "WEBHOOK_SECRET configured: true",
        "PRIVATE_KEY value: not-a-private-key",
        "Community bot startup: failed before webhook processing",
        "Startup failure reason: PRIVATE_KEY must contain valid PEM private key material",
        "Webhook processing: not started",
      ].join("\n"),
    );

    // Given `APP_ID` is "123456"
    // And `WEBHOOK_SECRET` is "WEBHOOK_SECRET_SENTINEL_60"
    // And `PRIVATE_KEY` is "not-a-private-key"
    // When the Community bot starts
    const result = runValidator(["private-key-startup-failure", "--soak-log", soakLogPath]);

    // Then startup fails before processing webhooks
    // And the failure mentions "PRIVATE_KEY"
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("private key startup failure assertion passed");
  });

  it("accepts invalid private key startup evidence with non-fixture credential values", () => {
    const soakLogPath = writeSoakLog(
      [
        "APP_ID value: 12345",
        "WEBHOOK_SECRET configured: true",
        "PRIVATE_KEY value: broken-pem",
        "Community bot startup: failed before webhook processing",
        "Startup failure reason: PRIVATE_KEY must contain valid PEM private key material",
        "Webhook processing: not started",
      ].join("\n"),
    );

    const result = runValidator(["private-key-startup-failure", "--soak-log", soakLogPath]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("private key startup failure assertion passed");
  });

  it.each(["APP_ID", "WEBHOOK_SECRET", "PRIVATE_KEY"])(
    "rejects startup evidence when %s is omitted",
    (variable) => {
      const soakLogPath = writeSoakLog(
        [
          `Runtime environment omitted: ${variable}`,
          "Community bot startup: failed before webhook processing",
          `Startup failure reason: ${variable} is required`,
          "Webhook processing: not started",
        ].join("\n"),
      );

      // Given the runtime environment omits "<variable>"
      // When the Community bot starts
      const result = runValidator([
        "runtime-startup-failure",
        "--variable",
        variable,
        "--soak-log",
        soakLogPath,
      ]);

      // Then startup fails before processing webhooks
      // And the failure mentions "<variable>"
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("runtime startup failure assertion passed");
    },
  );

  it.each(["not-a-num", "12.34", "-123", "0"])(
    "accepts malformed APP_ID startup failure evidence for %s",
    (appId) => {
      const soakLogPath = writeSoakLog(
        [
          `APP_ID value: ${appId}`,
          "WEBHOOK_SECRET configured: true",
          "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
          "Community bot startup: failed before webhook processing",
          "Startup failure reason: APP_ID must be a positive integer",
          "Webhook processing: not started",
        ].join("\n"),
      );

      // Given `APP_ID` is "<app_id>"
      // And `WEBHOOK_SECRET` is "WEBHOOK_SECRET_SENTINEL_60"
      // And `PRIVATE_KEY` contains valid PEM private key material
      // When the Community bot starts
      const result = runValidator(["app-id-startup-failure", "--soak-log", soakLogPath]);

      // Then startup fails before processing webhooks
      // And the failure mentions "APP_ID"
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("APP_ID startup failure assertion passed");
    },
  );

  it("rejects missing APP_ID startup evidence for the malformed APP_ID assertion", () => {
    const soakLogPath = writeSoakLog(
      [
        "APP_ID value: ",
        "WEBHOOK_SECRET configured: true",
        "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
        "Community bot startup: failed before webhook processing",
        "Startup failure reason: APP_ID is required",
        "Webhook processing: not started",
      ].join("\n"),
    );

    const result = runValidator(["app-id-startup-failure", "--soak-log", soakLogPath]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("APP_ID startup failure assertion failed");
  });

  it("rejects whitespace-padded numeric APP_ID evidence for the malformed APP_ID assertion", () => {
    const soakLogPath = writeSoakLog(
      [
        "APP_ID value:  123 ",
        "WEBHOOK_SECRET configured: true",
        "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
        "Community bot startup: failed before webhook processing",
        "Startup failure reason: APP_ID must be a positive integer",
        "Webhook processing: not started",
      ].join("\n"),
    );

    const result = runValidator(["app-id-startup-failure", "--soak-log", soakLogPath]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("APP_ID startup failure assertion failed");
  });

  it("accepts overflowed numeric APP_ID startup failure evidence", () => {
    const soakLogPath = writeSoakLog(
      [
        `APP_ID value: ${"9".repeat(400)}`,
        "WEBHOOK_SECRET configured: true",
        "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
        "Community bot startup: failed before webhook processing",
        "Startup failure reason: APP_ID must be a positive integer",
        "Webhook processing: not started",
      ].join("\n"),
    );

    const result = runValidator(["app-id-startup-failure", "--soak-log", soakLogPath]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("APP_ID startup failure assertion passed");
  });

  it("accepts wrong webhook secret rejection evidence", () => {
    const soakLogPath = writeSoakLog(
      [
        "WEBHOOK_SECRET configured: true",
        "Repository: mpiton/forgent",
        "PR: 101",
        "GitHub webhook delivered: pull_request.opened repo=mpiton/forgent signed=false",
        "Webhook signature verification: rejected",
        "Review work started: false",
        "First PR comment posted: false",
        "GitHub credential wiring assertion: failed",
      ].join("\n"),
    );

    // Given `WEBHOOK_SECRET` is configured
    // When GitHub delivers PR 101 with a signature computed from the wrong secret
    const result = runValidator([
      "webhook-secret",
      "--repo",
      "mpiton/forgent",
      "--pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);

    // Then Sovri rejects the webhook before starting review work
    // And no first review comment is posted on PR 101
    // And the GitHub credential wiring assertion fails
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("webhook secret rejection assertion passed");
  });

  it("passes latency validation when five qualifying PRs stay below ninety seconds", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR: 101 delivery_id=delivery-60-101 changed_lines=128 latency_seconds=31.200",
        "Latency PR: 102 delivery_id=delivery-60-102 changed_lines=240 latency_seconds=44.800",
        "Latency PR: 103 delivery_id=delivery-60-103 changed_lines=499 latency_seconds=58.400",
        "Latency PR: 104 delivery_id=delivery-60-104 changed_lines=42 latency_seconds=76.300",
        "Latency PR: 105 delivery_id=delivery-60-105 changed_lines=312 latency_seconds=89.999",
      ].join("\n"),
    );

    // Given the smoke set has five qualifying PR measurements below 90 seconds
    // When the smoke latency assertion is evaluated
    const result = runValidator(["latency-p95", "--soak-log", soakLogPath]);

    // Then the nearest-rank p95 is the maximum observed latency
    // And the latency assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("p95 latency: 89.999 seconds");
    expect(result.stdout).toContain("latency assertion passed");
  });

  it("passes latency validation when four qualifying PRs stay below ninety seconds", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR: 101 delivery_id=delivery-60-101 changed_lines=128 latency_seconds=31.200",
        "Latency PR: 102 delivery_id=delivery-60-102 changed_lines=240 latency_seconds=44.800",
        "Latency PR: 103 delivery_id=delivery-60-103 changed_lines=499 latency_seconds=58.400",
        "Latency PR: 104 delivery_id=delivery-60-104 changed_lines=42 latency_seconds=89.999",
      ].join("\n"),
    );

    // Given the smoke set has four qualifying PR measurements below 90 seconds
    // When the smoke latency assertion is evaluated
    const result = runValidator(["latency-p95", "--soak-log", soakLogPath]);

    // Then the nearest-rank p95 is the maximum observed latency
    // And the latency assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("p95 latency: 89.999 seconds");
    expect(result.stdout).toContain("latency assertion passed");
  });

  it("fails latency validation when p95 is exactly ninety seconds", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR: 101 delivery_id=delivery-60-101 changed_lines=128 latency_seconds=31.200",
        "Latency PR: 102 delivery_id=delivery-60-102 changed_lines=240 latency_seconds=44.800",
        "Latency PR: 103 delivery_id=delivery-60-103 changed_lines=499 latency_seconds=58.400",
        "Latency PR: 104 delivery_id=delivery-60-104 changed_lines=42 latency_seconds=90.000",
      ].join("\n"),
    );

    // Given the smoke set has qualifying PR measurements up to exactly 90.000 seconds
    // When the smoke latency assertion is evaluated
    const result = runValidator(["latency-p95", "--soak-log", soakLogPath]);

    // Then the p95 latency is 90.000 seconds
    // And the latency assertion fails
    // And the failure mentions "p95 latency must be < 90 s"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("p95 latency: 90.000 seconds");
    expect(result.stderr).toContain("p95 latency must be < 90 s");
  });

  it.each([
    {
      additions: 0,
      changedLines: 0,
      classification: "excluded",
      deletions: 0,
      pr: "108",
    },
    {
      additions: 498,
      changedLines: 499,
      classification: "included",
      deletions: 1,
      pr: "103",
    },
    {
      additions: 499,
      changedLines: 500,
      classification: "excluded",
      deletions: 1,
      pr: "106",
    },
    {
      additions: 500,
      changedLines: 500,
      classification: "excluded",
      deletions: 0,
      pr: "107",
    },
  ])(
    "classifies PR $pr as $classification for the latency sample",
    ({ additions, changedLines, classification, deletions, pr }) => {
      // Given PR <pr> has <additions> additions and <deletions> deletions
      const result = runValidator([
        "latency-pr-filter",
        "--pr",
        pr,
        "--additions",
        additions.toString(),
        "--deletions",
        deletions.toString(),
      ]);

      // When the qualifying PR filter is evaluated
      // Then the changed line count is <changed_lines>
      // And the PR is "<classification>" for the latency sample
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`changed line count: ${changedLines}`);
      expect(result.stdout).toContain(`latency sample classification: ${classification}`);
    },
  );

  it("fails soak log validation when the finding count is negative", () => {
    const soakLogPath = writeSoakLog(
      [
        "| PR URL | latency | finding count | manual quality rating |",
        "| --- | --- | --- | --- |",
        "| https://github.com/mpiton/forgent/pull/101 | 31.200s | -1 | 4 |",
      ].join("\n"),
    );

    // Given "evals/v0.1-soak.md" contains a row for "https://github.com/mpiton/forgent/pull/101"
    // And the finding count is "-1"
    // When the soak log is validated
    const result = runValidator([
      "soak-log-content",
      "--repo",
      "mpiton/forgent",
      "--qualifying-pr",
      "101",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the soak log content assertion fails
    // And the failure mentions "finding count must be a non-negative integer"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("finding count must be a non-negative integer");
  });

  it.each(["eighty", "80", "80ms", "2026-05-22", ""])(
    "fails soak log validation when latency is %s",
    (latency) => {
      const soakLogPath = writeSoakLog(
        [
          "| PR URL | latency | finding count | manual quality rating |",
          "| --- | --- | --- | --- |",
          `| https://github.com/mpiton/forgent/pull/101 | ${latency} | 2 | 4 |`,
        ].join("\n"),
      );

      // Given "evals/v0.1-soak.md" contains a row for "https://github.com/mpiton/forgent/pull/101"
      // And the latency field is "<latency>"
      // When the soak log is validated
      const result = runValidator([
        "soak-log-content",
        "--repo",
        "mpiton/forgent",
        "--qualifying-pr",
        "101",
        "--soak-log",
        soakLogPath,
      ]);

      // Then the soak log content assertion fails
      // And the failure mentions "latency must be a duration in seconds"
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("latency must be a duration in seconds");
    },
  );

  it("uses the first Sovri PR comment when measuring latency", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR metadata: pr=101 delivery_id=delivery-60-101 changed_lines=128",
        "Webhook received: delivery_id=delivery-60-101 at=2026-05-22T10:00:00Z",
        "Sovri PR comment: pr=101 created_at=2026-05-22T10:01:20Z",
        "Sovri PR comment: pr=101 created_at=2026-05-22T10:03:10Z",
      ].join("\n"),
    );

    // Given PR 101 has 128 changed lines
    // And the first container log line for delivery ID "delivery-60-101" is at "2026-05-22T10:00:00Z"
    // And Sovri posted a PR comment on PR 101 at "2026-05-22T10:01:20Z"
    // And Sovri posted a later PR comment on PR 101 at "2026-05-22T10:03:10Z"
    // When the smoke latency assertion is evaluated for PR 101
    const result = runValidator([
      "latency-pr",
      "--pr",
      "101",
      "--delivery-id",
      "delivery-60-101",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the measured latency is 80.000 seconds
    // And the later PR comment is ignored for latency
    // And the latency assertion passes
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("measured latency: 80.000 seconds");
    expect(result.stdout).toContain("later PR comments ignored: true");
  });

  it("fails latency evidence when the first Sovri PR comment is missing", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR metadata: pr=101 delivery_id=delivery-60-101 changed_lines=128",
        "Webhook received: delivery_id=delivery-60-101 at=2026-05-22T10:00:00Z",
      ].join("\n"),
    );

    // Given PR 101 has 128 changed lines
    // And the first container log line for delivery ID "delivery-60-101" is at "2026-05-22T10:00:00Z"
    // But no Sovri PR comment exists on PR 101
    // When the smoke latency assertion is evaluated for PR 101
    const result = runValidator([
      "latency-pr",
      "--pr",
      "101",
      "--delivery-id",
      "delivery-60-101",
      "--soak-log",
      soakLogPath,
    ]);

    // Then the latency assertion fails
    // And the failure mentions "missing first Sovri PR comment timestamp"
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing first Sovri PR comment timestamp");
  });

  it("rejects latency evidence when all comments predate webhook receipt", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR metadata: pr=101 delivery_id=delivery-60-101 changed_lines=128",
        "Webhook received: delivery_id=delivery-60-101 at=2026-05-22T10:01:20Z",
        "Sovri PR comment: pr=101 created_at=2026-05-22T10:00:00Z",
      ].join("\n"),
    );

    const result = runValidator([
      "latency-pr",
      "--pr",
      "101",
      "--delivery-id",
      "delivery-60-101",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "missing first Sovri PR comment timestamp after webhook receipt",
    );
  });

  it("uses the first Sovri PR comment after webhook receipt when stale comments exist", () => {
    const soakLogPath = writeSoakLog(
      [
        "Latency PR metadata: pr=101 delivery_id=delivery-60-101 changed_lines=128",
        "Sovri PR comment: pr=101 created_at=2026-05-22T09:59:30Z",
        "Webhook received: delivery_id=delivery-60-101 at=2026-05-22T10:00:00Z",
        "Sovri PR comment: pr=101 created_at=2026-05-22T10:01:20Z",
        "Sovri PR comment: pr=101 created_at=2026-05-22T10:03:10Z",
      ].join("\n"),
    );

    const result = runValidator([
      "latency-pr",
      "--pr",
      "101",
      "--delivery-id",
      "delivery-60-101",
      "--soak-log",
      soakLogPath,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("measured latency: 80.000 seconds");
    expect(result.stdout).toContain("later PR comments ignored: true");
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

function runNoCrashValidator(soakLogPath: string): ReturnType<typeof spawnSync> {
  return runNoCrashValidatorForRange(soakLogPath, { fromPr: "101", toPr: "104" });
}

function runNoCrashValidatorForRange(
  soakLogPath: string,
  range: { readonly fromPr: string; readonly toPr: string },
): ReturnType<typeof spawnSync> {
  return runValidator([
    "no-crash",
    "--from-pr",
    range.fromPr,
    "--to-pr",
    range.toPr,
    "--soak-log",
    soakLogPath,
  ]);
}

function writeCrashEvidenceLog(input: {
  readonly exitCode: number;
  readonly healthStatus: number;
  readonly restartDelta: number;
}): string {
  return writeSoakLog(
    [
      "Smoke PR: 101 qualifying=true",
      "Smoke PR: 102 qualifying=true",
      "Smoke PR: 103 qualifying=true",
      "Smoke PR: 104 qualifying=true",
      "Container restart count before PR 101: 0",
      `Container restart count after PR 104: ${input.restartDelta}`,
      `Community bot process exit code: ${input.exitCode}`,
      `Latest GET /health response status: ${input.healthStatus}`,
    ].join("\n"),
  );
}
