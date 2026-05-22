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

  if (hasMissingAnthropicKeyFailure(soakLog, prNumber)) {
    fail("Anthropic key wiring assertion failed: ANTHROPIC_API_KEY is missing");
  }
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
} else if (command === "smoke-pr-count") {
  const targetBranch = readOption("--target-branch");
  const minimumCount = readIntegerOption("--minimum-count");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const result = evaluateSmokePrCount(soakLog, { targetBranch });

  if (result.qualifyingCount < minimumCount) {
    process.stderr.write(`qualifying PR count: ${result.qualifyingCount}\n`);
    for (const exclusion of result.exclusions) {
      process.stderr.write(`PR ${exclusion.pr} is excluded because ${exclusion.reason}\n`);
    }
    fail(`smoke PR count assertion failed: at least ${minimumCount} qualifying PRs`);
  }
} else if (command === "soak-log-content") {
  const repoFullName = readOption("--repo");
  const qualifyingPrs = readOptions("--qualifying-pr");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const duplicatePr = findDuplicateSoakEvidencePr(soakLog, {
    qualifyingPrs,
    repoFullName,
  });

  if (duplicatePr !== undefined) {
    fail(`duplicate evidence row for PR ${duplicatePr}`);
  }
} else {
  fail(
    "usage: validate-v0-1-soak.mjs <image-provenance|anthropic-key|provider-logs|log-secrets|no-crash|github-app-installation|smoke-pr-count|soak-log-content> [options]",
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

function hasMissingAnthropicKeyFailure(content, prNumber) {
  const evidence = readAnthropicReviewEvidence(content, prNumber);

  return (
    evidence?.apiKeyEvidence !== undefined &&
    evidence.apiKeyEvidence.trim().length === 0 &&
    evidence.successfulReviewCommentPosted === "false"
  );
}

function readAnthropicReviewEvidence(content, prNumber) {
  const apiKeyPrefix = "ANTHROPIC_API_KEY value: ";
  const reviewCommentPrefix = "Successful review comment posted: ";
  let pendingEvidence = {};
  let currentEvidence;
  let matchedEvidence;

  for (const line of content.split(/\r?\n/u)) {
    if (line.startsWith(apiKeyPrefix)) {
      if (currentEvidence?.prNumber === prNumber) {
        matchedEvidence = { ...currentEvidence };
      }

      const apiKeyEvidence = line.slice(apiKeyPrefix.length);
      if (currentEvidence?.prNumber !== undefined && currentEvidence.apiKeyEvidence === undefined) {
        Object.assign(currentEvidence, { apiKeyEvidence });
      } else {
        currentEvidence = undefined;
        Object.assign(pendingEvidence, { apiKeyEvidence });
      }
    }

    if (line.startsWith("PR: ")) {
      if (currentEvidence?.prNumber === prNumber) {
        matchedEvidence = { ...currentEvidence };
      }
      currentEvidence = Object.assign({}, pendingEvidence, {
        prNumber: line.slice("PR: ".length),
      });
      pendingEvidence = {};
    }

    if (line.startsWith(reviewCommentPrefix)) {
      const successfulReviewCommentPosted = line.slice(reviewCommentPrefix.length);
      if (currentEvidence?.prNumber !== undefined) {
        Object.assign(currentEvidence, { successfulReviewCommentPosted });
      } else {
        Object.assign(pendingEvidence, { successfulReviewCommentPosted });
      }
    }

    if (currentEvidence?.prNumber === prNumber) {
      matchedEvidence = { ...currentEvidence };
    }
  }

  return matchedEvidence;
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

function evaluateSmokePrCount(content, expected) {
  const prs = readSmokePrRows(content);
  const exclusions = [];
  let qualifyingCount = 0;

  for (const pr of prs) {
    const exclusionReason = smokePrExclusionReason(pr, expected);
    if (exclusionReason === undefined) {
      qualifyingCount += 1;
    } else {
      exclusions.push({ pr: pr.pr, reason: exclusionReason });
    }
  }

  return { exclusions, qualifyingCount };
}

function readSmokePrRows(content) {
  const rowPattern =
    /^Smoke PR: (?<pr>\d+) target_branch=(?<targetBranch>\S+) draft=(?<draft>true|false) changed_lines=(?<changedLines>\d+)$/u;

  return content.split(/\r?\n/u).flatMap((line) => {
    const match = rowPattern.exec(line);
    if (match?.groups === undefined) {
      return [];
    }

    return [
      {
        changedLines: Number.parseInt(match.groups.changedLines, 10),
        draft: match.groups.draft === "true",
        pr: match.groups.pr,
        targetBranch: match.groups.targetBranch,
      },
    ];
  });
}

function smokePrExclusionReason(pr, expected) {
  if (pr.targetBranch !== expected.targetBranch) {
    return `it does not target "${expected.targetBranch}"`;
  }

  if (pr.draft) {
    return "it is a draft";
  }

  if (pr.changedLines >= 500) {
    return "changed lines are not < 500";
  }

  return undefined;
}

function findDuplicateSoakEvidencePr(content, expected) {
  const evidenceCounts = new Map();

  for (const prNumber of readSoakEvidencePrNumbers(content, expected.repoFullName)) {
    if (!expected.qualifyingPrs.includes(prNumber)) {
      continue;
    }

    const count = (evidenceCounts.get(prNumber) ?? 0) + 1;
    if (count > 1) {
      return prNumber;
    }
    evidenceCounts.set(prNumber, count);
  }

  return undefined;
}

function readSoakEvidencePrNumbers(content, repoFullName) {
  const prUrlPrefix = `https://github.com/${repoFullName}/pull/`;

  return content.split(/\r?\n/u).flatMap((line) => {
    const prUrlStart = line.indexOf(prUrlPrefix);
    if (prUrlStart < 0) {
      return [];
    }

    const prNumber = readLeadingDigits(line.slice(prUrlStart + prUrlPrefix.length));
    return prNumber === undefined ? [] : [prNumber];
  });
}

function readLeadingDigits(value) {
  let endIndex = 0;
  while (endIndex < value.length && value[endIndex] >= "0" && value[endIndex] <= "9") {
    endIndex += 1;
  }

  return endIndex === 0 ? undefined : value.slice(0, endIndex);
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

function readIntegerOption(name) {
  const rawValue = readOption(name);
  if (!/^\d+$/u.test(rawValue)) {
    fail(`${name} is invalid`);
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value)) {
    fail(`${name} is invalid`);
  }
  return value;
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
