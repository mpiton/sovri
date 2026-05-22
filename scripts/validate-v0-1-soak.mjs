#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

const GHCR_IMAGE = "ghcr.io/mpiton/sovri/community-bot:v0.1.0";
const LOCAL_BUILD_EVIDENCE =
  /built sovri\/community-bot:smoke from Dockerfile at commit [0-9a-f]{40}/u;

const args = process.argv.slice(2);
const command = args[0];

if (command === "image-provenance") {
  const provenanceMode = readOption("--provenance-mode");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasAcceptedImageProvenance(soakLog, provenanceMode)) {
    fail("image provenance assertion failed");
  }
} else if (command === "anthropic-key") {
  const prNumber = readOption("--pr");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (hasAnthropicAuthenticationFailure(soakLog, prNumber)) {
    fail("Anthropic key wiring assertion failed");
  }
  const repoFullName = readOption("--repo");
  const changedLines = readOption("--changed-lines");
  if (hasSuccessfulAnthropicWiring(soakLog, { changedLines, prNumber, repoFullName })) {
    process.stdout.write("Anthropic key wiring assertion passed\n");
  } else {
    fail("Anthropic key wiring evidence is incomplete");
  }
} else if (command === "provider-logs") {
  const provider = readOption("--provider");
  const secret = readOption("--secret");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (hasProviderErrorLogWithoutSecret(soakLog, { provider, secret })) {
    process.stdout.write("provider log assertion passed\n");
  } else {
    fail("provider log assertion failed");
  }
} else if (command === "log-secrets") {
  const secretName = readOption("--secret-name");
  const secretValues = readOptions("--secret-value");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const capturedLogLines = readCapturedLogLines(soakLog);

  if (capturedLogLines.length === 0) {
    fail("captured logs are missing");
  }
  if (secretValues.some((secretValue) => capturedLogsContain(capturedLogLines, secretValue))) {
    fail(`log secret assertion failed: ${secretName}`);
  }
  process.stdout.write("log secret assertion passed\n");
} else if (command === "no-crash") {
  const fromPr = readOption("--from-pr");
  const toPr = readOption("--to-pr");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const noCrashResult = evaluateNoCrashEvidence(soakLog, {
    fromPr,
    toPr,
  });

  if (noCrashResult.outcome === "rejected") {
    failNoCrash(noCrashResult);
  }
  process.stdout.write("no-crash outcome: accepted\n");
  process.stdout.write(`reason: ${noCrashResult.reason}\n`);
} else if (command === "github-app-installation") {
  const expectedApp = readOption("--expected-app");
  const repoFullName = readOption("--repo");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasExpectedGitHubAppInstallation(soakLog, { expectedApp, repoFullName })) {
    fail(`GitHub App installation assertion failed: ${expectedApp}`);
  }
} else {
  fail(
    "usage: validate-v0-1-soak.mjs <image-provenance|anthropic-key|provider-logs|log-secrets|no-crash|github-app-installation> [options]",
  );
}

function hasAcceptedImageProvenance(content, mode) {
  if (mode === "GHCR pull") {
    return content.includes(`pulled ${GHCR_IMAGE}`);
  }

  if (mode === "local build") {
    return LOCAL_BUILD_EVIDENCE.test(content);
  }

  return false;
}

function hasAnthropicAuthenticationFailure(content, prNumber) {
  return (
    content.includes("ANTHROPIC_API_KEY value: invalid") &&
    content.includes(`PR: ${prNumber}`) &&
    content.includes("Anthropic HTTP status: 401") &&
    content.includes("Successful review comment posted: false") &&
    content.includes("Container restart count: 0") &&
    content.includes("Health status after failed review: 200")
  );
}

function hasSuccessfulAnthropicWiring(content, expected) {
  return (
    content.includes("ANTHROPIC_API_KEY value: valid Anthropic API key") &&
    content.includes(`Repository: ${expected.repoFullName}`) &&
    content.includes(`PR: ${expected.prNumber}`) &&
    content.includes(`Changed lines: ${expected.changedLines}`) &&
    content.includes("Structured Anthropic response received: true") &&
    content.includes("First PR comment posted: true")
  );
}

function hasProviderErrorLogWithoutSecret(content, expected) {
  const capturedLogLines = readCapturedLogLines(content);
  return (
    capturedLogLines.length > 0 &&
    capturedLogLines.every((line) => !line.includes(expected.secret)) &&
    capturedLogLines.some((line) => line.includes(`provider=${expected.provider}`))
  );
}

