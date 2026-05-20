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
const BLOCK_SCALAR_PATTERN = /:\s*[>|](?:[+-]?[1-9]?|[1-9][+-]?)?\s*(?:#.*)?$/;
const GITLEAKS_ACTION_REPOSITORY = "gitleaks/gitleaks-action";

const durationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs duration-budget --job-start-ms <ms> --job-end-ms <ms> --pnpm-cache hit --turbo-cache hit";
const actionPinningUsage = "Usage: node scripts/ci-policy.mjs action-pinning --workflow <path>";
const gitleaksActionPinningUsage =
  "Usage: node scripts/ci-policy.mjs gitleaks-action-pinning --workflow <path> --metadata <gitleaks-pin-metadata.json>";
const auditGateUsage =
  "Usage: node scripts/ci-policy.mjs audit-gate --input <pnpm-audit-report.json> --audit-level high";
const secretsCheckoutDepthUsage =
  "Usage: node scripts/ci-policy.mjs secrets-checkout-depth --workflow <path>";
const secretsFixtureEvidenceUsage =
  "Usage: node scripts/ci-policy.mjs secrets-fixture-evidence --input <fixture-evidence.json> --false-positive-fixture <path>";
const usage = `${durationBudgetUsage}\n${actionPinningUsage}\n${gitleaksActionPinningUsage}\n${auditGateUsage}\n${secretsCheckoutDepthUsage}\n${secretsFixtureEvidenceUsage}`;

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

const getIndent = (line) => line.match(/^ */)?.[0].length ?? 0;

const getYamlStructureLines = (workflow) => {
  const lines = [];
  let blockScalarIndent;

  for (const line of workflow.split(/\r?\n/)) {
    if (blockScalarIndent !== undefined) {
      if (line.trim().length === 0) continue;

      if (getIndent(line) > blockScalarIndent) continue;
      blockScalarIndent = undefined;
    }

    lines.push(line);

    if (BLOCK_SCALAR_PATTERN.test(line)) {
      blockScalarIndent = getIndent(line);
    }
  }

  return lines;
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

const getIndentedBlock = (workflow, parentPattern) => {
  const lines = getYamlStructureLines(workflow);
  const startIndex = lines.findIndex((line) => parentPattern.test(line));
  if (startIndex === -1) return "";

  const startIndent = getIndent(lines[startIndex]);
  const block = [lines[startIndex]];

  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }

    const indent = getIndent(line);
    if (indent <= startIndent) break;
    block.push(line);
  }

  return block.join("\n");
};

const getListItemBlocks = (workflow) => {
  const lines = getYamlStructureLines(workflow);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+/.test(lines[index])) continue;

    const startIndent = getIndent(lines[index]);
    const block = [lines[index]];

    for (const line of lines.slice(index + 1)) {
      if (line.trim().length === 0) {
        block.push(line);
        continue;
      }

      const indent = getIndent(line);
      if (indent <= startIndent) break;
      block.push(line);
    }

    blocks.push(block.join("\n"));
  }

  return blocks;
};

