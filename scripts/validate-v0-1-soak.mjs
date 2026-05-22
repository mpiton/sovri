#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

const GHCR_IMAGE = "ghcr.io/mpiton/sovri/community-bot:v0.1.0";
const LOCAL_BUILD_EVIDENCE =
  /built sovri\/community-bot:smoke from Dockerfile at commit [0-9a-f]{40}/u;

const args = process.argv.slice(2);
const command = args[0];

if (command !== "image-provenance") {
  fail("usage: validate-v0-1-soak.mjs image-provenance --provenance-mode <mode> --soak-log <path>");
}

const provenanceMode = readOption("--provenance-mode");
const soakLogPath = readOption("--soak-log");
const soakLog = readFileSync(soakLogPath, "utf8");

if (!hasAcceptedImageProvenance(soakLog, provenanceMode)) {
  fail("image provenance assertion failed");
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
