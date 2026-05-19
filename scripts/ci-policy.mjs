#!/usr/bin/env node
import { readFileSync, writeSync } from "node:fs";
import { argv, exit } from "node:process";

const writeStdout = (chunk) => writeSync(1, chunk);
const writeStderr = (chunk) => writeSync(2, chunk);

const DURATION_BUDGET_MS = 300000;
const FULL_COMMIT_SHA_LENGTH = 40;
const PINNED_EXTERNAL_ACTION_PATTERN = /@[0-9a-f]{40}$/;
const HEX_SHA_SUFFIX_PATTERN = /@([0-9a-f]+)$/;
const USES_LINE_PATTERN = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/;

const durationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs duration-budget --job-start-ms <ms> --job-end-ms <ms> --pnpm-cache hit --turbo-cache hit";
const actionPinningUsage = "Usage: node scripts/ci-policy.mjs action-pinning --workflow <path>";
const usage = `${durationBudgetUsage}\n${actionPinningUsage}`;

const fail = (message, code) => {
  writeStderr(`${message}\n`);
  exit(code);
};

const parseOptions = (args) => {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      fail(`ERROR: Invalid arguments.\n${usage}`, 2);
    }
    options.set(key.slice(2), value);
  }
  return options;
};

const readInteger = (options, key) => {
  const value = options.get(key);
  if (value === undefined || !/^\d+$/.test(value)) {
    fail(`ERROR: --${key} must be a non-negative integer.`, 2);
  }
  return Number(value);
};

const readCacheState = (options, key) => {
  const value = options.get(key);
  if (value !== "hit" && value !== "miss") {
    fail(`ERROR: --${key} must be "hit" or "miss".`, 2);
  }
  return value;
};

const readRequiredOption = (options, key, commandUsage) => {
  const value = options.get(key);
  if (value === undefined || value.length === 0) {
    fail(`ERROR: --${key} is required.\n${commandUsage}`, 2);
  }
  return value;
};

const formatDuration = (elapsedMs) => {
  if (elapsedMs % 1000 === 0) return `${elapsedMs / 1000} s`;
  return `${(elapsedMs / 1000).toFixed(3)} s`;
};

const runDurationBudget = (args) => {
  const options = parseOptions(args);
  const startMs = readInteger(options, "job-start-ms");
  const endMs = readInteger(options, "job-end-ms");
  const pnpmCache = readCacheState(options, "pnpm-cache");
  const turboCache = readCacheState(options, "turbo-cache");
  const elapsedMs = endMs - startMs;

  if (elapsedMs < 0) {
    fail("ERROR: --job-end-ms must be greater than or equal to --job-start-ms.", 2);
  }

  if (pnpmCache !== "hit" || turboCache !== "hit") {
    writeStdout(
      `measured_duration_ms=${elapsedMs}\nrun_classification=cache-miss\nr01_evidence=not-accepted\n`,
    );
    return;
  }

  if (pnpmCache === "hit" && turboCache === "hit" && elapsedMs < DURATION_BUDGET_MS) {
    writeStdout(
      `measured_duration_ms=${elapsedMs}\nduration_budget=pass\nreported_duration=${formatDuration(elapsedMs)}\n`,
    );
    return;
  }

  if (pnpmCache === "hit" && turboCache === "hit") {
    writeStdout(
      `measured_duration_ms=${elapsedMs}\nduration_budget=fail\nreported_duration=${formatDuration(elapsedMs)}\n`,
    );
    fail("backend-checks must finish in under 5 minutes on cache hit", 1);
  }

  writeStdout(
    `measured_duration_ms=${elapsedMs}\nduration_budget=unsupported\nreported_duration=${formatDuration(elapsedMs)}\n`,
  );
  exit(2);
};

const readWorkflowFile = (workflowPath) => {
  try {
    return readFileSync(workflowPath, "utf8");
  } catch {
    fail(`ERROR: Unable to read workflow file: ${workflowPath}.`, 2);
  }
};

const extractActionReferences = (workflow) => {
  const actionReferences = [];

  for (const line of workflow.split(/\r?\n/)) {
    const match = line.match(USES_LINE_PATTERN);
    if (match?.[1] !== undefined) {
      actionReferences.push(match[1]);
    }
  }

  return actionReferences;
};

const isExternalActionReference = (actionReference) => !actionReference.startsWith("./");

const isGitHubMaintainedActionReference = (actionReference) =>
  actionReference.startsWith("actions/");

const isPinnedExternalActionReference = (actionReference) =>
  PINNED_EXTERNAL_ACTION_PATTERN.test(actionReference);

const findMovingExternalActionReferences = (actionReferences) =>
  actionReferences.filter(
    (actionReference) =>
      isExternalActionReference(actionReference) &&
      !isPinnedExternalActionReference(actionReference),
  );

const getShaBoundaryReason = (actionReference) => {
  const match = actionReference.match(HEX_SHA_SUFFIX_PATTERN);
  const shaRef = match?.[1];
  if (shaRef === undefined) return undefined;

  if (shaRef.length === FULL_COMMIT_SHA_LENGTH) {
    return "40 hexadecimal characters is exactly valid";
  }

  if (shaRef.length < FULL_COMMIT_SHA_LENGTH) {
    return `${shaRef.length} hexadecimal characters is too short`;
  }

  return `${shaRef.length} hexadecimal characters is too long`;
};

const getBoundaryReasons = (actionReferences) =>
  actionReferences
    .filter(isExternalActionReference)
    .map(getShaBoundaryReason)
    .filter((reason) => reason !== undefined);

const getFailureMessages = (movingReferences) => {
  const messages = ["external actions must be pinned to a full commit SHA"];

  if (movingReferences.some(isGitHubMaintainedActionReference)) {
    messages.push("GitHub-maintained actions must be pinned to a full commit SHA");
  }

  return messages;
};

const runActionPinning = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", actionPinningUsage);
  const workflow = readWorkflowFile(workflowPath);
  const actionReferences = extractActionReferences(workflow);
  const movingReferences = findMovingExternalActionReferences(actionReferences);
  const boundaryReasons = getBoundaryReasons(actionReferences);

  if (movingReferences.length === 0) {
    writeStdout(
      `action_pinning=pass\n${boundaryReasons.map((reason) => `boundary_reason=${reason}\n`).join("")}`,
    );
    return;
  }

  writeStdout(
    `action_pinning=fail\n${movingReferences.map((ref) => `moving_reference=${ref}\n`).join("")}${boundaryReasons.map((reason) => `boundary_reason=${reason}\n`).join("")}`,
  );
  fail(getFailureMessages(movingReferences).join("\n"), 1);
};

const [command, ...args] = argv.slice(2);

if (command === "duration-budget") {
  runDurationBudget(args);
} else if (command === "action-pinning") {
  runActionPinning(args);
} else {
  fail(usage, 2);
}