const hasInlineFullHistoryFetchDepth = (step) => {
  const inlineWith = step.match(/^\s*with:\s*\{([^}]*)\}\s*(?:#.*)?$/m)?.[1];
  if (inlineWith === undefined) return false;

  return inlineWith
    .split(",")
    .some((entry) => /^\s*fetch-depth\s*:\s*(?:0|["']0["'])\s*$/.test(entry));
};

const hasFullHistoryFetchDepthInput = (step) => {
  if (hasInlineFullHistoryFetchDepth(step)) return true;

  const withBlock = getIndentedBlock(step, /^\s+with:\s*(?:#.*)?$/);
  return /^\s*fetch-depth:\s*(?:0|["']0["'])\s*(?:#.*)?$/m.test(withBlock);
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

const getGitleaksActionReferences = (workflow) => {
  const jobsBlock = getIndentedBlock(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const secretsJob = getIndentedBlock(jobsBlock, /^\s+secrets-scan:\s*(?:#.*)?$/);
  const stepsBlock = getIndentedBlock(secretsJob, /^\s+steps:\s*(?:#.*)?$/);
  return extractActionReferences(stepsBlock).filter((actionReference) =>
    actionReference.startsWith(`${GITLEAKS_ACTION_REPOSITORY}@`),
  );
};

const getActionRef = (pin) => {
  if (typeof pin !== "object" || pin === null || typeof pin.action_ref !== "string") {
    fail("ERROR: Gitleaks pin metadata entries must contain action_ref.", 2);
  }

  return pin.action_ref;
};

const getSourceReleaseLine = (pin) => {
  if (typeof pin !== "object" || pin === null || typeof pin.source_release_line !== "string") {
    fail("ERROR: Gitleaks pin metadata entries must contain source_release_line.", 2);
  }

  return pin.source_release_line;
};

const getGitleaksPinMetadataEntries = (metadata) => {
  if (typeof metadata !== "object" || metadata === null || !Array.isArray(metadata.pins)) {
    fail("ERROR: Gitleaks pin metadata must contain pins.", 2);
  }

  return metadata.pins;
};

const findGitleaksSourceReleaseLine = (metadata, actionReference) => {
  const pin = getGitleaksPinMetadataEntries(metadata).find(
    (entry) => getActionRef(entry) === actionReference,
  );

  return pin === undefined ? undefined : getSourceReleaseLine(pin);
};

const getGitleaksActionPinFailure = (actionReference) => {
  const ref = actionReference.slice(`${GITLEAKS_ACTION_REPOSITORY}@`.length);
  const boundaryReason = getShaBoundaryReason(actionReference);

  if (/^[0-9a-f]{40}$/.test(ref)) return undefined;
  if (boundaryReason !== undefined) return boundaryReason;
  if (ref.length === FULL_COMMIT_SHA_LENGTH) return "SHA must use lowercase hexadecimal characters";
  return "Gitleaks action must be pinned to a full commit SHA";
};

const readAuditReport = (inputPath) => {
  try {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  } catch {
    fail(`ERROR: Unable to read audit report file: ${inputPath}.`, 2);
  }
};

const readJsonFile = (inputPath, label) => {
  try {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  } catch {
    fail(`ERROR: Unable to read ${label} file: ${inputPath}.`, 2);
  }
};

const getAuditVulnerabilities = (report) => {
  if (typeof report !== "object" || report === null) {
    fail("ERROR: audit report must contain metadata.vulnerabilities.", 2);
  }
  const metadata = report.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    fail("ERROR: audit report must contain metadata.vulnerabilities.", 2);
  }
  const vulnerabilities = metadata.vulnerabilities;
  if (typeof vulnerabilities !== "object" || vulnerabilities === null) {
    fail("ERROR: audit report must contain metadata.vulnerabilities.", 2);
  }
  return vulnerabilities;
};

const getAuditSeverityCount = (vulnerabilities, severity) => {
  const count = vulnerabilities[severity];
  if (!Number.isInteger(count) || count < 0) {
    fail(
      `ERROR: audit report metadata.vulnerabilities.${severity} must be a non-negative integer.`,
      2,
    );
  }
  return count;
};

const getAuditAdvisoryNames = (report, severity) => {
  if (typeof report !== "object" || report === null) return [];
  const advisories = report.advisories;
  if (typeof advisories !== "object" || advisories === null) return [];

  return Object.entries(advisories)
    .filter(([, advisory]) => {
      if (typeof advisory !== "object" || advisory === null) return false;
      return advisory.severity === severity;
    })
    .map(([name]) => name);
};

const getFixtureEntries = (report) => {
  if (typeof report !== "object" || report === null) {
    fail("ERROR: fixture evidence must contain fixtures.", 2);
  }

  const fixtures = report.fixtures;
  if (!Array.isArray(fixtures)) {
    fail("ERROR: fixture evidence must contain fixtures.", 2);
  }

  return fixtures;
};

const getFixturePath = (fixture) => {
  if (typeof fixture !== "object" || fixture === null || typeof fixture.path !== "string") {
    fail("ERROR: fixture evidence entries must contain path.", 2);
  }

  return fixture.path;
};

const getFixtureMatches = (fixture) => {
  if (typeof fixture !== "object" || fixture === null || !Array.isArray(fixture.matches)) {
    fail("ERROR: fixture evidence entries must contain matches.", 2);
  }

  return fixture.matches;
};

const isResolvedMatch = (match) => {
  if (typeof match !== "object" || match === null) return false;
  return (
    match.status === "resolved" &&
    typeof match.resolution_reason === "string" &&
    match.resolution_reason.trim().length > 0
  );
};

const getMatchId = (match) => {
  if (typeof match !== "object" || match === null || typeof match.id !== "string") {
    return "unknown-match";
  }

  return match.id;
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

const runGitleaksActionPinning = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", gitleaksActionPinningUsage);
  const metadataPath = readRequiredOption(options, "metadata", gitleaksActionPinningUsage);
  const workflow = readWorkflowFile(workflowPath);
  const metadata = readJsonFile(metadataPath, "Gitleaks pin metadata");
  const actionReferences = getGitleaksActionReferences(workflow);

  if (actionReferences.length === 0) {
    writeStdout("gitleaks_action=fail\n");
    fail(`secrets-scan must run ${GITLEAKS_ACTION_REPOSITORY}`, 1);
  }

  const pinFailures = actionReferences
    .map((actionReference) => ({
      actionReference,
      reason: getGitleaksActionPinFailure(actionReference),
    }))
    .filter((failure) => failure.reason !== undefined);

  if (pinFailures.length > 0) {
    writeStdout(
      `gitleaks_action=fail\n${pinFailures
        .map(
          (failure) =>
            `moving_reference=${failure.actionReference}\nboundary_reason=${failure.reason}\n`,
        )
        .join("")}`,
    );
    fail([...new Set(pinFailures.map((failure) => failure.reason))].join("\n"), 1);
  }

  const provenanceFailures = actionReferences.filter(
    (actionReference) => findGitleaksSourceReleaseLine(metadata, actionReference) !== "v2",
  );

  if (provenanceFailures.length > 0) {
    writeStdout(
      `gitleaks_action=fail\n${provenanceFailures
        .map((actionReference) => `pinned_reference=${actionReference}\n`)
        .join("")}`,
    );
    fail("Gitleaks pin must originate from the v2 release line", 1);
  }

  writeStdout(
    `gitleaks_action=pass\n${actionReferences
      .map(
        (actionReference) =>
          `pinned_reference=${actionReference}\nsource_release_line=v2\nboundary_reason=40 hexadecimal characters is exactly valid\n`,
      )
      .join("")}`,
  );
};

const runAuditGate = (args) => {
  const options = parseOptions(args);
  const inputPath = readRequiredOption(options, "input", auditGateUsage);
  const auditLevel = readRequiredOption(options, "audit-level", auditGateUsage);
  if (auditLevel !== "high") {
    fail('ERROR: --audit-level must be "high".', 2);
  }

  const report = readAuditReport(inputPath);
  const vulnerabilities = getAuditVulnerabilities(report);
  const highCount = getAuditSeverityCount(vulnerabilities, "high");
  const criticalCount = getAuditSeverityCount(vulnerabilities, "critical");

  if (criticalCount > 0) {
    const criticalAdvisories = getAuditAdvisoryNames(report, "critical");
    const criticalFailureReason =
      criticalAdvisories.length === 0
        ? `pnpm audit reported ${criticalCount} critical severity vulnerability`
        : `critical severity vulnerability ${criticalAdvisories.join(", ")}`;
    writeStdout("audit_gate=fail\n");
    fail(criticalFailureReason, 1);
  }

  if (highCount > 0) {
    const highAdvisories = getAuditAdvisoryNames(report, "high");
    const highFailureReason =
      highAdvisories.length === 0
        ? `pnpm audit reported ${highCount} high severity vulnerability`
        : `high severity vulnerability ${highAdvisories.join(", ")}`;
    writeStdout("audit_gate=fail\n");
    fail(highFailureReason, 1);
  }

  writeStdout("audit_gate=pass\n");
};

const runSecretsFixtureEvidence = (args) => {
  const options = parseOptions(args);
  const inputPath = readRequiredOption(options, "input", secretsFixtureEvidenceUsage);
  const falsePositivePath = readRequiredOption(
    options,
    "false-positive-fixture",
    secretsFixtureEvidenceUsage,
  );
  const report = readJsonFile(inputPath, "fixture evidence");
  const fixtures = getFixtureEntries(report);
  const falsePositiveFixture = fixtures.find(
    (fixture) => getFixturePath(fixture) === falsePositivePath,
  );

  if (falsePositiveFixture === undefined) {
    writeStdout("fixture_evidence=fail\n");
    fail(`false-positive fixture must be present: ${falsePositivePath}`, 1);
  }

  const falsePositiveMatches = getFixtureMatches(falsePositiveFixture);
  if (!falsePositiveMatches.some(isResolvedMatch)) {
    writeStdout("fixture_evidence=fail\n");
    fail(`false-positive fixture must be resolved before merge: ${falsePositivePath}`, 1);
  }

  const unresolvedMatches = fixtures.flatMap((fixture) =>
    getFixtureMatches(fixture)
      .filter((match) => !isResolvedMatch(match))
      .map((match) => ({ id: getMatchId(match), path: getFixturePath(fixture) })),
  );

  if (unresolvedMatches.length > 0) {
    writeStdout(
      `fixture_evidence=fail\n${unresolvedMatches
        .map((match) => `unresolved_match=${match.id}\nfixture_path=${match.path}\n`)
        .join("")}`,
    );
    fail(unresolvedMatches.map((match) => `${match.id} in ${match.path}`).join("\n"), 1);
  }

  writeStdout(`fixture_evidence=pass\nresolved_fixture=${falsePositivePath}\n`);
};

const runSecretsCheckoutDepth = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", secretsCheckoutDepthUsage);
  const workflow = readWorkflowFile(workflowPath);
  const jobsBlock = getIndentedBlock(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const secretsJob = getIndentedBlock(jobsBlock, /^\s+secrets-scan:\s*(?:#.*)?$/);
  const stepsBlock = getIndentedBlock(secretsJob, /^\s+steps:\s*(?:#.*)?$/);
  const checkoutUsesPattern =
    /^\s*(?:-\s*)?uses:\s*['"]?actions\/checkout@[^\s'"]+['"]?\s*(?:#.*)?$/m;
  const checkoutSteps = getListItemBlocks(stepsBlock).filter((step) =>
    checkoutUsesPattern.test(step),
  );
  const allCheckoutStepsUseFullHistory =
    checkoutSteps.length > 0 && checkoutSteps.every(hasFullHistoryFetchDepthInput);

  if (allCheckoutStepsUseFullHistory) {
    writeStdout("checkout_depth=pass\nhistory_scope=full\n");
    return;
  }

  writeStdout("checkout_depth=fail\n");
  fail(
    "secrets-scan must checkout full history; secrets-scan must use actions/checkout with fetch-depth: 0",
    1,
  );
};

const [command, ...args] = argv.slice(2);

if (command === "duration-budget") {
  runDurationBudget(args);
} else if (command === "action-pinning") {
  runActionPinning(args);
} else if (command === "gitleaks-action-pinning") {
  runGitleaksActionPinning(args);
} else if (command === "audit-gate") {
  runAuditGate(args);
} else if (command === "secrets-checkout-depth") {
  runSecretsCheckoutDepth(args);
} else if (command === "secrets-fixture-evidence") {
  runSecretsFixtureEvidence(args);
} else {
  fail(usage, 2);
}
