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
} else {
  fail("usage: validate-v0-1-soak.mjs <image-provenance|anthropic-key> [options]");
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

function readOption(name) {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || value === undefined || value.startsWith("--")) {
    fail(`${name} is required`);
  }
  return value;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
