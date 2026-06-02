#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync, writeFileSync, writeSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { argv, exit } from "node:process";

const writeStdout = (chunk) => writeSync(1, chunk);
const writeStderr = (chunk) => writeSync(2, chunk);

const DURATION_BUDGET_MS = 300000;
const SECRETS_SCAN_DURATION_BUDGET_MS = 60000;
const FORBIDDEN_JOB_DURATION_BUDGET_MS = 30000;
const BUILD_DOCKER_DURATION_BUDGET_MS = 600000;
const CODEQL_DURATION_BUDGET_MS = 480000;
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
const CODEQL_INIT_ACTION_REPOSITORY = "github/codeql-action/init";
const CODEQL_ANALYZE_ACTION_REPOSITORY = "github/codeql-action/analyze";
const DEPENDENCY_REVIEW_ACTION_REPOSITORY = "actions/dependency-review-action";
const TRIVY_REQUIRED_SEVERITY = "HIGH,CRITICAL";
const TRIVY_REQUIRED_EXIT_CODE = "1";
const TRIVY_REQUIRED_SARIF_FORMAT = "sarif";
const TRIVY_REQUIRED_SARIF_PATH = "trivy-results.sarif";
const TRIVY_BLOCKING_SEVERITIES = new Set(["HIGH", "CRITICAL"]);
const CODEQL_JOB_NAME = "codeql";
const DEPENDENCY_REVIEW_JOB_NAME = "review";
const CODEQL_REQUIRED_LANGUAGE = "javascript";
const CODEQL_REQUIRED_CATEGORY = "/language:javascript";
const CODEQL_REQUIRED_CRON = "0 6 * * 1";
const CODEQL_REQUIRED_QUERIES = ["security-extended", "security-and-quality"];
const CODEQL_REQUIRED_PERMISSIONS = new Map([
  ["actions", "read"],
  ["contents", "read"],
  ["security-events", "write"],
]);
const DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES = [
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Python-2.0",
  "Unlicense",
  "BlueOak-1.0.0",
];
const DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES = [
  "AGPL-1.0-only",
  "AGPL-1.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-2.0-only",
  "LGPL-2.0-or-later",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
];
const RELEASE_REQUIRED_JOBS = ["verify-tag", "build-and-push", "sbom", "gh-release"];
const RELEASE_VERSION = "0.3.0";
const RELEASE_IMAGE_REPOSITORY = "ghcr.io/mpiton/sovri/community-bot";
const RELEASE_REQUIRED_IMAGE_TAGS = [
  {
    label: "v0.3.0",
    values: [
      `${RELEASE_IMAGE_REPOSITORY}:v0.3.0`,
      `${RELEASE_IMAGE_REPOSITORY}:\${{ github.ref_name }}`,
      `${RELEASE_IMAGE_REPOSITORY}:\${{ steps.image-tags.outputs.full }}`,
    ],
  },
  {
    label: "v0.3",
    values: [
      `${RELEASE_IMAGE_REPOSITORY}:v0.3`,
      `${RELEASE_IMAGE_REPOSITORY}:\${{ steps.image-tags.outputs.minor }}`,
    ],
  },
  {
    label: "v0",
    values: [
      `${RELEASE_IMAGE_REPOSITORY}:v0`,
      `${RELEASE_IMAGE_REPOSITORY}:\${{ steps.image-tags.outputs.major }}`,
    ],
  },
  {
    label: "latest",
    values: [`${RELEASE_IMAGE_REPOSITORY}:latest`],
  },
];
const REQUIRED_BUILD_DOCKER_NEEDS = [
  "backend-checks",
  "supply-chain",
  "secrets-scan",
  "forbidden-tools",
  "forbidden-imports",
];
const CHANGELOG_REMEDIATION_MESSAGE =
  "CHANGELOG.md must be updated when .ts/.tsx files change; add a changelog entry.";

const durationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs duration-budget --job-start-ms <ms> --job-end-ms <ms> --pnpm-cache hit --turbo-cache hit";
const secretsDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs secrets-duration-budget --job-start-ms <ms> --job-end-ms <ms>";
const forbiddenJobsDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs forbidden-jobs-duration-budget --forbidden-tools-ms <ms|missing|unknown> --forbidden-imports-ms <ms|missing|unknown>";
const buildDockerDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs build-docker-duration-budget --job-start-ms <ms> --job-end-ms <ms> --github-actions-cache <enabled|missing>";
const codeqlDurationBudgetUsage =
  "Usage: node scripts/ci-policy.mjs codeql-duration-budget --job-start-ms <ms> --job-end-ms <ms>";
const codeqlWorkflowConfigUsage =
  "Usage: node scripts/ci-policy.mjs codeql-workflow-config --workflow <path>";
const dependencyReviewWorkflowConfigUsage =
  "Usage: node scripts/ci-policy.mjs dependency-review-workflow-config --workflow <path>";
const dockerBuildActionUsage =
  "Usage: node scripts/ci-policy.mjs docker-build-action --workflow <path>";
const dockerSetupActionPinningUsage =
  "Usage: node scripts/ci-policy.mjs docker-setup-action-pinning --workflow <path>";
const buildDockerNeedsUsage =
  "Usage: node scripts/ci-policy.mjs build-docker-needs --workflow <path>";
const buildDockerSchedulerUsage =
  "Usage: node scripts/ci-policy.mjs build-docker-scheduler --backend-checks <success|failure|cancelled|skipped> --supply-chain <success|failure|cancelled|skipped> --secrets-scan <success|failure|cancelled|skipped> --forbidden-tools <success|failure|cancelled|skipped> --forbidden-imports <success|failure|cancelled|skipped>";
const releasePipelineResultUsage =
  "Usage: node scripts/ci-policy.mjs release-pipeline-result --verify-tag <success|failure|cancelled|skipped> --build-and-push <success|failure|cancelled|skipped> --sbom <success|failure|cancelled|skipped> --gh-release <success|failure|cancelled|skipped> [--existing-release true] [--existing-tags true]";
const releaseTriggerUsage = "Usage: node scripts/ci-policy.mjs release-trigger --workflow <path>";
const releaseVerifyTagUsage =
  "Usage: node scripts/ci-policy.mjs release-verify-tag --tag <vX.Y.Z> --package-files <comma-separated-package-json-paths> --changelog <path>";
const releaseBuildAndPushUsage =
  "Usage: node scripts/ci-policy.mjs release-build-and-push --workflow <path>";
const releaseExtractNotesUsage =
  "Usage: node scripts/ci-policy.mjs release-extract-notes --changelog <path> --version <X.Y.Z> [--max-bytes <n>] [--repo-url <url>]";
const releaseVerifyTagAnnotationUsage =
  "Usage: node scripts/ci-policy.mjs release-verify-tag-annotation --tag <vX.Y.Z> --repo <path>";
const releaseVerifyCommitSubjectUsage =
  "Usage: node scripts/ci-policy.mjs release-verify-commit-subject --tag <vX.Y.Z> --repo <path>";
const readmeReferencesReleaseUsage =
  "Usage: node scripts/ci-policy.mjs readme-references-release --readme <path> --image <repository> --version <X.Y.Z>";
const promoteChangelogUsage =
  "Usage: node scripts/ci-policy.mjs promote-changelog --version <X.Y.Z> --date <YYYY-MM-DD> --changelog <path>";
const cosignDeferralUsage =
  "Usage: node scripts/ci-policy.mjs cosign-deferral --workflow <path> --changelog <path>";
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
const changelogTriggerUsage =
  "Usage: node scripts/ci-policy.mjs changelog-trigger --workflow <path>";
const changelogDiffUsage =
  "Usage: node scripts/ci-policy.mjs changelog-diff --changed-files <comma-separated-paths> [--base <commit|ref>] [--head <commit|ref>]";
const changelogCiOnlyAssertUsage =
  "Usage: node scripts/ci-policy.mjs changelog-ci-only-assert --changed-files <comma-separated-paths> --gate-result <success|failure>";
const changelogRemediationMessageUsage =
  "Usage: node scripts/ci-policy.mjs changelog-remediation-message --message <text>";
const changelogDocumentationOnlyAssertUsage =
  "Usage: node scripts/ci-policy.mjs changelog-documentation-only-assert --changed-files <comma-separated-paths> --gate-result <success|failure>";
const coverageGateUsage =
  "Usage: node scripts/ci-policy.mjs coverage-gate --input <coverage-summary.json> --package <package-path> --branches <threshold>";
const llmProvidersCoverageWorkflowUsage =
  "Usage: node scripts/ci-policy.mjs llm-providers-coverage-workflow --workflow <path>";
const packageCoverageWorkflowUsage =
  "Usage: node scripts/ci-policy.mjs package-coverage-workflow --workflow <path> --package <package-path> --branches <min>";
const coverageArtifactPolicyUsage =
  "Usage: node scripts/ci-policy.mjs coverage-artifact-policy --workflow <path>";
const usage = `${durationBudgetUsage}\n${secretsDurationBudgetUsage}\n${forbiddenJobsDurationBudgetUsage}\n${buildDockerDurationBudgetUsage}\n${codeqlDurationBudgetUsage}\n${codeqlWorkflowConfigUsage}\n${dependencyReviewWorkflowConfigUsage}\n${dockerBuildActionUsage}\n${dockerSetupActionPinningUsage}\n${buildDockerNeedsUsage}\n${buildDockerSchedulerUsage}\n${releasePipelineResultUsage}\n${releaseTriggerUsage}\n${releaseVerifyTagUsage}\n${releaseBuildAndPushUsage}\n${releaseExtractNotesUsage}\n${releaseVerifyTagAnnotationUsage}\n${releaseVerifyCommitSubjectUsage}\n${readmeReferencesReleaseUsage}\n${promoteChangelogUsage}\n${cosignDeferralUsage}\n${actionPinningUsage}\n${gitleaksActionPinningUsage}\n${auditGateUsage}\n${trivyVulnerabilityGateUsage}\n${trivyScanConfigUsage}\n${trivyStepCompletionUsage}\n${trivySarifUploadConfigUsage}\n${trivySarifUploadAfterFailureUsage}\n${secretsCheckoutDepthUsage}\n${secretsFixtureEvidenceUsage}\n${secretsNoSecretsReuseUsage}\n${changelogTriggerUsage}\n${changelogDiffUsage}\n${changelogCiOnlyAssertUsage}\n${changelogRemediationMessageUsage}\n${changelogDocumentationOnlyAssertUsage}\n${coverageGateUsage}\n${llmProvidersCoverageWorkflowUsage}\n${packageCoverageWorkflowUsage}\n${coverageArtifactPolicyUsage}`;

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

