#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

const GHCR_IMAGE = "ghcr.io/mpiton/sovri/community-bot:v0.1.0";
const COMMUNITY_BOT_PROCESS_EXIT_AFTER_PR_PATTERN =
  /^Community bot process exit code after PR (?<prNumber>\d+): (?<exitCode>\d+)$/u;
const LATENCY_P95_THRESHOLD_SECONDS = 90;
const LATENCY_SAMPLE_PERCENTILE = 0.95;
const LATENCY_LINE_PATTERN =
  /^Latency PR: \d+ delivery_id=\S+ changed_lines=(?<changedLines>\d+) latency_seconds=(?<latencySeconds>\d+(?:\.\d{1,3})?)$/u;
const LATENCY_METADATA_PATTERN =
  /^Latency PR metadata: pr=(?<prNumber>\d+) delivery_id=(?<deliveryId>\S+) changed_lines=(?<changedLines>\d+)$/u;
const SOVRI_PR_COMMENT_PATTERN =
  /^Sovri PR comment: pr=(?<prNumber>\d+) created_at=(?<createdAt>\S+)$/u;
const SMOKE_PR_ROW_PATTERN =
  /^Smoke PR: (?<pr>\d+)(?: event=\S+)? target_branch=(?<targetBranch>\S+) draft=(?<draft>true|false) changed_lines=(?<changedLines>\d+)$/u;
const WEBHOOK_RECEIPT_PATTERN =
  /^Webhook received: delivery_id=(?<deliveryId>\S+) at=(?<receivedAt>\S+)$/u;
const COMMUNITY_BOT_CONTAINER_NAME = "sovri-community-bot-v0-1-soak";
const REQUIRED_GITHUB_APP_PERMISSIONS = [
  { access: "write", permission: "pull_requests" },
  { access: "read", permission: "contents" },
  { access: "write", permission: "issues" },
  { access: "read", permission: "metadata" },
];
const REQUIRED_GITHUB_APP_EVENTS = ["pull_request", "issue_comment"];
const REQUIRED_RUNTIME_CREDENTIALS = new Set(["APP_ID", "WEBHOOK_SECRET", "PRIVATE_KEY"]);
const REQUIRED_SOAK_LOG_FIELDS = ["PR URL", "latency", "finding count", "manual quality rating"];
const LOCAL_BUILD_EVIDENCE =
  /built sovri\/community-bot:smoke from Dockerfile at commit [0-9a-f]{40}/u;
const LOCAL_BUILD_EVIDENCE_PREFIX = "built sovri/community-bot:smoke from Dockerfile";
const SOAK_LOG_LATENCY_DURATION_PATTERN = /^\d+(?:\.\d{1,3})?s$/u;

const args = process.argv.slice(2);
const command = args[0];

