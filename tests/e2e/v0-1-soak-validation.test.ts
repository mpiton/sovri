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
  return runValidator([
    "no-crash",
    "--from-pr",
    "101",
    "--to-pr",
    "104",
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
