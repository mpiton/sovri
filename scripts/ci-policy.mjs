#!/usr/bin/env node
import { readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { argv, exit } from "node:process";

const writeStdout = (chunk) => writeSync(1, chunk);
const writeStderr = (chunk) => writeSync(2, chunk);

const DURATION_BUDGET_MS = 300000;
const SECRETS_SCAN_DURATION_BUDGET_MS = 60000;
const FORBIDDEN_JOB_DURATION_BUDGET_MS = 30000;
const BUILD_DOCKER_DURATION_BUDGET_MS = 600000;
const FULL_COMMIT_SHA_LENGTH = 40;
const PINNED_EXTERNAL_ACTION_PATTERN = /@[0-9a-f]{40}$/;
const HEX_SHA_SUFFIX_PATTERN = /@([0-9a-f]+)$/;
const USES_LINE_PATTERN = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/;
const BLOCK_SCALAR_PATTERN = /:\s*[>|](?:[+-]?[1-9]?|[1-9][+-]?)?\s*(?:#.*)?$/;
const GITLEAKS_ACTION_REPOSITORY = "gitleaks/gitleaks-action";
const DOCKER_BUILD_ACTION_REPOSITORY = "docker/build-push-action";
const DOCKER_SETUP_ACTION_REPOSITORIES = ["docker/setup-qemu-action", "docker/setup-buildx-action"];
const TRIVY_ACTION_REPOSITORY = "aquasecurity/trivy-action";
const CODEQL_UPLOAD_SARIF_ACTION_REPOSITORY = "github/codeql-action/upload-sarif";
const TRIVY_REQUIRED_SEVERITY = "HIGH,CRITICAL";
const TRIVY_REQUIRED_EXIT_CODE = "1";
const TRIVY_REQUIRED_SARIF_FORMAT = "sarif";
const TRIVY_REQUIRED_SARIF_PATH = "trivy-results.sarif";
const TRIVY_BLOCKING_SEVERITIES = new Set(["HIGH", "CRITICAL"]);
const REQUIRED_BUILD_DOCKER_NEEDS = [
  "backend-checks",
  "supply-chain",
  "secrets-scan",
  "forbidden-tools",
  "forbidden-imports",
];

const durationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs duration-budget --job-start-ms <ms> --job-end-ms <ms> --pnpm-cache hit --turbo-cache hit";
const secretsDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs secrets-duration-budget --job-start-ms <ms> --job-end-ms <ms>";
const forbiddenJobsDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs forbidden-jobs-duration-budget --forbidden-tools-ms <ms|missing|unknown> --forbidden-imports-ms <ms|missing|unknown>";
const buildDockerDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs build-docker-duration-budget --job-start-ms <ms> --job-end-ms <ms> --github-actions-cache <enabled|missing>";
const dockerBuildActionUsage =
  "Usage: node scripts/ci-policy.mjs docker-build-action --workflow <path>";
const dockerSetupActionPinningUsage =
  "Usage: node scripts/ci-policy.mjs docker-setup-action-pinning --workflow <path>";
const buildDockerNeedsUsage =
  "Usage: node scripts/ci-policy.mjs build-docker-needs --workflow <path>";
const buildDockerSchedulerUsage =
  "Usage: node scripts/ci-policy.mjs build-docker-scheduler --backend-checks <success|failure|cancelled|skipped> --supply-chain <success|failure|cancelled|skipped> --secrets-scan <success|failure|cancelled|skipped> --forbidden-tools <success|failure|cancelled|skipped> --forbidden-imports <success|failure|cancelled|skipped>";
const actionPinningUsage = "Usage: node scripts/ci-policy.mjs action-pinning --workflow <path>";
const gitleaksActionPinningUsage =
  "Usage: node scripts/ci-policy.mjs gitleaks-action-pinning --workflow <path> --metadata <gitleaks-pin-metadata.json>";
const auditGateUsage =
  "Usage: node scripts/ci-policy.mjs audit-gate --input <pnpm-audit-report.json> --audit-level high";
const trivyVulnerabilityGateUsage =
  "Usage: node scripts/ci-policy.mjs trivy-vulnerability-gate --input <trivy-result.json> --image <image-ref>";
const trivyScanConfigUsage =
  "Usage: node scripts/ci-policy.mjs trivy-scan-config --workflow <path>";
const trivyStepCompletionUsage =
  "Usage: node scripts/ci-policy.mjs trivy-step-completion --input <trivy-result.json> --image <image-ref> --exit-code <code>";
const trivySarifUploadConfigUsage =
  "Usage: node scripts/ci-policy.mjs trivy-sarif-upload-config --workflow <path>";
const trivySarifUploadAfterFailureUsage =
  "Usage: node scripts/ci-policy.mjs trivy-sarif-upload-after-failure --workflow <path> --input <trivy-result.json> --image <image-ref> --exit-code <code>";
const secretsCheckoutDepthUsage =
  "Usage: node scripts/ci-policy.mjs secrets-checkout-depth --workflow <path>";
const secretsFixtureEvidenceUsage =
  "Usage: node scripts/ci-policy.mjs secrets-fixture-evidence --input <fixture-evidence.json> --false-positive-fixture <path>";
const secretsNoSecretsReuseUsage =
  "Usage: node scripts/ci-policy.mjs secrets-no-secrets-reuse --workflow <path> --script-path <path> [--repo-root <path>]";
const usage = `${durationBudgetUsage}\n${secretsDurationBudgetUsage}\n${forbiddenJobsDurationBudgetUsage}\n${buildDockerDurationBudgetUsage}\n${dockerBuildActionUsage}\n${dockerSetupActionPinningUsage}\n${buildDockerNeedsUsage}\n${buildDockerSchedulerUsage}\n${actionPinningUsage}\n${gitleaksActionPinningUsage}\n${auditGateUsage}\n${trivyVulnerabilityGateUsage}\n${trivyScanConfigUsage}\n${trivyStepCompletionUsage}\n${trivySarifUploadConfigUsage}\n${trivySarifUploadAfterFailureUsage}\n${secretsCheckoutDepthUsage}\n${secretsFixtureEvidenceUsage}\n${secretsNoSecretsReuseUsage}`;

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

const getYamlStructureEntries = (workflow) => {
  const entries = [];
  let blockScalarIndent;
  const lines = workflow.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (blockScalarIndent !== undefined) {
      if (line.trim().length === 0) continue;

      if (getIndent(line) > blockScalarIndent) continue;
      blockScalarIndent = undefined;
    }

    entries.push({ index, line });

    if (BLOCK_SCALAR_PATTERN.test(line)) {
      blockScalarIndent = getIndent(line);
    }
  }

  return entries;
};

const getYamlStructureLines = (workflow) =>
  getYamlStructureEntries(workflow).map((entry) => entry.line);

const formatDuration = (elapsedMs) => {
  if (elapsedMs % 1000 === 0) return `${elapsedMs / 1000} s`;
  return `${(elapsedMs / 1000).toFixed(3)} s`;
};

const formatBuildDockerDuration = (elapsedMs) => {
  const minutes = Math.floor(elapsedMs / 60000);
  const remainingMs = elapsedMs % 60000;
  if (remainingMs === 0) return `${minutes} min`;
  if (minutes === 0) return formatDuration(remainingMs);
  return `${minutes} min ${formatDuration(remainingMs)}`;
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

const runSecretsDurationBudget = (args) => {
  const options = parseOptions(args);
  const startMs = readInteger(options, "job-start-ms");
  const endMs = readInteger(options, "job-end-ms");
  const elapsedMs = endMs - startMs;

  if (elapsedMs < 0) {
    fail("ERROR: --job-end-ms must be greater than or equal to --job-start-ms.", 2);
  }

  if (elapsedMs < SECRETS_SCAN_DURATION_BUDGET_MS) {
    writeStdout(
      `measured_duration_ms=${elapsedMs}\nduration_budget=pass\nreported_duration=${formatDuration(elapsedMs)}\n`,
    );
    return;
  }

  writeStdout(
    `measured_duration_ms=${elapsedMs}\nduration_budget=fail\nreported_duration=${formatDuration(elapsedMs)}\n`,
  );
  fail("secrets-scan must finish in under 1 minute", 1);
};

const readDurationEvidence = (options, key) => {
  const value = options.get(key);
  if (value === "missing" || value === "unknown") return value;
  if (value === undefined || !/^\d+$/.test(value)) {
    fail(`ERROR: --${key} must be a non-negative integer, "missing", or "unknown".`, 2);
  }
  return Number(value);
};

const runForbiddenJobsDurationBudget = (args) => {
  const options = parseOptions(args);
  const jobs = [
    ["forbidden-tools", readDurationEvidence(options, "forbidden-tools-ms")],
    ["forbidden-imports", readDurationEvidence(options, "forbidden-imports-ms")],
  ];

  for (const [jobName, evidence] of jobs) {
    if (evidence === "missing") {
      writeStdout(`duration_budget=fail\njob=${jobName}\njob_state=missing\n`);
      fail(`missing monitored job: ${jobName}`, 1);
    }

    if (evidence === "unknown") {
      writeStdout(`duration_budget=fail\njob=${jobName}\nduration_evidence=missing\n`);
      fail(`missing duration evidence for ${jobName}`, 1);
    }
  }

  const failures = jobs.filter(([, elapsedMs]) => elapsedMs >= FORBIDDEN_JOB_DURATION_BUDGET_MS);
  if (failures.length > 0) {
    writeStdout(
      `duration_budget=fail\n${jobs
        .map(
          ([jobName, elapsedMs]) =>
            `job=${jobName}\nmeasured_duration_ms=${elapsedMs}\nreported_duration=${formatDuration(elapsedMs)}\n`,
        )
        .join("")}`,
    );
    fail(failures.map(([jobName]) => `${jobName} must finish in under 30 seconds`).join("\n"), 1);
  }

  writeStdout(
    `duration_budget=pass\n${jobs
      .map(
        ([jobName, elapsedMs]) =>
          `job=${jobName}\nmeasured_duration_ms=${elapsedMs}\nreported_duration=${formatDuration(elapsedMs)}\n`,
      )
      .join("")}`,
  );
};

const readBuildDockerCacheState = (options) => {
  const value = options.get("github-actions-cache");
  if (value !== "enabled" && value !== "missing") {
    fail('ERROR: --github-actions-cache must be "enabled" or "missing".', 2);
  }
  return value;
};

const runBuildDockerDurationBudget = (args) => {
  const options = parseOptions(args);
  const startMs = readInteger(options, "job-start-ms");
  const endMs = readInteger(options, "job-end-ms");
  const cacheState = readBuildDockerCacheState(options);
  const elapsedMs = endMs - startMs;

  if (elapsedMs < 0) {
    fail("ERROR: --job-end-ms must be greater than or equal to --job-start-ms.", 2);
  }

  if (cacheState !== "enabled") {
    writeStdout(`duration_budget=fail\nmeasured_duration_ms=${elapsedMs}\n`);
    fail("GitHub Actions cache must be enabled for build-docker", 1);
  }

  if (elapsedMs < BUILD_DOCKER_DURATION_BUDGET_MS) {
    writeStdout(
      `measured_duration_ms=${elapsedMs}\nduration_budget=pass\nreported_duration=${formatBuildDockerDuration(elapsedMs)}\n`,
    );
    return;
  }

  writeStdout(
    `measured_duration_ms=${elapsedMs}\nduration_budget=fail\nreported_duration=${formatBuildDockerDuration(elapsedMs)}\n`,
  );
  fail("build-docker must finish in under 10 minutes", 1);
};

const findDirectChildEntry = (entries, parentEntry, childPattern) => {
  const parentIndent = getIndent(parentEntry.line);
  let childIndent;

  for (const entry of entries.filter((candidate) => candidate.index > parentEntry.index)) {
    const trimmedLine = entry.line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) continue;

    const indent = getIndent(entry.line);
    if (indent <= parentIndent) break;

    childIndent ??= indent;
    if (indent === childIndent && childPattern.test(entry.line)) return entry;
  }

  return undefined;
};

const findRootEntry = (entries, rootPattern) => {
  const rootIndent = entries
    .filter((entry) => {
      const trimmedLine = entry.line.trim();
      return trimmedLine.length > 0 && !trimmedLine.startsWith("#");
    })
    .map((entry) => getIndent(entry.line))
    .reduce((lowestIndent, indent) => Math.min(lowestIndent, indent), Number.POSITIVE_INFINITY);

  if (rootIndent === Number.POSITIVE_INFINITY) return undefined;

  return entries.find(
    (entry) => getIndent(entry.line) === rootIndent && rootPattern.test(entry.line),
  );
};

const getBuildDockerStepsBlockEntry = (workflow) => {
  const jobsPattern = /^\s*jobs:\s*(?:#.*)?$/;
  const entries = getYamlStructureEntries(workflow);
  const jobsEntry = findRootEntry(entries, jobsPattern);
  if (jobsEntry === undefined) return undefined;

  const buildDockerEntry = findDirectChildEntry(
    entries,
    jobsEntry,
    /^\s+build-docker:\s*(?:&[^\s#]+)?\s*(?:#.*)?$/,
  );
  if (buildDockerEntry === undefined) return undefined;

  const stepsEntry = findDirectChildEntry(entries, buildDockerEntry, /^\s+steps:\s*(?:#.*)?$/);
  if (stepsEntry === undefined) return undefined;

  return {
    block: getIndentedBlockRawFromIndex(workflow, stepsEntry.index),
    startIndex: stepsEntry.index,
  };
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitFlowMappingEntries = (flowMapping) => {
  const entries = [];
  let current = "";
  let quote;

  for (const character of flowMapping) {
    if (quote !== undefined) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    if (character === ",") {
      entries.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim().length > 0) entries.push(current.trim());
  return entries;
};

const parseFlowMapping = (flowMapping) => {
  const parsed = new Map();

  for (const entry of splitFlowMappingEntries(flowMapping)) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = stripYamlQuotes(entry.slice(0, separatorIndex).trim());
    const value = stripYamlQuotes(entry.slice(separatorIndex + 1).trim());
    parsed.set(key, value);
  }

  return parsed;
};

const getFlowMappingText = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed.slice(1, -1);

  const anchoredFlow = trimmed.match(/^&[^\s#]+\s+(\{.*\})$/)?.[1];
  if (anchoredFlow !== undefined) return anchoredFlow.slice(1, -1);

  return undefined;
};

const getStepPropertyBlockRaw = (step, propertyName) => {
  const lines = step.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return "";

  const stepIndent = getIndent(firstLine);
  const inlinePattern = new RegExp(`^\\s*-\\s+${propertyName}:\\s*(?:&[^\\s#]+)?\\s*(?:#.*)?$`);
  const propertyPattern = new RegExp(`^\\s*${propertyName}:\\s*(?:&[^\\s#]+)?\\s*(?:#.*)?$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineIndent = getIndent(line);
    const isInlineProperty = index === 0 && lineIndent === stepIndent && inlinePattern.test(line);
    const isBlockProperty =
      index > 0 && lineIndent === stepIndent + 2 && propertyPattern.test(line);
    if (!isInlineProperty && !isBlockProperty) continue;

    const block = [line];
    for (const blockLine of lines.slice(index + 1)) {
      if (blockLine.trim().length === 0) {
        block.push(blockLine);
        continue;
      }
      if (getIndent(blockLine) <= lineIndent) break;
      block.push(blockLine);
    }
    return block.join("\n");
  }

  return "";
};

const getInputFromWithBlock = (withBlock, inputName) => {
  const lines = withBlock.split(/\r?\n/);
  const withIndent = getIndent(lines[0] ?? "");
  const inputPattern = new RegExp(`^\\s*${inputName}:\\s*(.*?)\\s*(?:#.*)?$`);
  let childIndent;
  let activeScalarIndent;

  for (let inputIndex = 1; inputIndex < lines.length; inputIndex += 1) {
    const inputLine = lines[inputIndex];
    const trimmedInputLine = inputLine.trim();
    if (trimmedInputLine.length === 0 || trimmedInputLine.startsWith("#")) continue;

    const indent = getIndent(inputLine);
    if (activeScalarIndent !== undefined) {
      if (indent > activeScalarIndent) continue;
      activeScalarIndent = undefined;
    }
    if (indent <= withIndent) break;

    childIndent ??= indent;
    if (indent !== childIndent) continue;

    const isBlockScalar = BLOCK_SCALAR_PATTERN.test(inputLine);
    const value = inputLine.match(inputPattern)?.[1]?.trim();
    if (value === undefined) {
      if (isBlockScalar) activeScalarIndent = indent;
      continue;
    }
    if (!isBlockScalar) return stripYamlQuotes(value);

    const scalarLines = [];
    for (const line of lines.slice(inputIndex + 1)) {
      if (line.trim().length === 0) continue;
      if (getIndent(line) <= indent) break;
      scalarLines.push(line.trim());
    }
    const scalarSeparator = /:\s*>/.test(inputLine) ? " " : "\n";
    return scalarLines.join(scalarSeparator);
  }

  return undefined;
};

const getIndentedBlockRawFromIndex = (workflow, startIndex) => {
  const lines = workflow.split(/\r?\n/);
  const startLine = lines[startIndex];
  if (startLine === undefined) return "";

  const startIndent = getIndent(startLine);
  const block = [startLine];

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

const getStepPropertyLineIndex = (step, propertyName) => {
  const lines = step.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return undefined;

  const stepIndent = getIndent(firstLine);
  const inlinePattern = new RegExp(`^\\s*-\\s+${propertyName}:\\s*.*$`);
  const propertyPattern = new RegExp(`^\\s*${propertyName}:\\s*.*$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0 && getIndent(line) === stepIndent && inlinePattern.test(line)) return index;
    if (index > 0 && getIndent(line) === stepIndent + 2 && propertyPattern.test(line)) return index;
  }

  return undefined;
};

const getWorkflowLineIndexForStepProperty = (workflow, step, propertyName, stepStartIndex) => {
  const workflowLines = workflow.split(/\r?\n/);
  const stepLines = step.split(/\r?\n/);
  const propertyLineIndex = getStepPropertyLineIndex(step, propertyName);
  if (propertyLineIndex === undefined) return undefined;
  if (stepStartIndex !== undefined) return stepStartIndex + propertyLineIndex;

  for (let index = 0; index <= workflowLines.length - stepLines.length; index += 1) {
    if (stepLines.every((line, offset) => workflowLines[index + offset] === line)) {
      return index + propertyLineIndex;
    }
  }

  return undefined;
};

const getAnchoredWithInput = (workflow, step, stepStartIndex, anchorName, inputName) => {
  const anchorPattern = new RegExp(
    `^\\s+(?:-\\s+)?with:\\s*&${escapeRegExp(anchorName)}\\s*(.*?)\\s*(?:#.*)?$`,
  );
  const aliasLineIndex = getWorkflowLineIndexForStepProperty(
    workflow,
    step,
    "with",
    stepStartIndex,
  );
  const searchLimit = aliasLineIndex ?? Number.POSITIVE_INFINITY;
  let anchorEntry;

  for (const entry of getYamlStructureEntries(workflow)) {
    if (entry.index >= searchLimit) break;
    if (anchorPattern.test(entry.line)) anchorEntry = entry;
  }

  if (anchorEntry === undefined) return undefined;

  const anchorValue = anchorEntry.line.match(anchorPattern)?.[1]?.trim() ?? "";
  const flowMappingText = getFlowMappingText(anchorValue);
  if (flowMappingText !== undefined) return parseFlowMapping(flowMappingText).get(inputName);

  return getInputFromWithBlock(
    getIndentedBlockRawFromIndex(workflow, anchorEntry.index),
    inputName,
  );
};

const getStepInput = (step, inputName, workflow = "", stepStartIndex) => {
  const flowWith = getStepPropertyValue(step, "with");
  const flowMappingText = flowWith === undefined ? undefined : getFlowMappingText(flowWith);
  if (flowMappingText !== undefined) return parseFlowMapping(flowMappingText).get(inputName);
  if (flowWith?.startsWith("*") === true) {
    return getAnchoredWithInput(workflow, step, stepStartIndex, flowWith.slice(1), inputName);
  }

  return getInputFromWithBlock(getStepPropertyBlockRaw(step, "with"), inputName);
};

const getDockerPlatformBoundary = (platformsValue) => {
  const platforms = platformsValue
    .split(/[,\n]/)
    .map((platform) => platform.trim())
    .filter((platform) => platform.length > 0);
  const hasAmd64 = platforms.includes("linux/amd64");
  const hasArm64 = platforms.includes("linux/arm64");

  if (!hasArm64) {
    return { outcome: "rejected", reason: "arm64 platform is missing" };
  }
  if (!hasAmd64) {
    return { outcome: "rejected", reason: "amd64 platform is missing" };
  }
  if (platforms.length !== 2) {
    return { outcome: "rejected", reason: "extra platform is outside the v0.1 contract" };
  }
  return { outcome: "accepted", reason: "required amd64 and arm64 platforms present" };
};

const getStepPropertyValue = (step, propertyName) => {
  const lines = step.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return undefined;

  const stepIndent = getIndent(firstLine);
  const inlinePattern = new RegExp(`^\\s*-\\s+${propertyName}:\\s*(.*?)\\s*(?:#.*)?$`);
  const propertyPattern = new RegExp(`^\\s*${propertyName}:\\s*(.*?)\\s*(?:#.*)?$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0 && getIndent(line) === stepIndent) {
      const value = line.match(inlinePattern)?.[1]?.trim();
      if (value !== undefined) return stripYamlQuotes(value);
      continue;
    }

    if (getIndent(line) !== stepIndent + 2) continue;
    const value = line.match(propertyPattern)?.[1]?.trim();
    if (value !== undefined) return stripYamlQuotes(value);
  }

  return undefined;
};

const isDockerBuildActionStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${DOCKER_BUILD_ACTION_REPOSITORY}@`) ?? false;

const isTrivyActionStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${TRIVY_ACTION_REPOSITORY}@`) ?? false;

const isCodeqlSarifUploadActionStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${CODEQL_UPLOAD_SARIF_ACTION_REPOSITORY}@`) ??
  false;

const getBuildDockerActionReferences = (workflow) => {
  const stepsBlockEntry = getBuildDockerStepsBlockEntry(workflow);
  if (stepsBlockEntry === undefined) return [];

  return getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex)
    .map((entry) => getStepPropertyValue(entry.block, "uses"))
    .filter((actionReference) => actionReference !== undefined);
};

const getBuildDockerTrivyStepEntries = (workflow) => {
  const stepsBlockEntry = getBuildDockerStepsBlockEntry(workflow);
  if (stepsBlockEntry === undefined) return [];

  return getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex).filter(
    (entry) => isTrivyActionStep(entry.block),
  );
};

const getBuildDockerCodeqlSarifUploadStepEntries = (workflow) => {
  const stepsBlockEntry = getBuildDockerStepsBlockEntry(workflow);
  if (stepsBlockEntry === undefined) return [];

  return getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex).filter(
    (entry) => isCodeqlSarifUploadActionStep(entry.block),
  );
};

const isDockerSetupActionReference = (actionReference) =>
  DOCKER_SETUP_ACTION_REPOSITORIES.some((repository) =>
    actionReference.startsWith(`${repository}@`),
  );

const getDockerSetupActionPinFailure = (actionReference) => {
  const repository = DOCKER_SETUP_ACTION_REPOSITORIES.find((setupRepository) =>
    actionReference.startsWith(`${setupRepository}@`),
  );
  if (repository === undefined) return undefined;

  const ref = actionReference.slice(`${repository}@`.length);
  const boundaryReason = getShaBoundaryReason(actionReference);
  if (/^[0-9a-f]{40}$/.test(ref)) return undefined;
  if (boundaryReason !== undefined) return boundaryReason;
  if (ref.length === FULL_COMMIT_SHA_LENGTH) return "SHA must use lowercase hexadecimal characters";
  return "Docker setup actions must be pinned to a full commit SHA";
};

const getMissingDockerSetupActionRepositories = (actionReferences) =>
  DOCKER_SETUP_ACTION_REPOSITORIES.filter(
    (repository) =>
      !actionReferences.some((actionReference) => actionReference.startsWith(`${repository}@`)),
  );

const runDockerSetupActionPinning = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", dockerSetupActionPinningUsage);
  const workflow = readWorkflowFile(workflowPath);
  const actionReferences = getBuildDockerActionReferences(workflow).filter(
    isDockerSetupActionReference,
  );
  const missingRepositories = getMissingDockerSetupActionRepositories(actionReferences);
  const pinFailures = actionReferences
    .map((actionReference) => ({
      actionReference,
      reason: getDockerSetupActionPinFailure(actionReference),
    }))
    .filter((pinFailure) => pinFailure.reason !== undefined);
  const boundaryReasons = getBoundaryReasons(actionReferences);

  if (missingRepositories.length === 0 && pinFailures.length === 0) {
    writeStdout(
      `docker_setup_action_pinning=pass\npinning_outcome=accepted\n${boundaryReasons.map((reason) => `boundary_reason=${reason}\n`).join("")}`,
    );
    return;
  }

  writeStdout(
    `docker_setup_action_pinning=fail\npinning_outcome=rejected\n${missingRepositories.map((repository) => `missing_action=${repository}\n`).join("")}${pinFailures.map((pinFailure) => `moving_reference=${pinFailure.actionReference}\n`).join("")}${boundaryReasons.map((reason) => `boundary_reason=${reason}\n`).join("")}`,
  );
  fail(
    [
      ...missingRepositories.map((repository) => `build-docker must use ${repository}`),
      ...(pinFailures.length > 0
        ? ["Docker setup actions must be pinned to a full commit SHA"]
        : []),
      ...pinFailures.map((pinFailure) => `${pinFailure.actionReference}: ${pinFailure.reason}`),
    ].join("\n"),
    1,
  );
};

const runDockerBuildAction = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", dockerBuildActionUsage);
  const workflow = readWorkflowFile(workflowPath);
  const stepsBlockEntry = getBuildDockerStepsBlockEntry(workflow);
  const buildSteps =
    stepsBlockEntry === undefined
      ? []
      : getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex).filter(
          (entry) => isDockerBuildActionStep(entry.block),
        );

  if (buildSteps.length === 0) {
    writeStdout("docker_build_action=fail\n");
    fail(`build-docker must use ${DOCKER_BUILD_ACTION_REPOSITORY}`, 1);
  }

  let acceptedBoundaryReason = "";

  for (const buildStep of buildSteps) {
    const push = getStepInput(buildStep.block, "push", workflow, buildStep.startIndex);
    const platforms =
      getStepInput(buildStep.block, "platforms", workflow, buildStep.startIndex) ?? "";
    const cacheFrom = getStepInput(buildStep.block, "cache-from", workflow, buildStep.startIndex);
    const cacheTo = getStepInput(buildStep.block, "cache-to", workflow, buildStep.startIndex);
    const platformBoundary = getDockerPlatformBoundary(platforms);

    if (push !== "false") {
      writeStdout("docker_build_action=fail\n");
      fail("build-docker must use push: false", 1);
    }

    if (platformBoundary.outcome === "rejected") {
      writeStdout(
        `docker_build_action=fail\nplatform_outcome=rejected\nboundary_reason=${platformBoundary.reason}\n`,
      );
      fail(platformBoundary.reason, 1);
    }

    if (cacheFrom !== "type=gha" || cacheTo !== "type=gha,mode=max") {
      writeStdout("docker_build_action=fail\n");
      fail("Docker build must use GitHub Actions cache", 1);
    }

    acceptedBoundaryReason = platformBoundary.reason;
  }

  writeStdout(
    `docker_build_action=pass\nbuild_classification=ci-verification\nplatform_outcome=accepted\nboundary_reason=${acceptedBoundaryReason}\n`,
  );
};

const parseYamlScalarListValue = (value) => {
  const trimmedValue = value.trim();
  if (!trimmedValue.startsWith("[")) {
    return [stripYamlQuotes(trimmedValue)];
  }

  return trimmedValue
    .slice(1)
    .replace(/\]$/, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => stripYamlQuotes(entry));
};

const readYamlNeedsValues = (needsBlock) => {
  const needsLines = needsBlock.split(/\r?\n/);
  const inlineValue = needsLines
    .find((line) => /^[ \t]*needs:/.test(line))
    ?.match(/^[ \t]*needs:[ \t]*(.*?)[ \t]*(?:#.*)?$/)?.[1]
    ?.trim();
  if (inlineValue !== undefined && inlineValue.length > 0) {
    const scalarValue =
      inlineValue.startsWith("[") && !inlineValue.endsWith("]")
        ? [inlineValue, ...needsLines.slice(1).map((line) => line.replace(/[ \t]+#.*$/, "").trim())]
            .join(" ")
            .trim()
        : inlineValue;
    return parseYamlScalarListValue(scalarValue);
  }

  return needsLines
    .map((line) => line.match(/^\s*-\s+(.+?)\s*(?:#.*)?$/)?.[1])
    .filter((value) => value !== undefined)
    .map((value) => stripYamlQuotes(value));
};

const runBuildDockerNeeds = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", buildDockerNeedsUsage);
  const workflow = readWorkflowFile(workflowPath);
  const jobsBlock = getIndentedBlock(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const buildDockerJob = getIndentedBlock(jobsBlock, /^\s+build-docker:\s*(?:#.*)?$/);
  const needsBlock = getIndentedBlock(buildDockerJob, /^\s+needs:\s*(?:.*)?$/);
  if (needsBlock.length === 0) {
    writeStdout("build_docker_needs=fail\nneeds=missing\n");
    fail("build-docker must wait for required gates", 1);
  }

  const needs = new Set(readYamlNeedsValues(needsBlock));
  const missingNeeds = REQUIRED_BUILD_DOCKER_NEEDS.filter((job) => !needs.has(job));

  if (missingNeeds.length === 0) {
    writeStdout("build_docker_needs=pass\n");
    return;
  }

  writeStdout(
    `build_docker_needs=fail\n${missingNeeds.map((job) => `missing_required_job=${job}\n`).join("")}`,
  );
  fail(`build-docker must need ${missingNeeds.join(", ")}`, 1);
};

const readJobState = (options, jobName) => {
  const value = options.get(jobName);
  if (value !== "success" && value !== "failure" && value !== "cancelled" && value !== "skipped") {
    fail(`ERROR: --${jobName} must be "success", "failure", "cancelled", or "skipped".`, 2);
  }
  return value;
};

const runBuildDockerScheduler = (args) => {
  const options = parseOptions(args);
  const upstreamJobs = REQUIRED_BUILD_DOCKER_NEEDS.map((jobName) => [
    jobName,
    readJobState(options, jobName),
  ]);
  const failedJobs = upstreamJobs.filter(([, state]) => state !== "success");

  if (failedJobs.length > 0) {
    writeStdout(
      `build_docker_eligible=false\nbuild_docker_result=skipped\n${failedJobs
        .map(([jobName]) => `failed_upstream_job=${jobName}\n`)
        .join("")}`,
    );
    return;
  }

  writeStdout("build_docker_eligible=true\nbuild_docker_result=eligible\n");
};

const readWorkflowFile = (workflowPath) => {
  try {
    return readFileSync(workflowPath, "utf8");
  } catch {
    fail(`ERROR: Unable to read workflow file: ${workflowPath}.`, 2);
  }
};

const isRegularFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const readRealPath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

const isPathInsideDirectory = (directory, path) => {
  const relativePath = relative(directory, path);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const isRepoRelativeRegularFile = (repoRoot, path) => {
  if (isAbsolute(path)) return false;

  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedPath = resolve(resolvedRepoRoot, path);
  if (!isPathInsideDirectory(resolvedRepoRoot, resolvedPath) || !isRegularFile(resolvedPath)) {
    return false;
  }

  const realRepoRoot = readRealPath(resolvedRepoRoot);
  const realPath = readRealPath(resolvedPath);
  return (
    realRepoRoot !== undefined &&
    realPath !== undefined &&
    isPathInsideDirectory(realRepoRoot, realPath)
  );
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

const getIndentedBlockRaw = (workflow, parentPattern) => {
  const lines = workflow.split(/\r?\n/);
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

const getListItemBlocksFromLines = (lines) => {
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

const getListItemBlocks = (workflow) => getListItemBlocksFromLines(getYamlStructureLines(workflow));

const getTopLevelListItemBlocks = (workflow) => {
  const lines = workflow.split(/\r?\n/);
  const itemIndent = lines.find((line) => /^\s*-\s+/.test(line))?.match(/^ */)?.[0].length;
  if (itemIndent === undefined) return [];

  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (getIndent(lines[index]) !== itemIndent || !/^\s*-\s+/.test(lines[index])) continue;

    const block = [lines[index]];

    for (const line of lines.slice(index + 1)) {
      if (line.trim().length === 0) {
        block.push(line);
        continue;
      }

      const indent = getIndent(line);
      if (indent < itemIndent) break;
      if (indent === itemIndent && /^\s*-\s+/.test(line)) break;
      block.push(line);
    }

    blocks.push(block.join("\n"));
  }

  return blocks;
};

const getTopLevelListItemBlockEntries = (workflow, startIndex) => {
  const lines = workflow.split(/\r?\n/);
  const itemIndent = lines.find((line) => /^\s*-\s+/.test(line))?.match(/^ */)?.[0].length;
  if (itemIndent === undefined) return [];

  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (getIndent(lines[index]) !== itemIndent || !/^\s*-\s+/.test(lines[index])) continue;

    const block = [lines[index]];

    for (const line of lines.slice(index + 1)) {
      if (line.trim().length === 0) {
        block.push(line);
        continue;
      }

      const indent = getIndent(line);
      if (indent < itemIndent) break;
      if (indent === itemIndent && /^\s*-\s+/.test(line)) break;
      block.push(line);
    }

    entries.push({ block: block.join("\n"), startIndex: startIndex + index });
  }

  return entries;
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

const getSecretsScanStepsBlock = (workflow) => {
  const jobsBlock = getIndentedBlock(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const secretsJob = getIndentedBlock(jobsBlock, /^\s+secrets-scan:\s*(?:#.*)?$/);
  return getIndentedBlock(secretsJob, /^\s+steps:\s*(?:#.*)?$/);
};

const getSecretsScanRawStepsBlock = (workflow) => {
  const jobsBlock = getIndentedBlockRaw(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const secretsJob = getIndentedBlockRaw(jobsBlock, /^\s+secrets-scan:\s*(?:#.*)?$/);
  return getIndentedBlockRaw(secretsJob, /^\s+steps:\s*(?:#.*)?$/);
};

const hasSecretFilenameStepName = (step) => {
  const lines = step.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return false;

  const stepIndent = getIndent(firstLine);
  const inlineNamePattern =
    /^\s*-\s+name:\s*["']?Secret filename and API key patterns["']?\s*(?:#.*)?$/;
  const propertyNamePattern =
    /^\s*name:\s*["']?Secret filename and API key patterns["']?\s*(?:#.*)?$/;

  return lines.some((line, index) => {
    if (index === 0 && getIndent(line) === stepIndent) return inlineNamePattern.test(line);
    return getIndent(line) === stepIndent + 2 && propertyNamePattern.test(line);
  });
};

const stripYamlQuotes = (value) => {
  const match = value.match(/^(['"])(.*)\1$/);
  return match?.[2] ?? value;
};

const foldYamlScalarLines = (scalarLines) => {
  const commands = [];
  let foldedLine = [];

  for (const scalarLine of scalarLines) {
    if (scalarLine.length === 0) {
      if (foldedLine.length > 0) {
        commands.push(foldedLine.join(" "));
        foldedLine = [];
      }
      continue;
    }

    foldedLine.push(scalarLine);
  }

  if (foldedLine.length > 0) commands.push(foldedLine.join(" "));
  return commands;
};

const getHereDocumentDelimiter = (command) => {
  const match = command.match(/<<-?\s*(?:"([^"]+)"|'([^']+)'|(\\?\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3]?.replaceAll("\\", "");
};

const joinLineContinuedCommands = (commands) => {
  const joinedCommands = [];
  let continuedCommand = "";

  for (const command of commands) {
    const commandPart =
      continuedCommand.length > 0 ? `${continuedCommand} ${command}`.trim() : command;
    if (/\\\s*$/.test(commandPart)) {
      continuedCommand = commandPart.replace(/\\\s*$/, "").trimEnd();
      continue;
    }

    joinedCommands.push(commandPart);
    continuedCommand = "";
  }

  if (continuedCommand.length > 0) joinedCommands.push(continuedCommand);
  return joinedCommands;
};

const getLiteralScalarCommands = (scalarLines) => {
  const commands = [];
  const hereDocumentDelimiters = [];

  for (const scalarLine of scalarLines) {
    if (scalarLine.length === 0) continue;

    const activeDelimiter = hereDocumentDelimiters.at(-1);
    if (activeDelimiter !== undefined) {
      if (scalarLine === activeDelimiter) hereDocumentDelimiters.pop();
      continue;
    }

    commands.push(scalarLine);
    const delimiter = getHereDocumentDelimiter(scalarLine);
    if (delimiter !== undefined) hereDocumentDelimiters.push(delimiter);
  }

  return joinLineContinuedCommands(commands);
};

const getStepRunValue = (line, index, stepIndent) => {
  if (index === 0 && getIndent(line) === stepIndent) {
    return line.match(/^\s*-\s+run:\s*(.*)$/)?.[1];
  }

  if (getIndent(line) !== stepIndent + 2) return undefined;
  return line.match(/^\s*run:\s*(.*)$/)?.[1];
};

const getRunCommandLines = (step) => {
  const lines = step.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return [];

  const stepIndent = getIndent(firstLine);
  const commands = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const stepRunValue = getStepRunValue(line, index, stepIndent);
    if (stepRunValue === undefined) continue;

    const runValue = stepRunValue.trim();
    const isLiteralScalar = runValue.startsWith("|");
    const isFoldedScalar = runValue.startsWith(">");
    if (!isLiteralScalar && !isFoldedScalar) {
      commands.push(stripYamlQuotes(runValue));
      continue;
    }

    const runIndent = getIndent(line);
    const scalarLines = [];
    let blockEndIndex = index + 1;
    for (; blockEndIndex < lines.length; blockEndIndex += 1) {
      const blockLine = lines[blockEndIndex];
      if (blockLine.trim().length === 0) {
        scalarLines.push("");
        continue;
      }
      if (getIndent(blockLine) <= runIndent) break;
      scalarLines.push(blockLine.trim());
    }

    if (isFoldedScalar) {
      commands.push(...foldYamlScalarLines(scalarLines));
    } else {
      commands.push(...getLiteralScalarCommands(scalarLines));
    }
    index = blockEndIndex - 1;
  }

  return commands;
};

const consumesShellOptionValue = (token) => /[oO]/.test(token.slice(1));

const getShellCommandTokens = (command) => {
  const commandWithoutComment = command.replace(/\s+#.*$/, "").trim();
  return commandWithoutComment.split(/\s+/).filter(Boolean);
};

const isScriptPathToken = (token, scriptPath) => {
  const strippedToken = stripYamlQuotes(token);
  return strippedToken === scriptPath || strippedToken === `./${scriptPath}`;
};

const getSharedScriptTokenIndex = (tokens, scriptPath) => {
  const firstToken = tokens[0];
  if (firstToken === undefined) return undefined;

  if (isScriptPathToken(firstToken, scriptPath)) return 0;
  if (firstToken !== "bash" && firstToken !== "sh") return undefined;

  let scriptIndex = 1;
  while (scriptIndex < tokens.length) {
    const token = tokens[scriptIndex];
    if (token === "-o" || token === "+o") {
      scriptIndex += 2;
      continue;
    }

    if (/^[+-][A-Za-z]+$/.test(token)) {
      scriptIndex += consumesShellOptionValue(token) ? 2 : 1;
      continue;
    }

    break;
  }

  const scriptToken = tokens[scriptIndex];
  if (scriptToken === undefined || !isScriptPathToken(scriptToken, scriptPath)) {
    return undefined;
  }

  return scriptIndex;
};

const isSharedScriptRunCommand = (command, scriptPath) =>
  getSharedScriptTokenIndex(getShellCommandTokens(command), scriptPath) !== undefined;

const masksSharedScriptFailure = (command, scriptPath) => {
  const tokens = getShellCommandTokens(command);
  const scriptIndex = getSharedScriptTokenIndex(tokens, scriptPath);
  if (scriptIndex === undefined) return false;

  const trailingTokens = tokens.slice(scriptIndex + 1);
  const orOperatorIndex = trailingTokens.findIndex(
    (token) => token === "||" || token.startsWith("||"),
  );
  if (orOperatorIndex === -1) return false;

  const orOperatorToken = trailingTokens[orOperatorIndex];
  const inlineFallbackToken =
    orOperatorToken !== undefined && orOperatorToken.startsWith("||")
      ? orOperatorToken.slice(2)
      : "";
  const fallbackTokens = [
    ...(inlineFallbackToken.length > 0 ? [inlineFallbackToken] : []),
    ...trailingTokens.slice(orOperatorIndex + 1),
  ];
  const fallbackCommand = fallbackTokens.join(" ");
  return !/^exit\s+(?:[1-9]\d*|["']?\$\?["']?)$/.test(fallbackCommand);
};

const isContinueOnErrorEnabled = (value) => {
  const normalizedValue = stripYamlQuotes(value.trim());
  return normalizedValue !== "false" && !/^\$\{\{\s*false\s*\}\}$/.test(normalizedValue);
};

const hasStepContinueOnError = (step) => {
  const lines = step.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return false;

  const stepIndent = getIndent(firstLine);
  return lines.some((line) => {
    if (getIndent(line) !== stepIndent + 2) return false;

    const match = line.match(/^\s*continue-on-error:\s*(.*?)\s*(?:#.*)?$/);
    return match?.[1] !== undefined && isContinueOnErrorEnabled(match[1]);
  });
};

const hasRunCommand = (step, scriptPath) =>
  getRunCommandLines(step).some((command) => isSharedScriptRunCommand(command, scriptPath));

const doesStepPropagateSharedScriptFailure = (step, scriptPath) =>
  !hasStepContinueOnError(step) &&
  getRunCommandLines(step)
    .filter((command) => isSharedScriptRunCommand(command, scriptPath))
    .every((command) => !masksSharedScriptFailure(command, scriptPath));

const hasInlineSecretPatternList = (stepsBlock) =>
  /OPENAI_API_KEY|ANTHROPIC_API_KEY|SECRET_PATTERNS|aws_secret_access_key/.test(stepsBlock);

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

const getTrivyArtifactName = (report) => {
  if (typeof report !== "object" || report === null) return undefined;
  return typeof report.ArtifactName === "string" ? report.ArtifactName : undefined;
};

const getTrivyImageReport = (report, imageRef) => {
  if (Array.isArray(report)) {
    return report.find((entry) => getTrivyArtifactName(entry) === imageRef);
  }

  return getTrivyArtifactName(report) === imageRef ? report : undefined;
};

const getTrivyResults = (report) => {
  if (typeof report !== "object" || report === null) {
    fail("ERROR: Trivy result must contain Results.", 2);
  }

  const results = report.Results;
  if (!Array.isArray(results)) {
    fail("ERROR: Trivy result must contain Results.", 2);
  }
  return results;
};

const getTrivyVulnerabilities = (report) =>
  getTrivyResults(report).flatMap((result) => {
    if (typeof result !== "object" || result === null) return [];
    const vulnerabilities = result.Vulnerabilities;
    if (vulnerabilities === undefined || vulnerabilities === null) return [];
    if (!Array.isArray(vulnerabilities)) {
      fail("ERROR: Trivy result Vulnerabilities must be arrays.", 2);
    }
    return vulnerabilities;
  });

const getTrivyVulnerabilitySeverity = (vulnerability) => {
  if (typeof vulnerability !== "object" || vulnerability === null) return "UNKNOWN";
  return typeof vulnerability.Severity === "string"
    ? vulnerability.Severity.toUpperCase()
    : "UNKNOWN";
};

const getTrivyVulnerabilityId = (vulnerability) => {
  if (typeof vulnerability !== "object" || vulnerability === null) return "unknown vulnerability";
  return typeof vulnerability.VulnerabilityID === "string"
    ? vulnerability.VulnerabilityID
    : "unknown vulnerability";
};

const countTrivySeverity = (vulnerabilities, severity) =>
  vulnerabilities.filter(
    (vulnerability) => getTrivyVulnerabilitySeverity(vulnerability) === severity,
  ).length;

const getTrivySeveritySummary = (vulnerabilities) => ({
  low: countTrivySeverity(vulnerabilities, "LOW"),
  medium: countTrivySeverity(vulnerabilities, "MEDIUM"),
  high: countTrivySeverity(vulnerabilities, "HIGH"),
  critical: countTrivySeverity(vulnerabilities, "CRITICAL"),
});

const formatTrivySeveritySummary = (summary) =>
  `low_vulnerabilities=${summary.low}\nmedium_vulnerabilities=${summary.medium}\nhigh_vulnerabilities=${summary.high}\ncritical_vulnerabilities=${summary.critical}\n`;

const getBlockingTrivyVulnerabilities = (vulnerabilities) =>
  vulnerabilities.filter((vulnerability) =>
    TRIVY_BLOCKING_SEVERITIES.has(getTrivyVulnerabilitySeverity(vulnerability)),
  );

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

const runTrivyVulnerabilityGate = (args) => {
  const options = parseOptions(args);
  const inputPath = readRequiredOption(options, "input", trivyVulnerabilityGateUsage);
  const imageRef = readRequiredOption(options, "image", trivyVulnerabilityGateUsage);
  const report = readJsonFile(inputPath, "Trivy result");
  const imageReport = getTrivyImageReport(report, imageRef);

  if (imageReport === undefined) {
    writeStdout(`image_vulnerability=fail\nimage=${imageRef}\n`);
    fail("missing Trivy result for built image", 1);
  }

  const vulnerabilities = getTrivyVulnerabilities(imageReport);
  const summary = getTrivySeveritySummary(vulnerabilities);
  const blockingVulnerabilities = getBlockingTrivyVulnerabilities(vulnerabilities);

  if (blockingVulnerabilities.length === 0) {
    writeStdout(
      `image_vulnerability=pass\nimage=${imageRef}\n${formatTrivySeveritySummary(summary)}`,
    );
    return;
  }

  writeStdout(
    `image_vulnerability=fail\nimage=${imageRef}\n${formatTrivySeveritySummary(summary)}${blockingVulnerabilities
      .map(
        (vulnerability) =>
          `blocking_vulnerability=${getTrivyVulnerabilityId(vulnerability)}\nblocking_severity=${getTrivyVulnerabilitySeverity(vulnerability)}\n`,
      )
      .join("")}`,
  );
  const firstBlockingVulnerability = blockingVulnerabilities[0];
  fail(
    `${getTrivyVulnerabilityId(firstBlockingVulnerability)} ${getTrivyVulnerabilitySeverity(firstBlockingVulnerability)} vulnerability found for built image`,
    1,
  );
};

const getTrivyExitCodeBoundary = (exitCode) => {
  if (exitCode === "0") return { outcome: "rejected", reason: "zero would not fail CI" };
  if (exitCode === TRIVY_REQUIRED_EXIT_CODE) {
    return { outcome: "accepted", reason: "one fails CI on blocking findings" };
  }
  return { outcome: "rejected", reason: "only exit-code one is in scope" };
};

const hasRequiredTrivySeveritySet = (severity) => {
  if (severity === undefined) return false;

  const severitySet = new Set(
    severity
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  return (
    severitySet.size === TRIVY_BLOCKING_SEVERITIES.size &&
    [...TRIVY_BLOCKING_SEVERITIES].every((entry) => severitySet.has(entry))
  );
};

const runTrivyScanConfig = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", trivyScanConfigUsage);
  const workflow = readWorkflowFile(workflowPath);
  const trivySteps = getBuildDockerTrivyStepEntries(workflow);

  if (trivySteps.length === 0) {
    writeStdout("trivy_scan_config=fail\ntrivy_action=missing\n");
    fail(`build-docker must use ${TRIVY_ACTION_REPOSITORY}`, 1);
  }

  for (const trivyStep of trivySteps) {
    const severity = getStepInput(trivyStep.block, "severity", workflow, trivyStep.startIndex);
    const exitCode = getStepInput(trivyStep.block, "exit-code", workflow, trivyStep.startIndex);
    const exitCodeBoundary = getTrivyExitCodeBoundary(exitCode);

    if (!hasRequiredTrivySeveritySet(severity)) {
      writeStdout(`trivy_scan_config=fail\ntrivy_severity=${severity ?? "missing"}\n`);
      fail(`Trivy severity must be ${TRIVY_REQUIRED_SEVERITY}`, 1);
    }

    if (exitCodeBoundary.outcome === "rejected") {
      writeStdout(
        `trivy_scan_config=fail\nexit_code=${exitCode ?? "missing"}\nexit_code_outcome=${exitCodeBoundary.outcome}\nboundary_reason=${exitCodeBoundary.reason}\n`,
      );
      fail("Trivy exit-code must be 1", 1);
    }
  }

  const acceptedBoundary = getTrivyExitCodeBoundary(TRIVY_REQUIRED_EXIT_CODE);
  writeStdout(
    `trivy_scan_config=pass\nblocking_severities=${TRIVY_REQUIRED_SEVERITY}\nexit_code=${TRIVY_REQUIRED_EXIT_CODE}\nexit_code_outcome=${acceptedBoundary.outcome}\nboundary_reason=${acceptedBoundary.reason}\n`,
  );
};

const runTrivyStepCompletion = (args) => {
  const options = parseOptions(args);
  const inputPath = readRequiredOption(options, "input", trivyStepCompletionUsage);
  const imageRef = readRequiredOption(options, "image", trivyStepCompletionUsage);
  const exitCode = readRequiredOption(options, "exit-code", trivyStepCompletionUsage);
  const report = readJsonFile(inputPath, "Trivy result");
  const imageReport = getTrivyImageReport(report, imageRef);

  if (imageReport === undefined) {
    writeStdout(`trivy_step_completion=fail\nimage=${imageRef}\n`);
    fail("missing Trivy result for built image", 1);
  }

  const blockingVulnerabilities = getBlockingTrivyVulnerabilities(
    getTrivyVulnerabilities(imageReport),
  );

  if (blockingVulnerabilities.length === 0) {
    writeStdout(
      `trivy_step_completion=fail\nimage=${imageRef}\ntrivy_step_exit=0\nbuild_docker_result=success\n`,
    );
    fail("Trivy step must report a blocking vulnerability", 1);
  }

  if (exitCode !== TRIVY_REQUIRED_EXIT_CODE) {
    writeStdout(
      `trivy_step_completion=fail\nimage=${imageRef}\ntrivy_step_exit=0\nbuild_docker_result=success\n`,
    );
    fail("Trivy exit-code must be 1", 1);
  }

  writeStdout(
    `trivy_step_completion=pass\nimage=${imageRef}\ntrivy_step_exit=1\nbuild_docker_result=failure\n${blockingVulnerabilities
      .map(
        (vulnerability) =>
          `blocking_vulnerability=${getTrivyVulnerabilityId(vulnerability)}\nblocking_severity=${getTrivyVulnerabilitySeverity(vulnerability)}\n`,
      )
      .join("")}`,
  );
};

const getBlockingTrivyVulnerabilitiesForImage = (report, imageRef) => {
  const imageReport = getTrivyImageReport(report, imageRef);
  if (imageReport === undefined) return undefined;
  return getBlockingTrivyVulnerabilities(getTrivyVulnerabilities(imageReport));
};

const getGitHubConditionExpression = (condition) =>
  condition?.match(/^\$\{\{\s*(.*?)\s*\}\}$/)?.[1]?.trim() ?? condition;

const isAlwaysCondition = (condition) => getGitHubConditionExpression(condition) === "always()";

const getSarifUploadBoundary = (
  trivyFormat,
  trivyOutput,
  sarifFile,
  condition,
  uploadRunsAfterTrivy,
) => {
  if (trivyFormat !== TRIVY_REQUIRED_SARIF_FORMAT) {
    return { outcome: "rejected", reason: "Trivy must emit SARIF" };
  }
  if (trivyOutput !== TRIVY_REQUIRED_SARIF_PATH) {
    return { outcome: "rejected", reason: "Trivy output must be trivy-results.sarif" };
  }
  if (sarifFile !== TRIVY_REQUIRED_SARIF_PATH) {
    return {
      message: "sarif_file must be trivy-results.sarif",
      outcome: "rejected",
      reason: "SARIF upload path must be trivy-results.sarif",
    };
  }
  if (!uploadRunsAfterTrivy) {
    return { outcome: "rejected", reason: "SARIF upload must run after Trivy scan" };
  }
  if (!isAlwaysCondition(condition)) {
    return { outcome: "rejected", reason: "SARIF upload must run after Trivy failure" };
  }
  return { outcome: "accepted", reason: "producer and uploader use the SARIF path" };
};

const getSarifUploadBoundaryForWorkflow = (workflow) => {
  const trivyStep = getBuildDockerTrivyStepEntries(workflow)[0];
  const uploadStep = getBuildDockerCodeqlSarifUploadStepEntries(workflow)[0];

  if (trivyStep === undefined) {
    return {
      marker: "trivy_action=missing",
      outcome: "rejected",
      reason: `build-docker must use ${TRIVY_ACTION_REPOSITORY}`,
    };
  }

  if (uploadStep === undefined) {
    return {
      marker: "sarif_upload_step=missing",
      outcome: "rejected",
      reason: "build-docker must upload Trivy SARIF via CodeQL",
    };
  }

  return getSarifUploadBoundary(
    getStepInput(trivyStep.block, "format", workflow, trivyStep.startIndex),
    getStepInput(trivyStep.block, "output", workflow, trivyStep.startIndex),
    getStepInput(uploadStep.block, "sarif_file", workflow, uploadStep.startIndex),
    getStepPropertyValue(uploadStep.block, "if"),
    uploadStep.startIndex > trivyStep.startIndex,
  );
};

const runTrivySarifUploadConfig = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", trivySarifUploadConfigUsage);
  const workflow = readWorkflowFile(workflowPath);
  const trivyStep = getBuildDockerTrivyStepEntries(workflow)[0];
  const uploadStep = getBuildDockerCodeqlSarifUploadStepEntries(workflow)[0];

  if (trivyStep === undefined) {
    writeStdout("sarif_upload=fail\ntrivy_action=missing\n");
    fail(`build-docker must use ${TRIVY_ACTION_REPOSITORY}`, 1);
  }

  if (uploadStep === undefined) {
    writeStdout("sarif_upload=fail\nsarif_upload_step=missing\n");
    fail("build-docker must upload Trivy SARIF via CodeQL", 1);
  }

  const trivyFormat = getStepInput(trivyStep.block, "format", workflow, trivyStep.startIndex);
  const trivyOutput = getStepInput(trivyStep.block, "output", workflow, trivyStep.startIndex);
  const sarifFile = getStepInput(uploadStep.block, "sarif_file", workflow, uploadStep.startIndex);
  const condition = getStepPropertyValue(uploadStep.block, "if");
  const uploadRunsAfterTrivy = uploadStep.startIndex > trivyStep.startIndex;
  const boundary = getSarifUploadBoundary(
    trivyFormat,
    trivyOutput,
    sarifFile,
    condition,
    uploadRunsAfterTrivy,
  );

  if (boundary.outcome === "rejected") {
    writeStdout(
      `sarif_upload=fail\nsarif_upload_outcome=${boundary.outcome}\nboundary_reason=${boundary.reason}\n`,
    );
    fail(boundary.message ?? boundary.reason, 1);
  }

  writeStdout(
    `sarif_upload=pass\nsarif_upload_outcome=${boundary.outcome}\ntrivy_format=${TRIVY_REQUIRED_SARIF_FORMAT}\ntrivy_output=${TRIVY_REQUIRED_SARIF_PATH}\nsarif_file=${TRIVY_REQUIRED_SARIF_PATH}\ngithub_security=${TRIVY_REQUIRED_SARIF_PATH}\nboundary_reason=${boundary.reason}\n`,
  );
};

const runTrivySarifUploadAfterFailure = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", trivySarifUploadAfterFailureUsage);
  const inputPath = readRequiredOption(options, "input", trivySarifUploadAfterFailureUsage);
  const imageRef = readRequiredOption(options, "image", trivySarifUploadAfterFailureUsage);
  const exitCode = readRequiredOption(options, "exit-code", trivySarifUploadAfterFailureUsage);
  const workflow = readWorkflowFile(workflowPath);
  const report = readJsonFile(inputPath, "Trivy result");
  const blockingVulnerabilities = getBlockingTrivyVulnerabilitiesForImage(report, imageRef);

  if (blockingVulnerabilities === undefined) {
    writeStdout(`sarif_upload_after_failure=fail\nimage=${imageRef}\n`);
    fail("missing Trivy result for built image", 1);
  }

  if (blockingVulnerabilities.length === 0 || exitCode !== TRIVY_REQUIRED_EXIT_CODE) {
    writeStdout(
      `sarif_upload_after_failure=fail\nimage=${imageRef}\ntrivy_step_exit=${exitCode}\n`,
    );
    fail("Trivy step must fail with exit-code 1 on a blocking vulnerability", 1);
  }

  const boundary = getSarifUploadBoundaryForWorkflow(workflow);

  if (boundary.outcome === "rejected") {
    const marker = boundary.marker === undefined ? "" : `${boundary.marker}\n`;
    writeStdout(`sarif_upload_after_failure=fail\n${marker}boundary_reason=${boundary.reason}\n`);
    fail(boundary.message ?? boundary.reason, 1);
  }

  writeStdout(
    `sarif_upload_after_failure=pass\nimage=${imageRef}\ntrivy_step_exit=1\nsarif_upload_step=ran\ngithub_security=${TRIVY_REQUIRED_SARIF_PATH}\n${blockingVulnerabilities
      .map(
        (vulnerability) =>
          `blocking_vulnerability=${getTrivyVulnerabilityId(vulnerability)}\nblocking_severity=${getTrivyVulnerabilitySeverity(vulnerability)}\n`,
      )
      .join("")}`,
  );
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
  const stepsBlock = getSecretsScanStepsBlock(workflow);
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

const runSecretsNoSecretsReuse = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", secretsNoSecretsReuseUsage);
  const scriptPath = readRequiredOption(options, "script-path", secretsNoSecretsReuseUsage);
  const repoRoot = options.get("repo-root") ?? ".";
  const workflow = readWorkflowFile(workflowPath);
  const stepsBlock = getSecretsScanRawStepsBlock(workflow);
  const scriptFileExists = isRepoRelativeRegularFile(repoRoot, scriptPath);
  const namedSecretGuardStep =
    getTopLevelListItemBlocks(stepsBlock).find(hasSecretFilenameStepName);
  const callsSharedScript =
    namedSecretGuardStep !== undefined && hasRunCommand(namedSecretGuardStep, scriptPath);
  const scriptFailurePropagates =
    namedSecretGuardStep !== undefined &&
    callsSharedScript &&
    doesStepPropagateSharedScriptFailure(namedSecretGuardStep, scriptPath);
  const scriptFailurePropagationStatus = callsSharedScript
    ? scriptFailurePropagates
      ? "pass"
      : "fail"
    : "missing";
  const duplicatesPatternsInline = hasInlineSecretPatternList(stepsBlock);

  if (
    callsSharedScript &&
    scriptFileExists &&
    scriptFailurePropagates &&
    !duplicatesPatternsInline
  ) {
    writeStdout(
      `no_secrets_reuse=pass\nshared_script=${scriptPath}\nscript_file=present\ninline_pattern_list=absent\nscript_failure_propagation=pass\n`,
    );
    return;
  }

  writeStdout(
    `no_secrets_reuse=fail\nshared_script=${callsSharedScript ? scriptPath : "missing"}\nscript_file=${scriptFileExists ? "present" : "missing"}\ninline_pattern_list=${duplicatesPatternsInline ? "present" : "absent"}\nscript_failure_propagation=${scriptFailurePropagationStatus}\n`,
  );
  if (!scriptFileExists) {
    fail(`${scriptPath} is required`, 1);
  }
  if (callsSharedScript && !scriptFailurePropagates) {
    fail(`CI must fail when ${scriptPath} fails`, 1);
  }
  fail(`CI must reuse the shared secret guard: secrets-scan must run ${scriptPath}`, 1);
};

const [command, ...args] = argv.slice(2);

if (command === "duration-budget") {
  runDurationBudget(args);
} else if (command === "secrets-duration-budget") {
  runSecretsDurationBudget(args);
} else if (command === "forbidden-jobs-duration-budget") {
  runForbiddenJobsDurationBudget(args);
} else if (command === "build-docker-duration-budget") {
  runBuildDockerDurationBudget(args);
} else if (command === "docker-build-action") {
  runDockerBuildAction(args);
} else if (command === "docker-setup-action-pinning") {
  runDockerSetupActionPinning(args);
} else if (command === "build-docker-needs") {
  runBuildDockerNeeds(args);
} else if (command === "build-docker-scheduler") {
  runBuildDockerScheduler(args);
} else if (command === "action-pinning") {
  runActionPinning(args);
} else if (command === "gitleaks-action-pinning") {
  runGitleaksActionPinning(args);
} else if (command === "audit-gate") {
  runAuditGate(args);
} else if (command === "trivy-vulnerability-gate") {
  runTrivyVulnerabilityGate(args);
} else if (command === "trivy-scan-config") {
  runTrivyScanConfig(args);
} else if (command === "trivy-step-completion") {
  runTrivyStepCompletion(args);
} else if (command === "trivy-sarif-upload-config") {
  runTrivySarifUploadConfig(args);
} else if (command === "trivy-sarif-upload-after-failure") {
  runTrivySarifUploadAfterFailure(args);
} else if (command === "secrets-checkout-depth") {
  runSecretsCheckoutDepth(args);
} else if (command === "secrets-fixture-evidence") {
  runSecretsFixtureEvidence(args);
} else if (command === "secrets-no-secrets-reuse") {
  runSecretsNoSecretsReuse(args);
} else {
  fail(usage, 2);
}