if (command === "image-provenance") {
  const provenanceMode = readOption("--provenance-mode");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasAcceptedImageProvenance(soakLog, provenanceMode)) {
    if (provenanceMode === "local build" && hasLocalBuildEvidenceWithoutSourceCommit(soakLog)) {
      fail("local build must record the source commit");
    }
    if (provenanceMode === "GHCR pull" && hasGhcrPullEvidence(soakLog)) {
      fail(`image provenance assertion failed: expected ${GHCR_IMAGE}`);
    }
    fail("image provenance must be recorded");
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
    fail("missing docker logs evidence");
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
  const result = evaluateGitHubAppInstallation(soakLog, { expectedApp, repoFullName });

  if (result.outcome === "rejected") {
    fail(`GitHub App installation assertion failed: ${result.reason}`);
  }
  process.stdout.write("GitHub App installation assertion passed\n");
  process.stdout.write("webhook signature: accepted\n");
  process.stdout.write(`installation token: available repo=${repoFullName}\n`);
  process.stdout.write("GitHub credential wiring assertion passed\n");
} else if (command === "webhook-secret") {
  const prNumber = readOption("--pr");
  const repoFullName = readOption("--repo");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasWrongWebhookSecretRejectionEvidence(soakLog, { prNumber, repoFullName })) {
    fail("GitHub credential wiring assertion failed: webhook rejection evidence is incomplete");
  }
  process.stdout.write("webhook secret rejection assertion passed\n");
} else if (command === "private-key-newlines") {
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasEscapedPrivateKeyNewlineStartupEvidence(soakLog)) {
    fail("private key newline assertion failed");
  }
  process.stdout.write("private key newline assertion passed\n");
} else if (command === "private-key-startup-failure") {
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasInvalidPrivateKeyStartupFailureEvidence(soakLog)) {
    fail("private key startup failure assertion failed");
  }
  process.stdout.write("private key startup failure assertion passed\n");
} else if (command === "app-id-startup-failure") {
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasMalformedAppIdStartupFailureEvidence(soakLog)) {
    fail("APP_ID startup failure assertion failed");
  }
  process.stdout.write("APP_ID startup failure assertion passed\n");
} else if (command === "runtime-startup-failure") {
  const variable = readOption("--variable");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (!hasMissingRuntimeCredentialStartupFailureEvidence(soakLog, variable)) {
    fail("runtime startup failure assertion failed");
  }
  process.stdout.write("runtime startup failure assertion passed\n");
} else if (command === "latency-pr-filter") {
  const prNumber = readOption("--pr");
  const additions = readIntegerOption("--additions");
  const deletions = readIntegerOption("--deletions");
  const changedLines = additions + deletions;

  if (!Number.isSafeInteger(changedLines)) {
    fail("changed line count is invalid");
  }

  process.stdout.write(`PR: ${prNumber}\n`);
  process.stdout.write(`changed line count: ${changedLines}\n`);
  process.stdout.write(`latency sample classification: ${classifyLatencySample(changedLines)}\n`);
} else if (command === "latency-p95") {
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const p95Latency = calculateLatencyP95(soakLog);

  if (p95Latency === undefined) {
    fail("latency evidence is missing");
  }
  if (p95Latency >= LATENCY_P95_THRESHOLD_SECONDS) {
    process.stderr.write(`p95 latency: ${formatSeconds(p95Latency)} seconds\n`);
    fail("p95 latency must be < 90 s");
  }
  process.stdout.write(`p95 latency: ${formatSeconds(p95Latency)} seconds\n`);
  process.stdout.write("latency assertion passed\n");
} else if (command === "latency-pr") {
  const prNumber = readOption("--pr");
  const deliveryId = readOption("--delivery-id");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const result = evaluatePrLatency(soakLog, { deliveryId, prNumber });

  if (result.outcome === "rejected") {
    fail(result.reason);
  }
  if (result.latencySeconds < 0) {
    process.stderr.write(`measured latency: ${formatSeconds(result.latencySeconds)} seconds\n`);
    fail("latency must be >= 0 s");
  }
  if (result.latencySeconds >= LATENCY_P95_THRESHOLD_SECONDS) {
    process.stderr.write(`measured latency: ${formatSeconds(result.latencySeconds)} seconds\n`);
    fail("latency must be < 90 s");
  }
  process.stdout.write(`measured latency: ${formatSeconds(result.latencySeconds)} seconds\n`);
  process.stdout.write(`later PR comments ignored: ${result.laterCommentsIgnored}\n`);
  process.stdout.write("latency assertion passed\n");
} else if (command === "smoke-pr-count") {
  const targetBranch = readOption("--target-branch");
  const minimumCount = readIntegerOption("--minimum-count");
  const targetCount = readOptionalIntegerOption("--target-count");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const result = evaluateSmokePrCount(soakLog, { targetBranch });
  const classification = classifySmokeRun(result.qualifyingCount, {
    minimumCount,
    targetCount,
  });

  if (result.qualifyingCount < minimumCount) {
    process.stderr.write(`qualifying PR count: ${result.qualifyingCount}\n`);
    process.stderr.write(`smoke run classification: ${classification}\n`);
    writeSmokePrQualifications(process.stderr, result.qualifications);
    for (const exclusion of result.exclusions) {
      process.stderr.write(`PR ${exclusion.pr} is excluded because ${exclusion.reason}\n`);
    }
    fail(`smoke PR count assertion failed: at least ${minimumCount} qualifying PRs`);
  }
  process.stdout.write(`qualifying PR count: ${result.qualifyingCount}\n`);
  process.stdout.write(`smoke run classification: ${classification}\n`);
  writeSmokePrQualifications(process.stdout, result.qualifications);
  process.stdout.write("smoke PR count assertion passed\n");
} else if (command === "soak-log-content") {
  const repoFullName = readOption("--repo");
  const qualifyingPrs = readOptions("--qualifying-pr");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");
  const missingRequiredField = findMissingRequiredSoakLogField(soakLog, {
    qualifyingPrs,
    repoFullName,
  });
  const duplicatePr = findDuplicateSoakEvidencePr(soakLog, {
    qualifyingPrs,
    repoFullName,
  });
  const invalidFindingCountPr = findInvalidFindingCountPr(soakLog, {
    qualifyingPrs,
    repoFullName,
  });
  const missingPr = findMissingSoakEvidencePr(soakLog, {
    qualifyingPrs,
    repoFullName,
  });
  const invalidLatencyPr = findInvalidLatencyPr(soakLog, {
    qualifyingPrs,
    repoFullName,
  });
  const qualityRatingResults = evaluateSoakLogQualityRatings(soakLog, {
    qualifyingPrs,
    repoFullName,
  });
  const rejectedQualityRating = qualityRatingResults.find(
    (result) => result.outcome === "rejected",
  );

  if (missingRequiredField !== undefined) {
    failMissingRequiredSoakLogField(missingRequiredField);
  }
  if (duplicatePr !== undefined) {
    fail(`duplicate evidence row for PR ${duplicatePr}`);
  }
  if (missingPr !== undefined) {
    fail(`missing evidence row for PR ${missingPr}`);
  }
  if (invalidLatencyPr !== undefined) {
    fail("latency must be a duration in seconds");
  }
  if (invalidFindingCountPr !== undefined) {
    fail("finding count must be a non-negative integer");
  }
  if (rejectedQualityRating !== undefined) {
    writeQualityRatingResult(process.stderr, rejectedQualityRating);
    fail("manual quality rating assertion failed");
  }
  for (const qualityRatingResult of qualityRatingResults) {
    writeQualityRatingResult(process.stdout, qualityRatingResult);
  }
  process.stdout.write("soak log content assertion passed\n");
} else if (command === "soak-log-commit") {
  const repoFullName = readOption("--repo");
  const relativePath = readOption("--path");
  const soakLogPath = readOption("--soak-log");
  const soakLog = readFileSync(soakLogPath, "utf8");

  if (hasUncommittedSoakLogStatus(soakLog, relativePath)) {
    fail("soak log must be committed");
  }
  if (!hasCommittedSoakLogMetadata(soakLog, { relativePath, repoFullName })) {
    fail(`soak log must be committed to ${repoFullName}`);
  }
  if (countSoakLogPrEvidenceRows(soakLog, repoFullName) === 0) {
    fail("soak log has no PR evidence rows");
  }
  process.stdout.write("soak log commit assertion passed\n");
} else {
  fail(
    "usage: validate-v0-1-soak.mjs <image-provenance|anthropic-key|provider-logs|log-secrets|no-crash|github-app-installation|webhook-secret|private-key-newlines|private-key-startup-failure|app-id-startup-failure|runtime-startup-failure|latency-pr-filter|latency-p95|latency-pr|smoke-pr-count|soak-log-content|soak-log-commit> [options]",
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

function hasLocalBuildEvidenceWithoutSourceCommit(content) {
  return content.includes(LOCAL_BUILD_EVIDENCE_PREFIX) && !LOCAL_BUILD_EVIDENCE.test(content);
}

function hasGhcrPullEvidence(content) {
  return /pulled ghcr\.io\/\S+/u.test(content);
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
    evidence !== undefined &&
    (evidence.apiKeyEvidence === undefined || evidence.apiKeyEvidence.trim().length === 0) &&
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

function evaluateGitHubAppInstallation(content, expected) {
  if (!hasExpectedGitHubAppInstallation(content, expected)) {
    return {
      outcome: "rejected",
      reason: `app not installed on ${expected.repoFullName}: ${expected.expectedApp}`,
    };
  }

  for (const permission of REQUIRED_GITHUB_APP_PERMISSIONS) {
    if (!hasGitHubAppPermission(content, expected.expectedApp, permission)) {
      return {
        outcome: "rejected",
        reason: `${permission.permission}: ${permission.access}`,
      };
    }
  }

  for (const event of REQUIRED_GITHUB_APP_EVENTS) {
    if (!hasGitHubAppWebhookEvent(content, expected.expectedApp, event)) {
      return { outcome: "rejected", reason: `${event} event` };
    }
  }

  if (!hasSignedPullRequestWebhook(content, expected.repoFullName)) {
    return { outcome: "rejected", reason: "signed pull_request.opened webhook" };
  }

  if (!hasAvailableInstallationToken(content, expected.repoFullName)) {
    return { outcome: "rejected", reason: `installation token for ${expected.repoFullName}` };
  }

  if (!hasRequiredPullRequestApiAccess(content, expected.repoFullName)) {
    return { outcome: "rejected", reason: "pull request files/reviews API access" };
  }

  return { outcome: "accepted" };
}

function hasGitHubAppPermission(content, expectedApp, expected) {
  return content
    .split(/\r?\n/u)
    .includes(`${expectedApp} permission: ${expected.permission}=${expected.access}`);
}

function hasGitHubAppWebhookEvent(content, expectedApp, event) {
  return content.split(/\r?\n/u).includes(`${expectedApp} webhook event: ${event}`);
}

function hasSignedPullRequestWebhook(content, repoFullName) {
  return content
    .split(/\r?\n/u)
    .includes(`GitHub webhook delivered: pull_request.opened repo=${repoFullName} signed=true`);
}

function hasAvailableInstallationToken(content, repoFullName) {
  return content
    .split(/\r?\n/u)
    .includes(`GitHub installation token: available repo=${repoFullName}`);
}

function hasRequiredPullRequestApiAccess(content, repoFullName) {
  const fileAccessPrs = readGitHubApiAccessPrs(content, {
    method: "GET",
    repoFullName,
    suffix: "files",
  });
  const reviewAccessPrs = readGitHubApiAccessPrs(content, {
    method: "POST",
    repoFullName,
    suffix: "reviews",
  });

  return [...fileAccessPrs].some((prNumber) => reviewAccessPrs.has(prNumber));
}

function hasWrongWebhookSecretRejectionEvidence(content, expected) {
  const lines = content.split(/\r?\n/u);
  return [
    "WEBHOOK_SECRET configured: true",
    `Repository: ${expected.repoFullName}`,
    `PR: ${expected.prNumber}`,
    `GitHub webhook delivered: pull_request.opened repo=${expected.repoFullName} signed=false`,
    "Webhook signature verification: rejected",
    "Review work started: false",
    "First PR comment posted: false",
    "GitHub credential wiring assertion: failed",
  ].every((expectedLine) => lines.includes(expectedLine));
}

function readGitHubApiAccessPrs(content, expected) {
  const prefix = `GitHub API call: ${expected.method} /repos/${expected.repoFullName}/pulls/`;
  const prNumbers = new Set();

  for (const line of content.split(/\r?\n/u)) {
    if (!line.startsWith(prefix)) {
      continue;
    }

    const suffix = line.slice(prefix.length);
    const prNumber = readLeadingDigits(suffix);
    if (prNumber !== undefined && suffix.startsWith(`${prNumber}/${expected.suffix} status=2`)) {
      prNumbers.add(prNumber);
    }
  }

  return prNumbers;
}

function hasEscapedPrivateKeyNewlineStartupEvidence(content) {
  const lines = content.split(/\r?\n/u);
  return [
    "PRIVATE_KEY storage: escaped-newlines",
    "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
    "Private key line break normalization: true",
    "Community bot startup: success",
  ].every((expectedLine) => lines.includes(expectedLine));
}

function hasInvalidPrivateKeyStartupFailureEvidence(content) {
  const lines = content.split(/\r?\n/u);
  const appId = readLineValue(lines, "APP_ID value: ");
  const privateKey = readLineValue(lines, "PRIVATE_KEY value: ");
  return (
    appId !== undefined &&
    appId.trim().length > 0 &&
    privateKey !== undefined &&
    privateKey.trim().length > 0 &&
    [
      "WEBHOOK_SECRET configured: true",
      "Community bot startup: failed before webhook processing",
      "Webhook processing: not started",
    ].every((expectedLine) => lines.includes(expectedLine)) &&
    lines.some(
      (line) => line.startsWith("Startup failure reason: ") && line.includes("PRIVATE_KEY"),
    )
  );
}

function hasMalformedAppIdStartupFailureEvidence(content) {
  const lines = content.split(/\r?\n/u);
  const appId = readLineValue(lines, "APP_ID value: ");
  const failureReason = readLineValue(lines, "Startup failure reason: ");
  const normalizedAppId = appId?.trim();
  return (
    normalizedAppId !== undefined &&
    normalizedAppId.length > 0 &&
    !isPositiveInteger(normalizedAppId) &&
    [
      "WEBHOOK_SECRET configured: true",
      "PRIVATE_KEY decoded PEM key: valid 2048-bit RSA",
      "Community bot startup: failed before webhook processing",
      "Webhook processing: not started",
    ].every((expectedLine) => lines.includes(expectedLine)) &&
    failureReason !== undefined &&
    failureReason.includes("APP_ID") &&
    failureReason.includes("positive integer")
  );
}

function hasMissingRuntimeCredentialStartupFailureEvidence(content, variable) {
  const lines = content.split(/\r?\n/u);
  return (
    REQUIRED_RUNTIME_CREDENTIALS.has(variable) &&
    [
      `Runtime environment omitted: ${variable}`,
      "Community bot startup: failed before webhook processing",
      "Webhook processing: not started",
    ].every((expectedLine) => lines.includes(expectedLine)) &&
    lines.some((line) => line.startsWith("Startup failure reason: ") && line.includes(variable))
  );
}

function readLineValue(lines, prefix) {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length);
}

function isPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return isDecimalInteger(value) && Number.isSafeInteger(parsed) && parsed > 0;
}

function calculateLatencyP95(content) {
  const latencies = readLatencyMeasurements(content)
    .filter((measurement) => classifyLatencySample(measurement.changedLines) === "included")
    .map((measurement) => measurement.latencySeconds)
    .toSorted((left, right) => left - right);

  if (latencies.length === 0) {
    return undefined;
  }

  return latencies[Math.ceil(LATENCY_SAMPLE_PERCENTILE * latencies.length) - 1];
}

function readLatencyMeasurements(content) {
  return content.split(/\r?\n/u).flatMap((line) => {
    const match = LATENCY_LINE_PATTERN.exec(line);
    if (match?.groups === undefined) {
      return [];
    }

    return [
      {
        changedLines: Number.parseInt(match.groups.changedLines, 10),
        latencySeconds: Number.parseFloat(match.groups.latencySeconds),
      },
    ];
  });
}

function formatSeconds(seconds) {
  return seconds.toFixed(3);
}

function evaluatePrLatency(content, expected) {
  const metadata = readLatencyMetadata(content, expected);
  if (metadata === undefined || classifyLatencySample(metadata.changedLines) === "excluded") {
    return rejectedLatency("latency evidence is missing");
  }

  const webhookReceivedAt = readWebhookReceivedAt(content, expected.deliveryId);
  if (webhookReceivedAt === undefined) {
    return rejectedLatency("missing webhook receipt timestamp");
  }

  const commentTimes = readSovriPrCommentTimes(content, expected.prNumber);
  if (commentTimes.length === 0) {
    return rejectedLatency("missing first Sovri PR comment timestamp");
  }

  const sortedCommentTimes = commentTimes.toSorted((left, right) => left - right);
  const firstCommentAt = sortedCommentTimes.find((timestamp) => timestamp >= webhookReceivedAt);
  if (firstCommentAt === undefined) {
    return rejectedLatency("missing first Sovri PR comment timestamp after webhook receipt");
  }

  return {
    laterCommentsIgnored: sortedCommentTimes.some((timestamp) => timestamp > firstCommentAt),
    latencySeconds: (firstCommentAt - webhookReceivedAt) / 1000,
    outcome: "accepted",
  };
}

function rejectedLatency(reason) {
  return { outcome: "rejected", reason };
}

function classifyLatencySample(changedLines) {
  return changedLines >= 1 && changedLines < 500 ? "included" : "excluded";
}

function readLatencyMetadata(content, expected) {
  for (const line of content.split(/\r?\n/u)) {
    const match = LATENCY_METADATA_PATTERN.exec(line);
    if (
      match?.groups === undefined ||
      match.groups.prNumber !== expected.prNumber ||
      match.groups.deliveryId !== expected.deliveryId
    ) {
      continue;
    }

    return {
      changedLines: Number.parseInt(match.groups.changedLines, 10),
    };
  }

  return undefined;
}

function readWebhookReceivedAt(content, deliveryId) {
  for (const line of content.split(/\r?\n/u)) {
    const match = WEBHOOK_RECEIPT_PATTERN.exec(line);
    if (match?.groups === undefined || match.groups.deliveryId !== deliveryId) {
      continue;
    }

    return parseTimestamp(match.groups.receivedAt);
  }

  return undefined;
}

function readSovriPrCommentTimes(content, prNumber) {
  return content.split(/\r?\n/u).flatMap((line) => {
    const match = SOVRI_PR_COMMENT_PATTERN.exec(line);
    if (match?.groups === undefined || match.groups.prNumber !== prNumber) {
      return [];
    }

    const timestamp = parseTimestamp(match.groups.createdAt);
    return timestamp === undefined ? [] : [timestamp];
  });
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function evaluateSmokePrCount(content, expected) {
  const prs = readSmokePrRows(content);
  const exclusions = [];
  const qualifications = [];
  let qualifyingCount = 0;

  for (const pr of prs) {
    const qualification = qualifySmokePr(pr, expected);
    qualifications.push({
      classification: qualification.classification,
      pr: pr.pr,
      reason: qualification.reason,
    });

    if (qualification.classification === "included") {
      qualifyingCount += 1;
    } else {
      exclusions.push({ pr: pr.pr, reason: qualification.exclusionReason });
    }
  }

  return { exclusions, qualifications, qualifyingCount };
}

function classifySmokeRun(qualifyingCount, expected) {
  if (expected.targetCount !== undefined && qualifyingCount >= expected.targetCount) {
    return "target count reached";
  }
  if (qualifyingCount >= expected.minimumCount) {
    return "minimum count reached";
  }

  return "below minimum count";
}

function readSmokePrRows(content) {
  const rowsByPr = new Map();

  for (const line of content.split(/\r?\n/u)) {
    const match = SMOKE_PR_ROW_PATTERN.exec(line);
    if (match?.groups === undefined) {
      continue;
    }

    rowsByPr.set(match.groups.pr, {
      changedLines: Number.parseInt(match.groups.changedLines, 10),
      draft: match.groups.draft === "true",
      pr: match.groups.pr,
      targetBranch: match.groups.targetBranch,
    });
  }

  return [...rowsByPr.values()];
}

function qualifySmokePr(pr, expected) {
  const exclusion = smokePrExclusion(pr, expected);
  if (exclusion !== undefined) {
    return {
      classification: "excluded",
      exclusionReason: exclusion.exclusionReason,
      reason: exclusion.qualificationReason,
    };
  }

  return {
    classification: "included",
    reason: pr.changedLines === 1 ? "at least one changed line" : "below 500 changed lines",
  };
}

function smokePrExclusion(pr, expected) {
  if (pr.targetBranch !== expected.targetBranch) {
    return {
      exclusionReason: `it does not target "${expected.targetBranch}"`,
      qualificationReason: "wrong target branch",
    };
  }

  if (pr.draft) {
    return {
      exclusionReason: "it is a draft",
      qualificationReason: "draft PR",
    };
  }

  if (pr.changedLines < 1) {
    return {
      exclusionReason: "no changed lines",
      qualificationReason: "no changed lines",
    };
  }

  if (pr.changedLines >= 500) {
    return {
      exclusionReason: "changed lines are not < 500",
      qualificationReason: "changed lines are not < 500",
    };
  }

  return undefined;
}

function writeSmokePrQualifications(stream, qualifications) {
  for (const qualification of qualifications) {
    stream.write(
      `PR ${qualification.pr} qualification: ${qualification.classification} reason=${qualification.reason}\n`,
    );
  }
}

function findMissingRequiredSoakLogField(content, expected) {
  const table = readSoakLogEvidenceTable(content, expected.repoFullName);
  if (table === undefined) {
    return "PR URL";
  }

  const missingHeaderField = REQUIRED_SOAK_LOG_FIELDS.find(
    (field) => !table.header.includes(field),
  );
  if (missingHeaderField !== undefined) {
    return missingHeaderField;
  }

  const fieldIndexes = readSoakLogFieldIndexes(table.header);
  for (const row of table.rows) {
    const prUrlCell = readRequiredSoakLogCell(row, fieldIndexes, "PR URL");
    if (prUrlCell === undefined || prUrlCell.length === 0) {
      return "PR URL";
    }

    const prNumber = readGitHubPullUrlPrNumber(prUrlCell, expected.repoFullName);
    if (prNumber === undefined || !expected.qualifyingPrs.includes(prNumber)) {
      continue;
    }

    const missingCellField = REQUIRED_SOAK_LOG_FIELDS.find((field) => {
      const cell = readRequiredSoakLogCell(row, fieldIndexes, field);
      return cell === undefined || cell.length === 0;
    });
    if (missingCellField !== undefined) {
      return missingCellField;
    }
  }

  return undefined;
}

function readSoakLogEvidenceTable(content, repoFullName) {
  const tables = readMarkdownTables(content);
  const completeTables = tables.filter((table) =>
    REQUIRED_SOAK_LOG_FIELDS.every((field) => table.header.includes(field)),
  );
  const targetRepoRows = completeTables.flatMap((table) =>
    readTargetRepoEvidenceRows(table, repoFullName),
  );
  if (targetRepoRows.length > 0) {
    return { header: REQUIRED_SOAK_LOG_FIELDS, rows: targetRepoRows };
  }
  if (completeTables[0] !== undefined) {
    return completeTables[0];
  }

  return tables.find((table) =>
    table.header.some((cell) => REQUIRED_SOAK_LOG_FIELDS.includes(cell)),
  );
}

function readTargetRepoEvidenceRows(table, repoFullName) {
  const fieldIndexes = readSoakLogFieldIndexes(table.header);
  return table.rows.flatMap((row) => {
    const prUrlCell = readRequiredSoakLogCell(row, fieldIndexes, "PR URL");
    if (
      prUrlCell === undefined ||
      readGitHubPullUrlPrNumber(prUrlCell, repoFullName) === undefined
    ) {
      return [];
    }

    return [
      REQUIRED_SOAK_LOG_FIELDS.map(
        (field) => readRequiredSoakLogCell(row, fieldIndexes, field) ?? "",
      ),
    ];
  });
}

function readMarkdownTables(content) {
  const tables = [];
  let currentTable;

  for (const line of content.split(/\r?\n/u)) {
    const cells = readMarkdownTableCells(line);
    if (cells.length === 0) {
      if (currentTable !== undefined) {
        tables.push(currentTable);
        currentTable = undefined;
      }
      continue;
    }

    if (isMarkdownSeparatorRow(cells)) {
      continue;
    }

    if (currentTable === undefined) {
      currentTable = { header: cells, rows: [] };
      continue;
    }

    currentTable.rows.push(cells);
  }

  if (currentTable !== undefined) {
    tables.push(currentTable);
  }

  return tables;
}

function failMissingRequiredSoakLogField(field) {
  if (field === "latency") {
    fail("latency is required; latency must be a duration in seconds");
  }
  if (field === "finding count") {
    fail("finding count is required; finding count must be a non-negative integer");
  }
  fail(`${field} is required`);
}

function readSoakLogFieldIndexes(header) {
  return new Map(header.map((field, index) => [field, index]));
}

function readRequiredSoakLogCell(row, fieldIndexes, field) {
  const index = fieldIndexes.get(field);
  return index === undefined ? undefined : row[index];
}

function isMarkdownSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function findDuplicateSoakEvidencePr(content, expected) {
  const evidenceCounts = new Map();

  for (const prNumber of readSoakEvidenceRowPrNumbers(content, expected.repoFullName)) {
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

function findMissingSoakEvidencePr(content, expected) {
  const evidencePrs = new Set(readSoakEvidenceRowPrNumbers(content, expected.repoFullName));
  return expected.qualifyingPrs.find((prNumber) => !evidencePrs.has(prNumber));
}

function* iterateQualifyingSoakLogRows(content, expected) {
  const table = readSoakLogEvidenceTable(content, expected.repoFullName);
  if (table === undefined) {
    return;
  }

  const fieldIndexes = readSoakLogFieldIndexes(table.header);
  for (const row of table.rows) {
    const prUrlCell = readRequiredSoakLogCell(row, fieldIndexes, "PR URL");
    const prNumber = readGitHubPullUrlPrNumber(prUrlCell, expected.repoFullName);
    if (prNumber === undefined || !expected.qualifyingPrs.includes(prNumber)) {
      continue;
    }

    yield { fieldIndexes, prNumber, row };
  }
}

function findInvalidFindingCountPr(content, expected) {
  for (const { fieldIndexes, prNumber, row } of iterateQualifyingSoakLogRows(content, expected)) {
    const findingCountCell = readRequiredSoakLogCell(row, fieldIndexes, "finding count");
    if (findingCountCell === undefined || !isDecimalInteger(findingCountCell)) {
      return prNumber;
    }
  }

  return undefined;
}

function findInvalidLatencyPr(content, expected) {
  for (const { fieldIndexes, prNumber, row } of iterateQualifyingSoakLogRows(content, expected)) {
    const latencyCell = readRequiredSoakLogCell(row, fieldIndexes, "latency");
    if (latencyCell === undefined || !SOAK_LOG_LATENCY_DURATION_PATTERN.test(latencyCell)) {
      return prNumber;
    }
  }

  return undefined;
}

function evaluateSoakLogQualityRatings(content, expected) {
  const ratings = [];
  for (const { fieldIndexes, row } of iterateQualifyingSoakLogRows(content, expected)) {
    const ratingCell = readRequiredSoakLogCell(row, fieldIndexes, "manual quality rating");
    ratings.push(classifyQualityRating(ratingCell ?? ""));
  }

  return ratings;
}

function classifyQualityRating(value) {
  if (!isDecimalInteger(value)) {
    return { outcome: "rejected", reason: "rating must be an integer" };
  }

  const rating = Number.parseInt(value, 10);
  if (rating < 1) {
    return { outcome: "rejected", reason: "rating is below the 1-5 scale" };
  }
  if (rating > 5) {
    return { outcome: "rejected", reason: "rating is above the 1-5 scale" };
  }
  if (rating < 3) {
    return { outcome: "rejected", reason: "review is not coherent enough" };
  }
  if (rating === 3) {
    return { outcome: "accepted", reason: "coherent but noisy" };
  }

  return { outcome: "accepted", reason: "merge-review quality" };
}

function writeQualityRatingResult(stream, result) {
  stream.write(`quality rating outcome: ${result.outcome}\n`);
  stream.write(`reason: ${result.reason}\n`);
}

function countSoakLogPrEvidenceRows(content, repoFullName) {
  return readSoakEvidenceRowPrNumbers(content, repoFullName).length;
}

function hasCommittedSoakLogMetadata(content, expected) {
  return (
    readMetadataValue(content, "Evidence repository") === expected.repoFullName &&
    readMetadataValue(content, "Committed soak log path") === expected.relativePath
  );
}

function hasUncommittedSoakLogStatus(content, relativePath) {
  const prefix = `git status --short ${relativePath}:`;
  return content.split(/\r?\n/u).some((line) => {
    if (!line.startsWith(prefix)) {
      return false;
    }
    const remainder = line.slice(prefix.length);
    if (!remainder.endsWith(relativePath)) {
      return false;
    }
    const statusToken = remainder.slice(0, -relativePath.length).trim();
    return statusToken.length > 0;
  });
}

function readMetadataValue(content, label) {
  const prefix = `${label}: `;
  const line = content.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

function readMarkdownTableCells(line) {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("|") || !trimmedLine.endsWith("|")) {
    return [];
  }

  return trimmedLine
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function readGitHubPullUrlPrNumber(value, repoFullName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  const [owner, repo, extraPart] = repoFullName.split("/");
  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  const isExpectedPullUrl =
    extraPart === undefined &&
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    pathParts.length === 4 &&
    pathParts[0] === owner &&
    pathParts[1] === repo &&
    pathParts[2] === "pull" &&
    isDecimalInteger(pathParts[3]);

  return isExpectedPullUrl ? pathParts[3] : undefined;
}

function isDecimalInteger(value) {
  return value.length > 0 && [...value].every((character) => character >= "0" && character <= "9");
}

function readSoakEvidenceRowPrNumbers(content, repoFullName) {
  const table = readSoakLogEvidenceTable(content, repoFullName);
  if (table === undefined) {
    return [];
  }

  const fieldIndexes = readSoakLogFieldIndexes(table.header);
  return table.rows.flatMap((row) => {
    const prUrlCell = readRequiredSoakLogCell(row, fieldIndexes, "PR URL");
    const prNumber =
      prUrlCell === undefined ? undefined : readGitHubPullUrlPrNumber(prUrlCell, repoFullName);
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

  if (prRange === undefined) {
    return rejectedNoCrash("restart evidence is incomplete");
  }

  if (before === undefined && afterCounts.length === 0) {
    return rejectedNoCrash("restart evidence is incomplete", "missing container restart evidence");
  }

  if (before === undefined || afterCounts.length === 0) {
    return rejectedNoCrash("restart evidence is incomplete");
  }

  if (afterCounts.some((after) => after.restartCount > before)) {
    return rejectedNoCrash("container restarted", "container restarted during the smoke PR set");
  }

  if (!afterCounts.some((after) => after.prNumber >= prRange.toPr)) {
    return rejectedNoCrash("restart evidence is incomplete");
  }

  const exitResult = evaluateNoExitEvidence(content, prRange);
  if (exitResult.outcome === "missing") {
    return rejectedNoCrash("crash evidence is incomplete");
  }
  if (exitResult.outcome === "rejected") {
    return rejectedNoCrash(exitResult.reason);
  }

  const healthResult = evaluateHealthEvidence(content, prRange);
  if (healthResult.outcome === "missing") {
    return rejectedNoCrash(healthResult.reason);
  }
  if (healthResult.outcome === "rejected") {
    return rejectedNoCrash(healthResult.reason, healthResult.message);
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

function readCommunityBotProcessExitCode(content, range) {
  return (
    readCommunityBotProcessExitCodeAfterPr(content, range) ??
    readIntegerLine(content, "Community bot process exit code: ")
  );
}

function readCommunityBotProcessExitCodeAfterPr(content, range) {
  const lines = content.split(/\r?\n/u);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const match = COMMUNITY_BOT_PROCESS_EXIT_AFTER_PR_PATTERN.exec(line);
    if (match?.groups === undefined) {
      continue;
    }

    const prNumber = Number.parseInt(match.groups.prNumber, 10);
    if (prNumber < range.fromPr || prNumber > range.toPr) {
      continue;
    }

    return Number.parseInt(match.groups.exitCode, 10);
  }

  return undefined;
}

function evaluateNoExitEvidence(content, range) {
  if (hasNoContainerExitEvent(content)) {
    return { outcome: "accepted" };
  }

  const exitCode = readCommunityBotProcessExitCode(content, range);
  if (exitCode === undefined) {
    return { outcome: "missing" };
  }
  if (exitCode !== 0) {
    return { outcome: "rejected", reason: `process exited with code ${exitCode}` };
  }

  return { outcome: "accepted" };
}

function hasNoContainerExitEvent(content) {
  return content
    .split(/\r?\n/u)
    .some((line) => line === `Container exit event: none for ${COMMUNITY_BOT_CONTAINER_NAME}`);
}

function evaluateHealthEvidence(content, range) {
  const healthEvidence = readRangeHealthEvidence(content, range);
  if (requiresRangeHealthEvidence(range, healthEvidence)) {
    return evaluateCompleteRangeHealthEvidence(healthEvidence, range);
  }

  const healthStatus = readLatestHealthStatus(content);
  if (healthStatus === undefined) {
    return { outcome: "missing", reason: "crash evidence is incomplete" };
  }
  if (healthStatus !== 200) {
    return { message: "/health failed", outcome: "rejected", reason: "/health failed" };
  }

  return { outcome: "accepted" };
}

function readRangeHealthEvidence(content, range) {
  const afterStatuses = new Map();
  let beforeStatus;
  let hasRangeEvidence = false;

  for (const line of content.split(/\r?\n/u)) {
    const beforeMatch = /^GET \/health before PR (\d+): (\d+)$/u.exec(line);
    if (beforeMatch !== null) {
      const prNumber = Number.parseInt(beforeMatch[1], 10);
      if (prNumber === range.fromPr) {
        beforeStatus = Number.parseInt(beforeMatch[2], 10);
        hasRangeEvidence = true;
      }
    }

    const afterMatch = /^GET \/health after PR (\d+): (\d+)$/u.exec(line);
    if (afterMatch !== null) {
      const prNumber = Number.parseInt(afterMatch[1], 10);
      if (prNumber >= range.fromPr && prNumber <= range.toPr) {
        afterStatuses.set(prNumber, Number.parseInt(afterMatch[2], 10));
        hasRangeEvidence = true;
      }
    }
  }

  return { afterStatuses, beforeStatus, hasRangeEvidence };
}

function requiresRangeHealthEvidence(range, healthEvidence) {
  return healthEvidence.hasRangeEvidence || countPrs(range) >= 5;
}

function countPrs(range) {
  return range.toPr - range.fromPr + 1;
}

function evaluateCompleteRangeHealthEvidence(healthEvidence, range) {
  if (healthEvidence.beforeStatus === undefined) {
    return { outcome: "missing", reason: "health evidence is incomplete" };
  }
  if (healthEvidence.beforeStatus !== 200) {
    return {
      message: "/health failed during the smoke PR set",
      outcome: "rejected",
      reason: "/health failed",
    };
  }

  for (let prNumber = range.fromPr; prNumber <= range.toPr; prNumber += 1) {
    const healthStatus = healthEvidence.afterStatuses.get(prNumber);
    if (healthStatus === undefined) {
      return { outcome: "missing", reason: "health evidence is incomplete" };
    }
    if (healthStatus !== 200) {
      return {
        message: "/health failed during the smoke PR set",
        outcome: "rejected",
        reason: "/health failed",
      };
    }
  }

  return { outcome: "accepted" };
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
  return parseIntegerOption(name, rawValue);
}

function readOptionalIntegerOption(name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`${name} is malformed`);
  }

  return parseIntegerOption(name, value);
}

function parseIntegerOption(name, rawValue) {
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