const readPercentageOption = (options, key, commandUsage) => {
  const value = readRequiredOption(options, key, commandUsage);
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    fail(`ERROR: --${key} must be a number in [0, 100].`, 2);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    fail(`ERROR: --${key} must be a number in [0, 100].`, 2);
  }
  return parsed;
};

const validateWorkspaceRelativePackage = (packagePath, commandUsage) => {
  if (
    packagePath.length === 0 ||
    packagePath.startsWith("/") ||
    packagePath.startsWith("-") ||
    packagePath.includes("..")
  ) {
    fail(
      `ERROR: --package must be a relative workspace path, got "${packagePath}".\n${commandUsage}`,
      2,
    );
  }
};

const coverageSummaryEntriesForPackage = (summary, packagePath) => {
  const segment = `/${packagePath}/`;
  const relativePrefix = `${packagePath}/`;
  return Object.entries(summary).filter(([key]) => {
    if (key === "total") return false;
    return key.includes(segment) || key.startsWith(relativePrefix);
  });
};

const aggregateCoverageMetric = (entries, metric) => {
  let total = 0;
  let covered = 0;
  let skipped = 0;
  for (const [, entry] of entries) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const slot = entry[metric];
    if (slot === null || typeof slot !== "object" || Array.isArray(slot)) continue;
    const currentTotal = Number(slot.total);
    const currentCovered = Number(slot.covered);
    const currentSkipped = Number(slot.skipped);
    if (Number.isFinite(currentTotal)) total += currentTotal;
    if (Number.isFinite(currentCovered)) covered += currentCovered;
    if (Number.isFinite(currentSkipped)) skipped += currentSkipped;
  }
  const denom = total - skipped;
  const pct = denom > 0 ? (covered / denom) * 100 : 100;
  return { covered, denom, pct, skipped, total };
};

const runCoverageGate = (args) => {
  const options = parseOptions(args);
  const inputPath = readRequiredOption(options, "input", coverageGateUsage);
  const packagePath = readRequiredOption(options, "package", coverageGateUsage);
  const branchThreshold = readPercentageOption(options, "branches", coverageGateUsage);
  validateWorkspaceRelativePackage(packagePath, coverageGateUsage);

  const summary = readJsonFile(inputPath, "coverage summary");
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
    fail("ERROR: coverage summary must be a JSON object keyed by file path.", 2);
  }

  const entries = coverageSummaryEntriesForPackage(summary, packagePath);
  if (entries.length === 0) {
    fail(`ERROR: no coverage entries match package "${packagePath}".`, 2);
  }

  const branches = aggregateCoverageMetric(entries, "branches");
  const thresholdText = branchThreshold.toFixed(2);
  const branchText = branches.pct.toFixed(2);
  const comparator =
    branches.denom > 0 && branches.covered * 100 < branchThreshold * branches.denom ? "<" : ">=";
  const status = comparator === "<" ? "fail" : "pass";
  const statusLine = `${packagePath} branches ${branchText} ${comparator} ${thresholdText}`;

  writeStdout(`coverage_gate=${status}\n${statusLine}\n`);
  if (status === "fail") {
    fail(statusLine, 1);
  }
};

const readCoverageWorkflowThreshold = (workflow) => {
  const match = workflow.match(
    /node\s+scripts\/check-coverage\.mjs\s+coverage\/coverage-summary\.json\s+packages\/llm-providers\s+(\d+(?:\.\d+)?)/u,
  );
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

const isCorepackEnableStep = (step) =>
  /^\s*run:\s*corepack\s+enable(?:\s+pnpm)?\s*$/mu.test(step.block);

const workflowBootstrapsPnpmBeforeSetupNodeCache = (workflow) => {
  const steps = getBackendChecksStepEntries(workflow);
  const setupNodeIndex = steps.findIndex(
    (step) =>
      /^\s*(?:-\s*)?uses:\s*actions\/setup-node@[^\s#]+/mu.test(step.block) &&
      getStepInput(step.block, "cache", workflow, step.startIndex) === "pnpm",
  );

  if (setupNodeIndex === -1) {
    return true;
  }

  return steps.slice(0, setupNodeIndex).some(isCorepackEnableStep);
};

const stepRunsCommand = (step, commandPattern) => {
  const command = getStepPropertyValue(step.block, "run");
  return command !== undefined && commandPattern.test(command);
};

const workflowBuildsBeforeTypecheck = (workflow) => {
  const steps = getBackendChecksStepEntries(workflow);
  const buildIndex = steps.findIndex((step) => stepRunsCommand(step, /^pnpm\s+turbo\s+build$/u));
  const typecheckIndex = steps.findIndex((step) =>
    stepRunsCommand(step, /^pnpm\s+exec\s+tsc\s+-b$/u),
  );

  return typecheckIndex === -1 || (buildIndex !== -1 && buildIndex < typecheckIndex);
};

const runLlmProvidersCoverageWorkflow = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", llmProvidersCoverageWorkflowUsage);
  const workflow = readWorkflowFile(workflowPath);
  const threshold = readCoverageWorkflowThreshold(workflow);

  if (!/pnpm\s+exec\s+vitest\s+run\s+--coverage/u.test(workflow)) {
    writeStdout("llm_providers_threshold=fail\ncoverage_run=missing\n");
    fail("workflow must run Vitest with coverage before evaluating package gates", 1);
  }

  if (threshold === undefined) {
    writeStdout("llm_providers_threshold=fail\ncoverage_gate=missing\n");
    fail("workflow must run the packages/llm-providers coverage gate", 1);
  }

  if (threshold < 85) {
    writeStdout(
      `llm_providers_threshold=fail\nthreshold=${threshold}\nfix missing llm-providers tests instead of lowering branch coverage\n`,
    );
    fail("fix missing llm-providers tests instead of lowering branch coverage", 1);
  }

  if (!workflowBootstrapsPnpmBeforeSetupNodeCache(workflow)) {
    writeStdout("llm_providers_threshold=fail\npnpm_cache_bootstrap=missing\n");
    fail("setup-node pnpm cache requires corepack enable before setup-node", 1);
  }

  if (!workflowBuildsBeforeTypecheck(workflow)) {
    writeStdout("llm_providers_threshold=fail\nbuild_before_typecheck=missing\n");
    fail("workspace packages must be built before tsc -b on clean runners", 1);
  }

  writeStdout(
    `llm_providers_threshold=pass\nthreshold=${threshold}\npnpm_cache_bootstrap=pass\nbuild_before_typecheck=pass\n`,
  );
};

// Status key for a package coverage workflow result, derived from the package's
// directory name: `packages/compliance` -> `compliance_threshold`,
// `packages/review-engine` -> `review_engine_threshold`. Mirrors the existing
// `llm_providers_threshold` token so each package gate has a stable stdout marker.
const coverageWorkflowStatusKey = (packagePath) =>
  `${packagePath.slice(packagePath.lastIndexOf("/") + 1).replace(/-/gu, "_")}_threshold`;

// Branch threshold a single backend-checks step wires for `packagePath`'s coverage
// gate, e.g. `node scripts/check-coverage.mjs coverage/coverage-summary.json
// packages/compliance 90`. Returns undefined when the step's `run` is not that gate
// invocation. Reading the threshold off the step (not the whole YAML) is what stops a
// decoy occurrence in another job, a comment, or a multiline shell from satisfying it.
const stepCoverageGateThreshold = (step, packagePath) => {
  const command = getStepPropertyValue(step.block, "run");
  if (command === undefined) return undefined;
  // Anchor to the whole trimmed `run` value: the gate must BE the executed command, not a
  // substring. This rejects an echoed copy (`echo "node …check-coverage… 90"`) and a
  // failure-suppressed call (`node …check-coverage… 90 || true`), both of which would
  // otherwise report pass while no real gate runs.
  const match = command
    .trim()
    .match(
      new RegExp(
        `^node\\s+scripts/check-coverage\\.mjs\\s+coverage/coverage-summary\\.json\\s+${escapeRegExp(packagePath)}\\s+(\\d+(?:\\.\\d+)?)$`,
        "u",
      ),
    );
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

// True when a backend-checks step's `run` is the Vitest coverage command itself. Trailing
// flag tokens such as `--reporter=verbose` are allowed, but no shell operator (`|`, `&`,
// `;`) may follow: that rules out both an echoed copy (`echo "pnpm … --coverage"`) and a
// failure-suppressed run (`pnpm … --coverage || true`), either of which would otherwise let
// the policy treat a non-enforcing step as the coverage run that produces the summary.
const stepRunsCoverage = (step) => {
  const command = getStepPropertyValue(step.block, "run");
  return (
    command !== undefined &&
    /^pnpm\s+exec\s+vitest\s+run\s+--coverage(?:\s+[^\s|&;]+)*$/u.test(command.trim())
  );
};

// Generic per-package coverage workflow gate. Asserts the backend-checks job runs
// Vitest with coverage and wires `<package>` at a branch threshold of at least
// `--branches`. Generalises `runLlmProvidersCoverageWorkflow` to any workspace
// package so v0.3 additions (compliance, review-engine) are protected identically.
const runPackageCoverageWorkflow = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", packageCoverageWorkflowUsage);
  const packagePath = readRequiredOption(options, "package", packageCoverageWorkflowUsage);
  const minThreshold = readPercentageOption(options, "branches", packageCoverageWorkflowUsage);
  validateWorkspaceRelativePackage(packagePath, packageCoverageWorkflowUsage);

  const workflow = readWorkflowFile(workflowPath);
  const key = coverageWorkflowStatusKey(packagePath);
  // Validate against the backend-checks step list, not the whole YAML: a gate command
  // echoed from another job or buried in a comment must NOT satisfy the policy.
  const steps = getBackendChecksStepEntries(workflow);

  const coverageRunIndex = steps.findIndex(stepRunsCoverage);
  if (coverageRunIndex === -1) {
    writeStdout(`${key}=fail\ncoverage_run=missing\n`);
    fail("backend-checks must run Vitest with coverage before evaluating package gates", 1);
  }

  const gateIndex = steps.findIndex(
    (step) => stepCoverageGateThreshold(step, packagePath) !== undefined,
  );
  if (gateIndex === -1) {
    writeStdout(`${key}=fail\ncoverage_gate=missing\n`);
    fail(`backend-checks must run the ${packagePath} coverage gate`, 1);
  }

  if (gateIndex < coverageRunIndex) {
    writeStdout(`${key}=fail\ngate_before_coverage_run\n`);
    fail(`${packagePath} coverage gate must run after the Vitest coverage step`, 1);
  }

  const threshold = stepCoverageGateThreshold(steps[gateIndex], packagePath);
  if (threshold < minThreshold) {
    writeStdout(`${key}=fail\n${packagePath} threshold ${threshold} < ${minThreshold}\n`);
    fail(`${packagePath} threshold ${threshold} < ${minThreshold}`, 1);
  }

  writeStdout(`${key}=pass\nthreshold=${threshold}\n`);
};

const getBackendChecksStepEntries = (workflow) => {
  const stepsBlockEntry = getJobStepsBlockEntry(workflow, "backend-checks");
  if (stepsBlockEntry === undefined) return [];
  return getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex);
};