function readCapturedLogLines(content) {
  return content.split(/\r?\n/u).filter((line) => line.startsWith("Captured log:"));
}

function capturedLogsContain(capturedLogLines, needle) {
  return capturedLogLines.some((line) => line.includes(needle));
}

function hasExpectedGitHubAppInstallation(content, expected) {
  const lines = content.split(/\r?\n/u);
  let currentRepo;

  for (const line of lines) {
    if (line.startsWith("Repository: ")) {
      currentRepo = line.slice("Repository: ".length);
    }
    if (
      currentRepo === expected.repoFullName &&
      line === `Installed GitHub App: ${expected.expectedApp}`
    ) {
      return true;
    }
  }

  return false;
}

function evaluateNoCrashEvidence(content, range) {
  const prRange = readPrRange(range);
  const before = readRestartCountBeforePr(content, range.fromPr);
  const afterCounts = prRange === undefined ? [] : readRestartCountsAfterPr(content, prRange);

  if (prRange === undefined || before === undefined || afterCounts.length === 0) {
    return rejectedNoCrash("restart evidence is incomplete");
  }

  if (afterCounts.some((after) => after.restartCount > before)) {
    return rejectedNoCrash("container restarted", "container restarted during the smoke PR set");
  }

  if (!afterCounts.some((after) => after.prNumber >= prRange.toPr)) {
    return rejectedNoCrash("restart evidence is incomplete");
  }

  const exitCode = readCommunityBotProcessExitCode(content);
  if (exitCode === undefined) {
    return rejectedNoCrash("crash evidence is incomplete");
  }
  if (exitCode !== 0) {
    return rejectedNoCrash(`process exited with code ${exitCode}`);
  }

  const healthStatus = readLatestHealthStatus(content);
  if (healthStatus === undefined) {
    return rejectedNoCrash("crash evidence is incomplete");
  }
  if (healthStatus !== 200) {
    return rejectedNoCrash("/health failed");
  }

  return { outcome: "accepted", reason: "no crash evidence" };
}

function readRestartCountsAfterPr(content, range) {
  const afterMatches = [...content.matchAll(/Container restart count after PR (\d+): (\d+)/gu)];

  return afterMatches.flatMap((match) => {
    const prNumber = Number.parseInt(match[1], 10);
    const restartCount = Number.parseInt(match[2], 10);

    if (prNumber < range.fromPr || prNumber > range.toPr) {
      return [];
    }

    return [{ prNumber, restartCount }];
  });
}

function readPrRange(range) {
  const fromPr = Number.parseInt(range.fromPr, 10);
  const toPr = Number.parseInt(range.toPr, 10);

  if (Number.isNaN(fromPr) || Number.isNaN(toPr)) {
    return undefined;
  }

  return { fromPr, toPr };
}

function readRestartCountBeforePr(content, prNumber) {
  const prefix = `Container restart count before PR ${prNumber}: `;
  const line = content.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    return undefined;
  }

  const restartCount = Number.parseInt(line.slice(prefix.length), 10);
  if (Number.isNaN(restartCount)) {
    return undefined;
  }

  return restartCount;
}

function readCommunityBotProcessExitCode(content) {
  return readIntegerLine(content, "Community bot process exit code: ");
}

function readLatestHealthStatus(content) {
  return readIntegerLine(content, "Latest GET /health response status: ");
}

function readIntegerLine(content, prefix) {
  const lines = content.split(/\r?\n/u);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith(prefix)) {
      const value = Number.parseInt(line.slice(prefix.length), 10);
      return Number.isNaN(value) ? undefined : value;
    }
  }

  return undefined;
}

function rejectedNoCrash(reason, message = reason) {
  return { message, outcome: "rejected", reason };
}

function readOption(name) {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || value === undefined || value.startsWith("--")) {
    fail(`${name} is required`);
  }
  return value;
}

function readOptions(name) {
  const values = args.flatMap((arg, index) => (arg === name ? [args[index + 1]] : []));
  if (values.length === 0) {
    fail(`${name} is required`);
  }
  for (const value of values) {
    if (value === undefined || value.startsWith("--")) {
      fail(`${name} is malformed`);
    }
  }
  return values;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function failNoCrash(result) {
  process.stderr.write("no-crash outcome: rejected\n");
  process.stderr.write(`reason: ${result.reason}\n`);
  if (result.message !== result.reason) {
    process.stderr.write(`${result.message}\n`);
  }
  process.exit(1);
}
