#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { argv, exit, stdout, stderr } from "node:process";

const DURATION_BUDGET_MS = 300000;
const PINNED_EXTERNAL_ACTION_PATTERN = /@[0-9a-f]{40}$/;
const USES_LINE_PATTERN = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/;

const durationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs duration-budget --job-start-ms <ms> --job-end-ms <ms> --pnpm-cache hit --turbo-cache hit";
const actionPinningUsage = "Usage: node scripts/ci-policy.mjs action-pinning --workflow <path>";
const usage = `${durationBudgetUsage}\n${actionPinningUsage}`;

const fail = (message, code) => {
  stderr.write(`${message}\n`);
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
    stdout.write(
      `measured_duration_ms=${elapsedMs}\nrun_classification=cache-miss\nr01_evidence=not-accepted\n`,
    );
    return;
  }

  if (pnpmCache === "hit" && turboCache === "hit" && elapsedMs < DURATION_BUDGET_MS) {
    stdout.write(
      `measured_duration_ms=${elapsedMs}\nduration_budget=pass\nreported_duration=${formatDuration(elapsedMs)}\n`,
    );
    return;
  }

  stdout.write(
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

const isPinnedExternalActionReference = (actionReference) =>
  PINNED_EXTERNAL_ACTION_PATTERN.test(actionReference);

const findMovingExternalActionReferences = (actionReferences) =>
  actionReferences.filter(
    (actionReference) =>
      isExternalActionReference(actionReference) &&
      !isPinnedExternalActionReference(actionReference),
  );

const runActionPinning = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", actionPinningUsage);
  const workflow = readWorkflowFile(workflowPath);
  const movingReferences = findMovingExternalActionReferences(extractActionReferences(workflow));

  if (movingReferences.length === 0) {
    stdout.write("action_pinning=pass\n");
    return;
  }

  stdout.write(
    `action_pinning=fail\n${movingReferences.map((ref) => `moving_reference=${ref}`).join("\n")}\n`,
  );
  fail("external actions must be pinned to a full commit SHA", 1);
};

const [command, ...args] = argv.slice(2);

if (command === "duration-budget") {
  runDurationBudget(args);
} else if (command === "action-pinning") {
  runActionPinning(args);
} else {
  fail(usage, 2);
}