const getCoverageUploadStep = (workflow) =>
  getBackendChecksStepEntries(workflow).find((step) =>
    /^\s*(?:-\s*)?uses:\s*actions\/upload-artifact@[^\s#]+/mu.test(step.block),
  );

const runCoverageArtifactPolicy = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", coverageArtifactPolicyUsage);
  const workflow = readWorkflowFile(workflowPath);
  const uploadStep = getCoverageUploadStep(workflow);

  if (uploadStep === undefined) {
    writeStdout("coverage_artifact_retention=fail\ncoverage_artifact=missing\n");
    fail("backend-checks must upload the TypeScript coverage artifact", 1);
  }

  const actionReference = extractActionReferences(uploadStep.block)[0];
  const name = getStepInput(uploadStep.block, "name", workflow, uploadStep.startIndex);
  const path = getStepInput(uploadStep.block, "path", workflow, uploadStep.startIndex);
  const retentionDaysRaw = getStepInput(
    uploadStep.block,
    "retention-days",
    workflow,
    uploadStep.startIndex,
  );
  const condition = getStepPropertyValue(uploadStep.block, "if");
  const retentionDays = Number(retentionDaysRaw);

  if (actionReference === undefined || !PINNED_EXTERNAL_ACTION_PATTERN.test(actionReference)) {
    writeStdout("coverage_artifact_retention=fail\nupload_artifact_pin=missing\n");
    fail("coverage artifact upload action must be pinned to a full commit SHA", 1);
  }

  if (name !== "ts-coverage" || path !== "coverage/") {
    writeStdout(`coverage_artifact_retention=fail\nartifact_name=${name}\nartifact_path=${path}\n`);
    fail('coverage artifact must be named "ts-coverage" and upload "coverage/"', 1);
  }

  if (condition === undefined || !isAlwaysCondition(condition)) {
    writeStdout("coverage_artifact_retention=fail\ncoverage artifact upload must use always()\n");
    fail("coverage artifact upload must use always()", 1);
  }

  if (!Number.isFinite(retentionDays) || retentionDays < 90) {
    writeStdout(
      `coverage_artifact_retention=fail\ncoverage artifact retention < 90\nretention_days=${retentionDaysRaw}\n`,
    );
    fail("coverage artifact retention < 90", 1);
  }

  writeStdout(
    `coverage_artifact_retention=pass\nartifact_name=ts-coverage\nretention_days=${retentionDays}\nupload_condition=always()\n`,
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

const runCodeqlDurationBudget = (args) => {
  const options = parseOptions(args);
  const startMs = readInteger(options, "job-start-ms");
  const endMs = readInteger(options, "job-end-ms");
  const elapsedMs = endMs - startMs;

  if (elapsedMs < 0) {
    fail("ERROR: --job-end-ms must be greater than or equal to --job-start-ms.", 2);
  }

  if (elapsedMs < CODEQL_DURATION_BUDGET_MS) {
    writeStdout(
      `measured_duration_ms=${elapsedMs}\ncodeql_duration_budget=pass\nreported_duration=${formatDuration(elapsedMs)}\n`,
    );
    return;
  }

  writeStdout(
    `measured_duration_ms=${elapsedMs}\ncodeql_duration_budget=fail\nreported_duration=${formatDuration(elapsedMs)}\n`,
  );
  fail("CodeQL must finish in under 8 minutes", 1);
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

const getJobBlockEntry = (workflow, jobName) => {
  const jobsPattern = /^\s*jobs:\s*(?:#.*)?$/;
  const entries = getYamlStructureEntries(workflow);
  const jobsEntry = findRootEntry(entries, jobsPattern);
  if (jobsEntry === undefined) return undefined;

  return findDirectChildEntry(
    entries,
    jobsEntry,
    new RegExp(`^\\s+${escapeRegExp(jobName)}:\\s*(?:&[^\\s#]+)?\\s*(?:#.*)?$`),
  );
};

const getJobStepsBlockEntry = (workflow, jobName) => {
  const jobEntry = getJobBlockEntry(workflow, jobName);
  if (jobEntry === undefined) return undefined;

  const entries = getYamlStructureEntries(workflow);
  const stepsEntry = findDirectChildEntry(entries, jobEntry, /^\s+steps:\s*(?:#.*)?$/);
  if (stepsEntry === undefined) return undefined;

  return {
    block: getIndentedBlockRawFromIndex(workflow, stepsEntry.index),
    startIndex: stepsEntry.index,
  };
};

const getBuildDockerStepsBlockEntry = (workflow) => getJobStepsBlockEntry(workflow, "build-docker");

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

const readWorkflowEventNames = (workflow) => {
  const onLine = getYamlStructureLines(workflow).find((line) => /^\s*on:\s*/.test(line));
  const inlineValue = onLine?.match(/^\s*on:\s*(.*?)\s*(?:#.*)?$/)?.[1]?.trim();
  if (inlineValue !== undefined && inlineValue.length > 0) {
    return parseYamlScalarListValue(inlineValue);
  }

  const eventBlock = getIndentedBlock(workflow, /^\s*on:\s*(?:#.*)?$/);
  return eventBlock
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.match(/^\s*([A-Za-z0-9_-]+):\s*(?:#.*)?$/)?.[1])
    .filter((eventName) => eventName !== undefined);
};

const stripGitHubExpression = (condition) =>
  condition
    .replace(/^\$\{\{\s*/, "")
    .replace(/\s*\}\}$/, "")
    .trim();

const isPullRequestEventCondition = (condition) =>
  /^github\.event_name\s*==\s*['"]pull_request['"]$/.test(stripGitHubExpression(condition));

const readChangedFiles = (options) => {
  const value = readRequiredOption(options, "changed-files", changelogDiffUsage);
  if (value === "(empty)") return [];
  return value
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
};

const isTypescriptCodePath = (path) => path.endsWith(".ts") || path.endsWith(".tsx");

const classifyChangelogPath = (path) =>
  isTypescriptCodePath(path) ? "typescript-code" : "non-code-for-changelog";

const formatChangelogClassifications = (changedFiles) =>
  changedFiles.map((path) => `classification=${path}:${classifyChangelogPath(path)}\n`).join("");

const buildChangelogRemediationMessage = (changedFiles) => {
  const examplePath = changedFiles.find((path) => isTypescriptCodePath(path));
  if (examplePath === undefined) return CHANGELOG_REMEDIATION_MESSAGE;
  return `${CHANGELOG_REMEDIATION_MESSAGE} Example changed file: ${examplePath}`;
};

const isCiOnlyChangelogPath = (path) =>
  path.startsWith(".github/workflows/") ||
  path === ".github/dependabot.yml" ||
  path === "scripts/no-secrets.sh";

const isDocumentationOnlyChangelogPath = (path) =>
  path !== "CHANGELOG.md" && !isTypescriptCodePath(path);

const readGateResult = (options) => {
  const value = readRequiredOption(options, "gate-result", changelogCiOnlyAssertUsage);
  if (value !== "success" && value !== "failure") {
    fail('ERROR: --gate-result must be "success" or "failure".', 2);
  }
  return value;
};

const runChangelogDiff = (args) => {
  const options = parseOptions(args);
  const changedFiles = readChangedFiles(options);
  const diffScope = options.has("base") && options.has("head") ? "diff_scope=base..head\n" : "";
  const hasTypescriptCode = changedFiles.some((path) => isTypescriptCodePath(path));
  const hasRootChangelog = changedFiles.includes("CHANGELOG.md");
  const classifications = formatChangelogClassifications(changedFiles);
  const changedFileSet =
    hasTypescriptCode && !hasRootChangelog ? "requires-changelog" : "no-changelog-required";

  if (!hasTypescriptCode || hasRootChangelog) {
    writeStdout(
      `${diffScope}${classifications}changed_file_set=${changedFileSet}\nhas_typescript_code=${hasTypescriptCode}\nhas_root_changelog=${hasRootChangelog}\nchangelog_gate=pass\ngate_result=success\n`,
    );
    return;
  }

  writeStdout(
    `${diffScope}${classifications}changed_file_set=${changedFileSet}\nhas_typescript_code=${hasTypescriptCode}\nhas_root_changelog=${hasRootChangelog}\nchangelog_gate=fail\ngate_result=failure\n`,
  );
  fail(buildChangelogRemediationMessage(changedFiles), 1);
};

const runChangelogCiOnlyAssert = (args) => {
  const options = parseOptions(args);
  const changedFiles = readChangedFiles(options);
  const gateResult = readGateResult(options);
  const isCiOnly =
    changedFiles.length > 0 && changedFiles.every((path) => isCiOnlyChangelogPath(path));

  if (isCiOnly && gateResult === "failure") {
    writeStdout("r02_assertion=fail\n");
    fail("CI-only PR must not require CHANGELOG.md", 1);
  }

  writeStdout("r02_assertion=pass\n");
};

const runChangelogDocumentationOnlyAssert = (args) => {
  const options = parseOptions(args);
  const changedFiles = readChangedFiles(options);
  const gateResult = readGateResult(options);
  const isDocumentationOnly =
    changedFiles.length > 0 && changedFiles.every((path) => isDocumentationOnlyChangelogPath(path));

  if (isDocumentationOnly && gateResult === "failure") {
    writeStdout("r01_assertion=fail\n");
    fail("documentation-only PR must not require CHANGELOG.md", 1);
  }

  writeStdout("r01_assertion=pass\n");
};

const runChangelogRemediationMessage = (args) => {
  const options = parseOptions(args);
  const message = readRequiredOption(options, "message", changelogRemediationMessageUsage);
  const failures = [];

  if (!message.includes("CHANGELOG.md")) failures.push("message must name CHANGELOG.md");
  if (!message.includes("add a changelog entry")) {
    failures.push("message must explain the remediation");
  }

  if (failures.length === 0) {
    writeStdout("remediation_message=pass\n");
    return;
  }

  writeStdout("remediation_message=fail\n");
  fail(failures.join("\n"), 1);
};

const runBuildDockerNeeds = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", buildDockerNeedsUsage);
  const workflow = readWorkflowFile(workflowPath);
  const jobsBlock = getIndentedBlock(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const buildDockerJob = getIndentedBlock(
    jobsBlock,
    /^\s+build-docker:\s*(?:&[^\s#]+)?\s*(?:#.*)?$/,
  );
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

const readBooleanFlag = (options, key) => {
  const value = options.get(key);
  if (value === undefined) return false;
  if (value !== "true" && value !== "false") {
    fail(`ERROR: --${key} must be "true" or "false".`, 2);
  }
  return value === "true";
};

const runReleasePipelineResult = (args) => {
  const options = parseOptions(args);
  const jobStates = RELEASE_REQUIRED_JOBS.map((jobName) => [
    jobName,
    readJobState(options, jobName),
  ]);
  const failedJobs = jobStates.filter(([, state]) => state !== "success");

  if (failedJobs.length > 0) {
    writeStdout(
      `release_pipeline_result=failed\n${failedJobs
        .map(([jobName, state]) => `failed_job=${jobName}\njob_state=${state}\n`)
        .join("")}`,
    );
    fail(failedJobs.map(([jobName]) => jobName).join("\n"), 1);
  }

  const existingRelease = readBooleanFlag(options, "existing-release");
  const existingTags = readBooleanFlag(options, "existing-tags");
  if (existingRelease && existingTags) {
    writeStdout("release_pipeline_result=green\nrelease_update=existing-release-updated\n");
    return;
  }

  writeStdout("release_pipeline_result=green\n");
};

const readWorkflowPushTagPatterns = (workflow) => {
  const entries = getYamlStructureEntries(workflow);
  const onEntry = findRootEntry(entries, /^\s*on:\s*(?:#.*)?$/);
  if (onEntry === undefined) return [];

  const pushEntry = findDirectChildEntry(entries, onEntry, /^\s+push:\s*(?:#.*)?$/);
  if (pushEntry === undefined) return [];

  const tagsEntry = findDirectChildEntry(entries, pushEntry, /^\s+tags:\s*(?:.*)?$/);
  if (tagsEntry === undefined) return [];

  const inlineValue = tagsEntry.line.match(/^\s*tags:\s*(.*?)\s*(?:#.*)?$/)?.[1]?.trim();
  if (inlineValue !== undefined && inlineValue.length > 0) {
    return parseYamlScalarListValue(inlineValue);
  }

  return getIndentedBlockRawFromIndex(workflow, tagsEntry.index)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*(?:#.*)?$/)?.[1])
    .filter((pattern) => pattern !== undefined)
    .map((pattern) => stripYamlQuotes(pattern));
};

const readWorkflowRootEventNames = (workflow) => {
  const onLine = getYamlStructureLines(workflow).find((line) => /^\s*on:\s*/.test(line));
  const inlineValue = onLine?.match(/^\s*on:\s*(.*?)\s*(?:#.*)?$/)?.[1]?.trim();
  if (inlineValue !== undefined && inlineValue.length > 0) {
    return parseYamlScalarListValue(inlineValue);
  }

  const entries = getYamlStructureEntries(workflow);
  const onEntry = findRootEntry(entries, /^\s*on:\s*(?:#.*)?$/);
  if (onEntry === undefined) return [];

  const onIndent = getIndent(onEntry.line);
  let eventIndent;
  const events = [];

  for (const entry of entries.filter((candidate) => candidate.index > onEntry.index)) {
    const trimmedLine = entry.line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) continue;

    const indent = getIndent(entry.line);
    if (indent <= onIndent) break;

    eventIndent ??= indent;
    if (indent !== eventIndent) continue;

    const eventName = entry.line.match(/^\s*([A-Za-z0-9_-]+):\s*(?:.*)?$/)?.[1];
    if (eventName !== undefined) events.push(eventName);
  }

  return events;
};

const getRootEntry = (workflow, rootPattern) =>
  findRootEntry(getYamlStructureEntries(workflow), rootPattern);

const readYamlListEntryValues = (workflow, entry) => {
  const inlineValue = entry.line.match(/^\s*[A-Za-z0-9_-]+:\s*(.*?)\s*(?:#.*)?$/)?.[1]?.trim();
  if (inlineValue !== undefined && inlineValue.length > 0) {
    return parseYamlScalarListValue(inlineValue);
  }

  return getIndentedBlockRawFromIndex(workflow, entry.index)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*(?:#.*)?$/)?.[1])
    .filter((value) => value !== undefined)
    .map((value) => stripYamlQuotes(value));
};

const readDirectChildScalarMap = (workflow, parentEntry) => {
  const entries = getYamlStructureEntries(workflow);
  const parentIndent = getIndent(parentEntry.line);
  const values = new Map();
  let childIndent;

  for (const entry of entries.filter((candidate) => candidate.index > parentEntry.index)) {
    const trimmedLine = entry.line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) continue;

    const indent = getIndent(entry.line);
    if (indent <= parentIndent) break;

    childIndent ??= indent;
    if (indent !== childIndent) continue;

    const match = entry.line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*(?:#.*)?$/);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values.set(match[1], stripYamlQuotes(match[2].trim()));
    }
  }

  return values;
};

const readCodeqlPushBranches = (workflow) => {
  const entries = getYamlStructureEntries(workflow);
  const onEntry = findRootEntry(entries, /^\s*on:\s*(?:#.*)?$/);
  if (onEntry === undefined) return [];

  const pushEntry = findDirectChildEntry(entries, onEntry, /^\s+push:\s*(?:#.*)?$/);
  if (pushEntry === undefined) return [];

  const branchesEntry = findDirectChildEntry(entries, pushEntry, /^\s+branches:\s*(?:.*)?$/);
  if (branchesEntry === undefined) return [];

  return readYamlListEntryValues(workflow, branchesEntry);
};

const readWorkflowEventBranches = (workflow, eventName) => {
  const entries = getYamlStructureEntries(workflow);
  const onEntry = findRootEntry(entries, /^\s*on:\s*(?:#.*)?$/);
  if (onEntry === undefined) return [];

  const eventEntry = findDirectChildEntry(
    entries,
    onEntry,
    new RegExp(`^\\s+${escapeRegExp(eventName)}:\\s*(?:#.*)?$`),
  );
  if (eventEntry === undefined) return [];

  const branchesEntry = findDirectChildEntry(entries, eventEntry, /^\s+branches:\s*(?:.*)?$/);
  if (branchesEntry === undefined) return [];

  return readYamlListEntryValues(workflow, branchesEntry);
};

const readCodeqlScheduleCrons = (workflow) => {
  const entries = getYamlStructureEntries(workflow);
  const onEntry = findRootEntry(entries, /^\s*on:\s*(?:#.*)?$/);
  if (onEntry === undefined) return [];

  const scheduleEntry = findDirectChildEntry(entries, onEntry, /^\s+schedule:\s*(?:#.*)?$/);
  if (scheduleEntry === undefined) return [];

  return getTopLevelListItemBlocks(getIndentedBlockRawFromIndex(workflow, scheduleEntry.index))
    .map((block) => {
      const inlineCron = block.match(/^\s*-\s+cron:\s*(.*?)\s*(?:#.*)?$/m)?.[1];
      if (inlineCron !== undefined) return stripYamlQuotes(inlineCron.trim());

      const childCron = block.match(/^\s*cron:\s*(.*?)\s*(?:#.*)?$/m)?.[1];
      return childCron === undefined ? undefined : stripYamlQuotes(childCron.trim());
    })
    .filter((cron) => cron !== undefined);
};

const readCodeqlPermissions = (workflow) => {
  const permissionsEntry = getRootEntry(workflow, /^\s*permissions:\s*(?:#.*)?$/);
  if (permissionsEntry === undefined) return undefined;
  return readDirectChildScalarMap(workflow, permissionsEntry);
};

const isCodeqlInitActionStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${CODEQL_INIT_ACTION_REPOSITORY}@`) ?? false;

const isCodeqlAnalyzeActionStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${CODEQL_ANALYZE_ACTION_REPOSITORY}@`) ?? false;

const getCodeqlStepEntries = (workflow) => {
  const stepsBlockEntry = getJobStepsBlockEntry(workflow, CODEQL_JOB_NAME);
  if (stepsBlockEntry === undefined) return [];

  return getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex);
};

const getDependencyReviewStepEntries = (workflow) => {
  const stepsBlockEntry = getJobStepsBlockEntry(workflow, DEPENDENCY_REVIEW_JOB_NAME);
  if (stepsBlockEntry === undefined) return [];

  return getTopLevelListItemBlockEntries(stepsBlockEntry.block, stepsBlockEntry.startIndex);
};

const isDependencyReviewActionStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${DEPENDENCY_REVIEW_ACTION_REPOSITORY}@`) ??
  false;

const readCodeqlQuerySet = (queries) =>
  new Set(
    (queries ?? "")
      .split(/[,\n]/)
      .map((query) => query.trim().replace(/^\+/, ""))
      .filter((query) => query.length > 0),
  );

const getCodeqlActionRef = (actionReference) => {
  const separatorIndex = actionReference.lastIndexOf("@");
  return separatorIndex === -1 ? "" : actionReference.slice(separatorIndex + 1);
};

const getActionReferenceRef = (actionReference) => {
  const separatorIndex = actionReference.lastIndexOf("@");
  return separatorIndex === -1 ? "" : actionReference.slice(separatorIndex + 1);
};

const getCodeqlActionPinFailure = (actionReference) => {
  if (!isExternalActionReference(actionReference)) return undefined;

  const ref = getCodeqlActionRef(actionReference);
  if (/^[0-9a-f]{40}$/.test(ref)) return undefined;

  const boundaryReason = getShaBoundaryReason(actionReference);
  if (boundaryReason !== undefined) return boundaryReason;
  if (ref.length === FULL_COMMIT_SHA_LENGTH) {
    return "SHA must use lowercase hexadecimal characters";
  }
  return "CodeQL workflow actions must be pinned to a full commit SHA";
};

const getCodeqlPinFailures = (workflow) =>
  extractActionReferences(workflow)
    .map((actionReference) => ({
      actionReference,
      reason: getCodeqlActionPinFailure(actionReference),
    }))
    .filter((failure) => failure.reason !== undefined);

const getDependencyReviewActionPinFailure = (actionReference) => {
  const ref = getActionReferenceRef(actionReference);
  if (/^[0-9a-f]{40}$/.test(ref)) return undefined;

  const boundaryReason = getShaBoundaryReason(actionReference);
  if (
    boundaryReason !== undefined &&
    boundaryReason !== "40 hexadecimal characters is exactly valid"
  ) {
    return boundaryReason;
  }
  if (ref.length === FULL_COMMIT_SHA_LENGTH && /^[0-9a-fA-F]+$/.test(ref)) {
    return "full SHA must use lowercase hexadecimal";
  }
  if (ref.length === FULL_COMMIT_SHA_LENGTH) {
    return "full SHA must contain only hexadecimal chars";
  }
  return `${DEPENDENCY_REVIEW_ACTION_REPOSITORY} must be pinned to a full commit SHA`;
};

const getDuplicateValue = (values) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
};

const parseCommaSeparatedList = (value) =>
  (value ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const getExactLicenseListFailures = (actual, required, inputName, adjective) => {
  if (actual.length === 0) return [`${inputName} is required`];

  const duplicate = getDuplicateValue(actual);
  if (duplicate !== undefined) return [`duplicate ${adjective} license ${duplicate}`];

  const missing = required.find((license) => !actual.includes(license));
  if (missing !== undefined) return [`missing ${adjective} license ${missing}`];

  const unexpected = actual.find((license) => !required.includes(license));
  if (unexpected !== undefined) return [`unexpected ${adjective} license ${unexpected}`];

  const exactOrder =
    actual.length === required.length &&
    actual.every((license, index) => license === required[index]);
  if (!exactOrder) return [`${adjective} licenses must follow the required order`];

  return [];
};

const getSingleLicenseInputFailures = (inputs, required, inputName, adjective) => {
  if (inputs.length === 0) return [`${inputName} is required`];
  if (inputs.length > 1) {
    return [`${inputName} must be configured on exactly one actions/dependency-review-action step`];
  }

  return getExactLicenseListFailures(inputs[0] ?? [], required, inputName, adjective);
};

const getDependencyReviewWorkflowFailures = (workflow) => {
  const failures = [];
  const eventNames = readWorkflowRootEventNames(workflow);

  if (!eventNames.includes("pull_request")) {
    failures.push("pull_request trigger is required");
  } else {
    const pullRequestBranches = readWorkflowEventBranches(workflow, "pull_request");
    if (pullRequestBranches.length !== 1 || pullRequestBranches[0] !== "main") {
      failures.push("pull_request must target main");
    }
  }
  if (eventNames.some((eventName) => eventName !== "pull_request")) {
    failures.push("Dependency Review workflow must be pull_request-only");
  }

  const stepEntries = getDependencyReviewStepEntries(workflow);
  const dependencyReviewSteps = stepEntries.filter((entry) =>
    isDependencyReviewActionStep(entry.block),
  );
  if (dependencyReviewSteps.length === 0) {
    failures.push(`${DEPENDENCY_REVIEW_ACTION_REPOSITORY} is required`);
    return failures;
  }

  for (const dependencyReviewStep of dependencyReviewSteps) {
    const actionReference = getStepPropertyValue(dependencyReviewStep.block, "uses") ?? "";
    const pinFailure = getDependencyReviewActionPinFailure(actionReference);
    if (pinFailure !== undefined) failures.push(pinFailure);
  }

  const severityInputs = dependencyReviewSteps.map((dependencyReviewStep) =>
    getStepInput(
      dependencyReviewStep.block,
      "fail-on-severity",
      workflow,
      dependencyReviewStep.startIndex,
    ),
  );
  if (severityInputs.some((failOnSeverity) => failOnSeverity === undefined)) {
    failures.push("fail-on-severity: high is required");
    failures.push("fail-on-severity must be configured on actions/dependency-review-action");
  } else if (severityInputs.some((failOnSeverity) => failOnSeverity !== "high")) {
    failures.push("high severity advisories must fail");
  }

  const stepsWithBothLicenseModes = dependencyReviewSteps.filter((dependencyReviewStep) => {
    const allowLicensesInput = getStepInput(
      dependencyReviewStep.block,
      "allow-licenses",
      workflow,
      dependencyReviewStep.startIndex,
    );
    const denyLicensesInput = getStepInput(
      dependencyReviewStep.block,
      "deny-licenses",
      workflow,
      dependencyReviewStep.startIndex,
    );
    return allowLicensesInput !== undefined && denyLicensesInput !== undefined;
  });
  if (stepsWithBothLicenseModes.length > 0) {
    failures.push(
      "allow-licenses and deny-licenses must be configured on separate actions/dependency-review-action steps",
    );
  }

  const allowLicenseInputs = dependencyReviewSteps.flatMap((dependencyReviewStep) => {
    const value = getStepInput(
      dependencyReviewStep.block,
      "allow-licenses",
      workflow,
      dependencyReviewStep.startIndex,
    );
    return value === undefined ? [] : [parseCommaSeparatedList(value)];
  });
  const denyLicenseInputs = dependencyReviewSteps.flatMap((dependencyReviewStep) => {
    const value = getStepInput(
      dependencyReviewStep.block,
      "deny-licenses",
      workflow,
      dependencyReviewStep.startIndex,
    );
    return value === undefined ? [] : [parseCommaSeparatedList(value)];
  });
  const allowLicenses = allowLicenseInputs[0] ?? [];
  const denyLicenses = denyLicenseInputs[0] ?? [];

  failures.push(
    ...getSingleLicenseInputFailures(
      allowLicenseInputs,
      DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES,
      "allow-licenses",
      "allowed",
    ),
  );
  failures.push(
    ...getSingleLicenseInputFailures(
      denyLicenseInputs,
      DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES,
      "deny-licenses",
      "denied",
    ),
  );

  if (allowLicenses.includes("GPL-3.0-only")) {
    failures.push("unexpected allowed license GPL-3.0-only");
  }
  if (denyLicenses.includes("MIT")) {
    failures.push("unexpected denied license MIT");
  }

  return [...new Set(failures)];
};

const getDependencyReviewWorkflowActionReferences = (workflow) =>
  getDependencyReviewStepEntries(workflow)
    .filter((entry) => isDependencyReviewActionStep(entry.block))
    .map((entry) => getStepPropertyValue(entry.block, "uses"))
    .filter((actionReference) => actionReference !== undefined);

const runDependencyReviewWorkflowConfig = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", dependencyReviewWorkflowConfigUsage);
  const workflow = readWorkflowFile(workflowPath);
  const failures = getDependencyReviewWorkflowFailures(workflow);
  const actionReferences = getDependencyReviewWorkflowActionReferences(workflow);
  const pinFailure = actionReferences
    .map((actionReference) => ({
      actionReference,
      reason: getDependencyReviewActionPinFailure(actionReference),
    }))
    .find((failure) => failure.reason !== undefined);
  const boundaryReasons = actionReferences.map(getShaBoundaryReason).filter(Boolean);

  if (failures.length === 0) {
    writeStdout(
      `dependency_review_workflow=pass\nallowed_license=MIT\ndenied_license=GPL-3.0-only\ndenied_license=GPL-3.0-or-later\nallow_licenses=exact\ndeny_licenses=exact\n${boundaryReasons.map((reason) => `boundary_reason=${reason}\n`).join("")}`,
    );
    return;
  }

  writeStdout(
    `dependency_review_workflow=fail\n${pinFailure === undefined ? "" : `moving_reference=${pinFailure.actionReference}\nboundary_reason=${pinFailure.reason}\n`}`,
  );
  fail(failures.join("\n"), 1);
};

const getCodeqlPermissionFailures = (permissions) => {
  if (permissions === undefined) return ["CodeQL workflow must set least-privilege permissions"];

  const missingOrWrongPermissions = [...CODEQL_REQUIRED_PERMISSIONS].flatMap(
    ([permissionName, requiredValue]) =>
      permissions.get(permissionName) === requiredValue
        ? []
        : [`permissions.${permissionName} must be ${requiredValue}`],
  );
  const extraPermissions = [...permissions.keys()]
    .filter((permissionName) => !CODEQL_REQUIRED_PERMISSIONS.has(permissionName))
    .map(
      (permissionName) => `permission ${permissionName} is outside CodeQL least-privilege scope`,
    );

  return [...missingOrWrongPermissions, ...extraPermissions];
};

const getCodeqlWorkflowFailures = (workflow) => {
  const failures = [];
  const eventNames = readWorkflowRootEventNames(workflow);

  if (!eventNames.includes("push") || !readCodeqlPushBranches(workflow).includes("main")) {
    failures.push("CodeQL workflow must run on push to main");
  }
  if (!eventNames.includes("pull_request")) {
    failures.push("CodeQL workflow must run on pull_request");
  }

  const scheduleCrons = readCodeqlScheduleCrons(workflow);
  if (!eventNames.includes("schedule") || scheduleCrons.length === 0) {
    failures.push("CodeQL workflow must run weekly");
  } else if (!scheduleCrons.includes(CODEQL_REQUIRED_CRON)) {
    failures.push(`CodeQL weekly schedule must use ${CODEQL_REQUIRED_CRON}`);
  }

  failures.push(...getCodeqlPermissionFailures(readCodeqlPermissions(workflow)));

  const jobEntry = getJobBlockEntry(workflow, CODEQL_JOB_NAME);
  if (jobEntry === undefined) {
    failures.push("missing codeql job");
  } else {
    const jobBlock = getIndentedBlockRawFromIndex(workflow, jobEntry.index);
    if (getStepPropertyValue(jobBlock, "timeout-minutes") !== "8") {
      failures.push("CodeQL job timeout-minutes must be 8");
    }
  }

  const stepEntries = getCodeqlStepEntries(workflow);
  const initStep = stepEntries.find((entry) => isCodeqlInitActionStep(entry.block));
  const analyzeStep = stepEntries.find((entry) => isCodeqlAnalyzeActionStep(entry.block));

  if (initStep === undefined) {
    failures.push(`CodeQL workflow must use ${CODEQL_INIT_ACTION_REPOSITORY}`);
  } else {
    const language = getStepInput(initStep.block, "languages", workflow, initStep.startIndex);
    if (language !== CODEQL_REQUIRED_LANGUAGE) {
      failures.push(`CodeQL must analyze ${CODEQL_REQUIRED_LANGUAGE}`);
    }

    const queries = readCodeqlQuerySet(
      getStepInput(initStep.block, "queries", workflow, initStep.startIndex),
    );
    if (!CODEQL_REQUIRED_QUERIES.every((query) => queries.has(query))) {
      failures.push("CodeQL queries must include security-extended and security-and-quality");
    }
  }

  if (analyzeStep === undefined) {
    failures.push(`CodeQL workflow must use ${CODEQL_ANALYZE_ACTION_REPOSITORY}`);
  } else {
    const category = getStepInput(analyzeStep.block, "category", workflow, analyzeStep.startIndex);
    if (category !== CODEQL_REQUIRED_CATEGORY) {
      failures.push(`CodeQL analyze category must be ${CODEQL_REQUIRED_CATEGORY}`);
    }
  }

  const pinFailures = getCodeqlPinFailures(workflow);
  if (pinFailures.length > 0) {
    failures.push("CodeQL workflow actions must be pinned to a full commit SHA");
    failures.push(...pinFailures.map((failure) => failure.reason));
  }

  return [...new Set(failures)];
};

const runCodeqlWorkflowConfig = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", codeqlWorkflowConfigUsage);
  const workflow = readWorkflowFile(workflowPath);
  const failures = getCodeqlWorkflowFailures(workflow);
  const actionReferences = extractActionReferences(workflow);
  const pinFailures = getCodeqlPinFailures(workflow);
  const boundaryReasons = [
    "weekly Monday scan at 06:00 UTC",
    ...getBoundaryReasons(actionReferences),
  ];

  if (failures.length === 0) {
    writeStdout(
      `codeql_workflow=pass\ncodeql_visibility=security-tab\ncodeql_language=${CODEQL_REQUIRED_LANGUAGE}\ncodeql_category=${CODEQL_REQUIRED_CATEGORY}\nschedule_cron=${CODEQL_REQUIRED_CRON}\n${boundaryReasons.map((reason) => `boundary_reason=${reason}\n`).join("")}`,
    );
    return;
  }

  writeStdout(
    `codeql_workflow=fail\n${pinFailures
      .map(
        (failure) =>
          `moving_reference=${failure.actionReference}\nboundary_reason=${failure.reason}\n`,
      )
      .join("")}`,
  );
  fail(failures.join("\n"), 1);
};

const getReleaseTagPatternFailure = (tagPatterns) => {
  if (tagPatterns.length === 0) return "push.tags must include v*";
  if (tagPatterns.length === 1 && tagPatterns[0] === "v*") return undefined;
  if (tagPatterns.includes("v*")) return "release workflow must only run on push tags v*";
  if (tagPatterns.includes("*")) return "non-release tags can trigger";
  if (tagPatterns.some((pattern) => pattern.startsWith("v0."))) {
    return "future v1 tags would not trigger";
  }
  if (tagPatterns.some((pattern) => !pattern.startsWith("v"))) {
    return "v prefix contract is missing";
  }
  return "push.tags must include v*";
};

const runReleaseTrigger = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", releaseTriggerUsage);
  const workflow = readWorkflowFile(workflowPath);
  const eventNames = readWorkflowRootEventNames(workflow);

  if (eventNames.length !== 1 || eventNames[0] !== "push") {
    writeStdout("release_trigger=fail\n");
    fail("release workflow must only run on push tags v*", 1);
  }

  const tagPatterns = readWorkflowPushTagPatterns(workflow);
  const tagPatternFailure = getReleaseTagPatternFailure(tagPatterns);
  if (tagPatternFailure !== undefined) {
    writeStdout(
      `release_trigger=fail\n${tagPatterns.map((pattern) => `tag_pattern=${pattern}\n`).join("")}`,
    );
    fail(tagPatternFailure, 1);
  }

  writeStdout(
    "release_trigger=pass\ntrigger_event=push\ntag_pattern=v*\nboundary_reason=required v prefix is present\n",
  );
};

const readPackageVersion = (packagePath) => {
  const packageJson = readJsonFile(packagePath, "package");
  if (typeof packageJson !== "object" || packageJson === null) {
    fail(`ERROR: package file must be an object: ${packagePath}.`, 2);
  }
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    fail(`ERROR: package file must contain a version: ${packagePath}.`, 2);
  }
  return packageJson.version;
};

const formatPackageDisplayName = (packagePath) => {
  const normalizedPath = packagePath.replaceAll("\\", "/");
  const match = normalizedPath.match(/(?:^|\/)((?:apps|packages)\/[^/]+)\/package\.json$/);
  return match?.[1] ?? normalizedPath.replace(/\/package\.json$/, "");
};

const readPackageFiles = (options) =>
  readRequiredOption(options, "package-files", releaseVerifyTagUsage)
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);

const getExpectedVersionFromTag = (tag) => {
  if (!tag.startsWith("v")) fail("tag lacks required v prefix", 1);
  if (tag.startsWith("vv")) fail("tag has two leading v prefixes", 1);
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail("tag must use vX.Y.Z format", 1);
  return tag.slice(1);
};

const readTextFile = (path, label) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`ERROR: Unable to read ${label} file: ${path}.`, 2);
  }
};

const CHANGELOG_RELEASE_HEADING_DATE_SUFFIX = "[ \\t]*-[ \\t]*\\d{4}-\\d{2}-\\d{2}";

const findChangelogReleaseHeadingMatch = (changelog, version) => {
  const pattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\]${CHANGELOG_RELEASE_HEADING_DATE_SUFFIX}[ \\t]*$`,
    "m",
  );
  const match = pattern.exec(changelog);
  if (match === null || match.index === undefined) return null;
  return match;
};

const hasChangelogReleaseSection = (changelog, version) =>
  findChangelogReleaseHeadingMatch(changelog, version) !== null;

const getChangelogUnreleasedBody = (changelog) => {
  const match = /^## \[Unreleased\]\s*$/m.exec(changelog);
  if (match === null || match.index === undefined) return null;
  const bodyStart = match.index + match[0].length;
  const nextHeading = changelog.slice(bodyStart).match(/\n## \[[^\]]+\]/);
  const bodyEnd =
    nextHeading?.index === undefined ? changelog.length : bodyStart + nextHeading.index;
  return changelog.slice(bodyStart, bodyEnd);
};

const hasMarkdownBulletEntry = (body) => /^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(body);

const runReleaseVerifyTag = (args) => {
  const options = parseOptions(args);
  const tag = readRequiredOption(options, "tag", releaseVerifyTagUsage);
  const expectedVersion = getExpectedVersionFromTag(tag);
  const packageFiles = readPackageFiles(options);
  const packageVersions = packageFiles.map((packagePath) => ({
    path: packagePath,
    version: readPackageVersion(packagePath),
  }));
  const versionSet = new Set(packageVersions.map((entry) => entry.version));

  if (versionSet.size > 1) {
    const mismatches = packageVersions.filter((entry) => entry.version !== expectedVersion);
    writeStdout("verify_tag=fail\n");
    fail(
      [
        "package version mismatch",
        ...mismatches.map(
          (entry) =>
            `${formatPackageDisplayName(entry.path)} version ${entry.version} does not match tag ${tag}`,
        ),
      ].join("\n"),
      1,
    );
  }

  const packageVersion = packageVersions[0]?.version;
  if (packageVersion === undefined) {
    fail("ERROR: --package-files must contain at least one package file.", 2);
  }

  if (packageVersion !== expectedVersion) {
    writeStdout("verify_tag=fail\n");
    fail("tag does not match version\npackage version mismatch", 1);
  }

  const changelogPath = readRequiredOption(options, "changelog", releaseVerifyTagUsage);
  const changelog = readTextFile(changelogPath, "changelog");
  if (!hasChangelogReleaseSection(changelog, expectedVersion)) {
    const unreleasedBody = getChangelogUnreleasedBody(changelog);
    if (unreleasedBody !== null && !hasMarkdownBulletEntry(unreleasedBody)) {
      writeStdout("verify_tag=fail\n");
      fail(
        "Refusing to release with empty Unreleased\nAdd at least one bullet under [Unreleased] before tagging",
        1,
      );
    }
    writeStdout("verify_tag=fail\n");
    fail(`changelog section mismatch\nmissing changelog section ## [${expectedVersion}]`, 1);
  }

  const unreleasedBody = getChangelogUnreleasedBody(changelog);
  if (unreleasedBody !== null && hasMarkdownBulletEntry(unreleasedBody)) {
    writeStdout("verify_tag=fail\n");
    fail("changelog inconsistent\n[Unreleased] still has entries after release section", 1);
  }

  writeStdout("verify_tag=pass\nboundary_reason=tag has one leading v and exact version\n");
};

const splitReleaseTags = (tagsValue) =>
  tagsValue
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

const isReleaseDockerBuildStep = (step) =>
  getStepPropertyValue(step, "uses")?.startsWith(`${DOCKER_BUILD_ACTION_REPOSITORY}@`) ?? false;

const getImageRepositoryFromTag = (tag) => tag.match(/^(.*):[^/:]+$/)?.[1];

const runReleaseBuildAndPush = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", releaseBuildAndPushUsage);
  const workflow = readWorkflowFile(workflowPath);
  const stepsBlockEntry = getJobStepsBlockEntry(workflow, "build-and-push");
  if (stepsBlockEntry === undefined) {
    writeStdout("release_build_and_push=fail\n");
    fail("missing build-and-push job", 1);
  }

  const buildStep = getTopLevelListItemBlockEntries(
    stepsBlockEntry.block,
    stepsBlockEntry.startIndex,
  ).find((entry) => isReleaseDockerBuildStep(entry.block));
  if (buildStep === undefined) {
    writeStdout("release_build_and_push=fail\n");
    fail(`build-and-push must use ${DOCKER_BUILD_ACTION_REPOSITORY}`, 1);
  }

  const push = getStepInput(buildStep.block, "push", workflow, buildStep.startIndex);
  if (push !== "true") {
    writeStdout("release_build_and_push=fail\n");
    fail("build-and-push must push release images", 1);
  }

  const platforms =
    getStepInput(buildStep.block, "platforms", workflow, buildStep.startIndex) ?? "";
  const platformBoundary = getDockerPlatformBoundary(platforms);
  if (platformBoundary.outcome === "rejected") {
    writeStdout(
      `release_build_and_push=fail\nplatform_outcome=rejected\nboundary_reason=${platformBoundary.reason}\n`,
    );
    fail(platformBoundary.reason, 1);
  }

  const imageTags = splitReleaseTags(
    getStepInput(buildStep.block, "tags", workflow, buildStep.startIndex) ?? "",
  );
  const imageRepositories = new Set(
    imageTags.map(getImageRepositoryFromTag).filter((repository) => repository !== undefined),
  );
  if (!imageRepositories.has(RELEASE_IMAGE_REPOSITORY)) {
    writeStdout("release_build_and_push=fail\n");
    fail(`image repository must be ${RELEASE_IMAGE_REPOSITORY}`, 1);
  }

  const missingTags = RELEASE_REQUIRED_IMAGE_TAGS.filter(
    (requiredTag) => !requiredTag.values.some((tag) => imageTags.includes(tag)),
  );
  if (missingTags.length > 0) {
    const missingTag = missingTags.toSorted(
      (left, right) => left.label.length - right.label.length,
    )[0];
    writeStdout("release_build_and_push=fail\n");
    fail(`missing ${missingTag.label} tag`, 1);
  }

  writeStdout(
    `release_build_and_push=pass\nplatform_outcome=accepted\nboundary_reason=${platformBoundary.reason}\n`,
  );
};

const README_INSTALL_HEADING_MAX_LINES = 200;

const findMarkdownHeadingLine = (markdown, headingPattern) => {
  const lines = markdown.split(/\r?\n/);
  let openFence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch !== null) {
      const fence = fenceMatch[1];
      const trailer = fenceMatch[2] ?? "";
      const marker = fence[0];
      if (openFence === null) {
        openFence = { marker, length: fence.length };
        continue;
      }
      if (
        openFence.marker === marker &&
        fence.length >= openFence.length &&
        /^[ \t]*$/.test(trailer)
      ) {
        openFence = null;
      }
      continue;
    }
    if (openFence === null && headingPattern.test(line)) {
      return index + 1;
    }
  }
  return null;
};

const runReadmeReferencesRelease = (args) => {
  const options = parseOptions(args);
  const readmePath = readRequiredOption(options, "readme", readmeReferencesReleaseUsage);
  const image = readRequiredOption(options, "image", readmeReferencesReleaseUsage);
  const version = readRequiredOption(options, "version", readmeReferencesReleaseUsage);

  const readme = readTextFile(readmePath, "readme");
  const pullSnippet = `docker pull ${image}:v${version}`;
  if (!readme.includes(pullSnippet)) {
    writeStdout("readme_references_release=fail\n");
    const otherRepoPattern = new RegExp(`docker pull \\S+:v${escapeRegExp(version)}\\b`);
    if (otherRepoPattern.test(readme)) {
      fail(`README references a different repository path\nRepository path must be ${image}`, 1);
    }
    fail(
      `README is missing the literal snippet \`${pullSnippet}\`\nAdd a docker pull snippet pinned to v${version} in ${readmePath}`,
      1,
    );
  }

  const installHeading = "## Install";
  const installHeadingLine = findMarkdownHeadingLine(readme, /^## Install\s*$/);
  if (installHeadingLine === null) {
    writeStdout("readme_references_release=fail\n");
    fail(`README is missing the \`${installHeading}\` section heading`, 1);
  }

  if (installHeadingLine > README_INSTALL_HEADING_MAX_LINES) {
    writeStdout("readme_references_release=fail\n");
    fail(
      `\`${installHeading}\` heading must appear within the first ${README_INSTALL_HEADING_MAX_LINES} lines (found at line ${installHeadingLine})`,
      1,
    );
  }

  writeStdout("readme_references_release=pass\n");
};

const runReleaseVerifyTagAnnotation = (args) => {
  const options = parseOptions(args);
  const tag = readRequiredOption(options, "tag", releaseVerifyTagAnnotationUsage);
  const repo = readRequiredOption(options, "repo", releaseVerifyTagAnnotationUsage);

  const result = spawnSync("git", ["-C", repo, "cat-file", "-t", tag], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    writeStdout("verify_tag_annotation=fail\n");
    fail(`git cat-file -t ${tag} failed in ${repo}\n${(result.stderr ?? "").trim()}`, 1);
  }

  const objectType = (result.stdout ?? "").trim();
  if (objectType !== "tag") {
    const version = tag.replace(/^v/, "");
    writeStdout(`verify_tag_annotation=fail\ntag_object_type=${objectType}\n`);
    fail(
      `${tag} is not an annotated tag (cat-file -t returned ${objectType})\nRecreate the tag with git tag -a ${tag} -m "Release v${version}"`,
      1,
    );
  }

  writeStdout("verify_tag_annotation=pass\ntag_object_type=tag\n");
};

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

const runReleaseVerifyCommitSubject = (args) => {
  const options = parseOptions(args);
  const tag = readRequiredOption(options, "tag", releaseVerifyCommitSubjectUsage);
  const repo = readRequiredOption(options, "repo", releaseVerifyCommitSubjectUsage);

  if (!RELEASE_TAG_PATTERN.test(tag)) {
    writeStdout("verify_commit_subject=fail\n");
    fail(`tag ${tag} must match vX.Y.Z`, 1);
  }

  const version = tag.slice(1);
  const expectedSubject = `chore(release): v${version}`;

  const result = spawnSync("git", ["-C", repo, "log", "-1", "--pretty=%s", `${tag}^{commit}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    writeStdout("verify_commit_subject=fail\n");
    fail(
      `git log -1 --pretty=%s ${tag}^{commit} failed in ${repo}\n${(result.stderr ?? "").trim()}`,
      1,
    );
  }

  const subject = (result.stdout ?? "").replace(/\n$/, "");
  if (subject !== expectedSubject) {
    writeStdout(`verify_commit_subject=fail\ntag_subject=${subject}\n`);
    fail(
      `tagged commit subject is "${subject}", expected "${expectedSubject}"\nCommit subject must equal ${expectedSubject}`,
      1,
    );
  }

  writeStdout(`verify_commit_subject=pass\ntag_subject=${subject}\n`);
};

const RELEASE_NOTES_MAX_BYTES_PATTERN = /^[1-9]\d{0,9}$/;
const RELEASE_NOTES_REPO_URL_PATTERN = /^https?:\/\/[^\s)]+$/;
const RELEASE_NOTES_TRAILING_NEWLINE_BYTES = 1;
const RELEASE_NOTES_TRUNCATION_NOTICE_HEAD =
  "\n\n_Release notes truncated to stay under the GitHub Releases body limit. See ";
const RELEASE_NOTES_TRUNCATION_NOTICE_TAIL = " for the complete entry._";

const findChangelogReleaseHeadingDate = (changelog, version) => {
  const pattern = new RegExp(
    `^## \\[${escapeRegExp(version)}\\][ \\t]*-[ \\t]*(\\d{4}-\\d{2}-\\d{2})[ \\t]*$`,
    "m",
  );
  return pattern.exec(changelog)?.[1] ?? null;
};

const buildChangelogHeadingAnchor = (version, date) =>
  `[${version}] - ${date}`
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const buildReleaseNotesTruncationNotice = ({ version, date, repoUrl }) => {
  const trimmedRepoUrl = typeof repoUrl === "string" ? repoUrl.trim() : "";
  if (trimmedRepoUrl.length > 0 && date !== null) {
    const normalizedRepoUrl = trimmedRepoUrl.replace(/\/+$/, "");
    const anchor = buildChangelogHeadingAnchor(version, date);
    const link = `${normalizedRepoUrl}/blob/v${version}/CHANGELOG.md#${anchor}`;
    const linkText = `[full v${version} changelog](${link})`;
    return `${RELEASE_NOTES_TRUNCATION_NOTICE_HEAD}${linkText}${RELEASE_NOTES_TRUNCATION_NOTICE_TAIL}`;
  }
  return `${RELEASE_NOTES_TRUNCATION_NOTICE_HEAD}CHANGELOG.md at tag v${version}${RELEASE_NOTES_TRUNCATION_NOTICE_TAIL}`;
};

const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const isValidFenceOpener = (marker, suffix) => marker[0] === "~" || !suffix.includes("`");

const isValidFenceCloser = (marker, suffix, opener) =>
  marker[0] === opener[0] && marker.length >= opener.length && suffix.trim().length === 0;

const closeDanglingCodeFence = (text) => {
  const openMarkers = [];
  for (const line of text.split("\n")) {
    const match = FENCE_LINE_PATTERN.exec(line);
    if (match === null) continue;
    const marker = match[1];
    const suffix = match[2];
    const opener = openMarkers.at(-1);
    if (opener !== undefined) {
      if (isValidFenceCloser(marker, suffix, opener)) openMarkers.pop();
      continue;
    }
    if (isValidFenceOpener(marker, suffix)) openMarkers.push(marker);
  }
  if (openMarkers.length === 0) return text;
  const closers = openMarkers.toReversed().join("\n");
  const separator = text.endsWith("\n") ? "" : "\n";
  return `${text}${separator}${closers}\n`;
};

const stripTrailingInvalidUnicode = (text) => text.replace(/[�\uD800-\uDFFF]+$/, "");

const buildFenceSafeHead = (value) => {
  const lastNewline = value.lastIndexOf("\n");
  const safeHead = lastNewline > 0 ? value.slice(0, lastNewline) : value;
  return closeDanglingCodeFence(safeHead.replace(/\s+$/, ""));
};

const truncateReleaseNotes = ({ body, maxBytes, notice }) => {
  const noticeBytes = Buffer.byteLength(notice, "utf8");
  const overhead = noticeBytes + RELEASE_NOTES_TRAILING_NEWLINE_BYTES;
  if (overhead >= maxBytes) {
    fail(
      `ERROR: --max-bytes ${maxBytes} is too small for the truncation notice and trailing newline (${overhead} bytes).`,
      2,
    );
  }
  const budget = maxBytes - overhead;
  const bodyBuffer = Buffer.from(body, "utf8");
  let head = stripTrailingInvalidUnicode(bodyBuffer.slice(0, budget).toString("utf8"));
  while (Buffer.byteLength(head, "utf8") > budget) {
    head = stripTrailingInvalidUnicode(head.slice(0, -1));
  }
  let fenceSafe = buildFenceSafeHead(head);
  while (Buffer.byteLength(fenceSafe, "utf8") > budget && head.length > 0) {
    head = stripTrailingInvalidUnicode(head.slice(0, -1));
    fenceSafe = buildFenceSafeHead(head);
  }
  return `${fenceSafe}${notice}`;
};

const applyReleaseNotesCap = ({ body, version, changelog, maxBytesRaw, repoUrl }) => {
  if (maxBytesRaw === undefined) return body;
  if (!RELEASE_NOTES_MAX_BYTES_PATTERN.test(maxBytesRaw)) {
    fail(
      `ERROR: --max-bytes must be a positive integer (got "${maxBytesRaw}").\n${releaseExtractNotesUsage}`,
      2,
    );
  }
  const maxBytes = Number(maxBytesRaw);
  if (Buffer.byteLength(body, "utf8") + RELEASE_NOTES_TRAILING_NEWLINE_BYTES <= maxBytes)
    return body;
  const date = findChangelogReleaseHeadingDate(changelog, version);
  if (date === null && typeof repoUrl === "string" && repoUrl.trim().length > 0) {
    writeStderr(
      `WARN: --repo-url provided but heading date for ${version} could not be parsed; emitting notice without link.\n`,
    );
  }
  const notice = buildReleaseNotesTruncationNotice({ version, date, repoUrl });
  return truncateReleaseNotes({ body, maxBytes, notice });
};

const runReleaseExtractNotes = (args) => {
  const options = parseOptions(args);
  const changelogPath = readRequiredOption(options, "changelog", releaseExtractNotesUsage);
  const version = readRequiredOption(options, "version", releaseExtractNotesUsage);
  const maxBytesRaw = options.get("max-bytes");
  const repoUrl = options.get("repo-url");
  if (repoUrl !== undefined && !RELEASE_NOTES_REPO_URL_PATTERN.test(repoUrl.trim())) {
    fail(
      `ERROR: --repo-url must be an http(s) URL without spaces or ')' (got "${repoUrl}").\n${releaseExtractNotesUsage}`,
      2,
    );
  }

  const changelog = readTextFile(changelogPath, "changelog");
  if (!hasChangelogReleaseSection(changelog, version)) {
    fail(`Missing changelog section ## [${version}]`, 1);
  }

  const body = getChangelogReleaseSection(changelog, version).trim();
  const output = applyReleaseNotesCap({
    body,
    version,
    changelog,
    maxBytesRaw,
    repoUrl,
  });
  writeStdout(`${output}\n`);
};

const PROMOTE_CHANGELOG_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const PROMOTE_CHANGELOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidCalendarDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
};

const runPromoteChangelog = (args) => {
  const options = parseOptions(args);
  const version = readRequiredOption(options, "version", promoteChangelogUsage);
  const date = readRequiredOption(options, "date", promoteChangelogUsage);
  const changelogPath = readRequiredOption(options, "changelog", promoteChangelogUsage);

  if (!PROMOTE_CHANGELOG_VERSION_PATTERN.test(version)) {
    writeStdout("promote_changelog=fail\n");
    fail(`version must be X.Y.Z, got ${version}`, 1);
  }
  if (!PROMOTE_CHANGELOG_DATE_PATTERN.test(date)) {
    writeStdout("promote_changelog=fail\n");
    fail(`date must be YYYY-MM-DD, got ${date}`, 1);
  }
  if (!isValidCalendarDate(date)) {
    writeStdout("promote_changelog=fail\n");
    fail(`date ${date} is not a valid calendar date`, 1);
  }

  const changelog = readTextFile(changelogPath, "changelog");
  const unreleasedMatch = /^## \[Unreleased\]\s*$/m.exec(changelog);
  if (unreleasedMatch === null || unreleasedMatch.index === undefined) {
    writeStdout("promote_changelog=fail\n");
    fail("missing ## [Unreleased] heading", 1);
  }

  const releasedHeading = `## [${version}] - ${date}`;
  const existingReleasePattern = new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m");
  if (existingReleasePattern.test(changelog)) {
    writeStdout("promote_changelog=fail\n");
    fail(`version ${version} already has a section in changelog`, 1);
  }

  const bodyStart = unreleasedMatch.index + unreleasedMatch[0].length;
  const nextHeadingRelativeMatch = changelog.slice(bodyStart).match(/\n## \[[^\]]+\]/);
  const bodyEnd =
    nextHeadingRelativeMatch?.index === undefined
      ? changelog.length
      : bodyStart + nextHeadingRelativeMatch.index;

  const before = changelog.slice(0, bodyStart);
  const body = changelog.slice(bodyStart, bodyEnd);
  const after = changelog.slice(bodyEnd);

  if (!hasMarkdownBulletEntry(body)) {
    writeStdout("promote_changelog=fail\n");
    fail(
      "Refusing to release with empty Unreleased\nAdd at least one bullet under [Unreleased] before promoting",
      1,
    );
  }

  const promoted = `${before}\n\n${releasedHeading}${body}${after}`;

  writeFileSync(changelogPath, promoted);
  writeStdout("promote_changelog=pass\n");
};

const getChangelogReleaseSection = (changelog, version) => {
  const headingMatch = findChangelogReleaseHeadingMatch(changelog, version);
  if (headingMatch === null || headingMatch.index === undefined) return "";

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeading = changelog.slice(sectionStart).match(/\n## \[[^\]]+\]\s*/);
  const sectionEnd =
    nextHeading?.index === undefined ? changelog.length : sectionStart + nextHeading.index;
  return changelog.slice(sectionStart, sectionEnd);
};

const cosignDeferralPattern = /Cosign\s+signing\s+(?:is|remains)\s+deferred to /;
const cosignDeferralToV05Pattern = /Cosign\s+signing\s+(?:is|remains)\s+deferred to v0\.5\./;

const getCosignDeferralFailure = (sectionText, changelog) => {
  if (!cosignDeferralPattern.test(sectionText)) {
    if (cosignDeferralToV05Pattern.test(changelog)) {
      return `deferral must be documented in ## [${RELEASE_VERSION}]`;
    }
    return "document cosign signing deferral to v0.5";
  }

  if (cosignDeferralToV05Pattern.test(sectionText)) return undefined;
  if (/Cosign\s+signing\s+(?:is|remains)\s+deferred to v1\.0\./.test(sectionText)) {
    return "target version is too late";
  }
  return "target version is not concrete";
};

const runCosignDeferral = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", cosignDeferralUsage);
  const changelogPath = readRequiredOption(options, "changelog", cosignDeferralUsage);
  const workflow = readWorkflowFile(workflowPath);
  const changelog = readTextFile(changelogPath, "changelog");
  const releaseSection = getChangelogReleaseSection(changelog, RELEASE_VERSION);
  const deferralFailure = getCosignDeferralFailure(releaseSection, changelog);

  if (deferralFailure !== undefined) {
    writeStdout("cosign_deferral=fail\n");
    fail(deferralFailure, 1);
  }

  if (/sigstore\/cosign-installer@|(?:^|\s)cosign\s+sign(?:\s|$)/m.test(workflow)) {
    writeStdout("cosign_deferral=fail\n");
    fail("cosign signing is deferred to v0.5", 1);
  }

  writeStdout("cosign_deferral=pass\nboundary_reason=documented target version\n");
};

const runChangelogTrigger = (args) => {
  const options = parseOptions(args);
  const workflowPath = readRequiredOption(options, "workflow", changelogTriggerUsage);
  const workflow = readWorkflowFile(workflowPath);
  const jobsBlock = getIndentedBlock(workflow, /^\s*jobs:\s*(?:#.*)?$/);
  const changelogJob = getIndentedBlock(jobsBlock, /^\s+changelog-check:\s*(?:#.*)?$/);
  if (changelogJob.length === 0) {
    writeStdout("changelog_trigger=fail\njob=missing\n");
    fail("missing changelog-check job", 1);
  }

  const hasPullRequestEvent = readWorkflowEventNames(workflow).includes("pull_request");
  if (!hasPullRequestEvent) {
    writeStdout("changelog_trigger=fail\njob=changelog-check\n");
    fail("missing pull_request trigger", 1);
  }

  const condition = getStepPropertyValue(changelogJob, "if");
  const jobEligibleForPullRequest =
    condition !== undefined && isPullRequestEventCondition(condition);

  if (hasPullRequestEvent && changelogJob.length > 0 && jobEligibleForPullRequest) {
    writeStdout("changelog_trigger=pass\njob=changelog-check\neligible_event=pull_request\n");
    return;
  }

  writeStdout("changelog_trigger=fail\njob=changelog-check\n");
  fail("changelog-check must run on pull_request only", 1);
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
} else if (command === "codeql-duration-budget") {
  runCodeqlDurationBudget(args);
} else if (command === "codeql-workflow-config") {
  runCodeqlWorkflowConfig(args);
} else if (command === "dependency-review-workflow-config") {
  runDependencyReviewWorkflowConfig(args);
} else if (command === "docker-build-action") {
  runDockerBuildAction(args);
} else if (command === "docker-setup-action-pinning") {
  runDockerSetupActionPinning(args);
} else if (command === "build-docker-needs") {
  runBuildDockerNeeds(args);
} else if (command === "build-docker-scheduler") {
  runBuildDockerScheduler(args);
} else if (command === "release-pipeline-result") {
  runReleasePipelineResult(args);
} else if (command === "release-trigger") {
  runReleaseTrigger(args);
} else if (command === "release-verify-tag") {
  runReleaseVerifyTag(args);
} else if (command === "release-build-and-push") {
  runReleaseBuildAndPush(args);
} else if (command === "release-extract-notes") {
  runReleaseExtractNotes(args);
} else if (command === "release-verify-tag-annotation") {
  runReleaseVerifyTagAnnotation(args);
} else if (command === "release-verify-commit-subject") {
  runReleaseVerifyCommitSubject(args);
} else if (command === "readme-references-release") {
  runReadmeReferencesRelease(args);
} else if (command === "promote-changelog") {
  runPromoteChangelog(args);
} else if (command === "cosign-deferral") {
  runCosignDeferral(args);
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
} else if (command === "changelog-trigger") {
  runChangelogTrigger(args);
} else if (command === "changelog-diff") {
  runChangelogDiff(args);
} else if (command === "changelog-ci-only-assert") {
  runChangelogCiOnlyAssert(args);
} else if (command === "changelog-remediation-message") {
  runChangelogRemediationMessage(args);
} else if (command === "changelog-documentation-only-assert") {
  runChangelogDocumentationOnlyAssert(args);
} else if (command === "coverage-gate") {
  runCoverageGate(args);
} else if (command === "llm-providers-coverage-workflow") {
  runLlmProvidersCoverageWorkflow(args);
} else if (command === "package-coverage-workflow") {
  runPackageCoverageWorkflow(args);
} else if (command === "coverage-artifact-policy") {
  runCoverageArtifactPolicy(args);
} else {
  fail(usage, 2);
}
