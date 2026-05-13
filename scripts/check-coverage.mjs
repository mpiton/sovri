#!/usr/bin/env node
// scripts/check-coverage.mjs — Per-package Vitest coverage gate (#11).
//
// Reads an Istanbul json-summary file (emitted by `@vitest/coverage-v8`
// with the `json-summary` reporter), aggregates `lines` and `branches`
// counts for a single workspace package, and exits non-zero when either
// metric falls below the declared integer threshold.
//
// Contract (issue #11):
//   node scripts/check-coverage.mjs <coverage-summary.json> <package-path> <threshold>
//
//   <coverage-summary.json>  Path to the Vitest json-summary output.
//   <package-path>           Workspace-relative directory (e.g. packages/core).
//   <threshold>              Integer percentage in [0, 100].
//
// Exit codes:
//   0   Both lines and branches at or above threshold.
//   1   Threshold violation (printed on stderr with observed vs expected).
//   2   Infrastructure error (usage, unreadable file, malformed JSON,
//       no coverage entries match the package path).
//
// Intended for the `backend-checks` CI job
// (`docs/adr/012-lefthook-ci-gates.md`) after `pnpm exec vitest run
// --coverage`; the workflow wiring lands in a follow-up PR. No npm
// dependencies; node:fs + node:process only. ESM via `.mjs` so it runs
// without a wrapping `package.json` declaring `"type": "module"`.

import { readFileSync } from "node:fs";
import { argv, exit, stderr } from "node:process";

const USAGE =
  "Usage: node scripts/check-coverage.mjs <coverage-summary.json> <package-path> <threshold>";

const fatal = (message, code) => {
  const text = message.endsWith("\n") ? message : `${message}\n`;
  stderr.write(text);
  exit(code);
};

const args = argv.slice(2);
if (args.length !== 3) {
  fatal(`ERROR: Expected 3 arguments, got ${args.length}.\n${USAGE}`, 2);
}
const [summaryPath, packagePath, thresholdRaw] = args;

if (
  packagePath.length === 0 ||
  packagePath.startsWith("/") ||
  packagePath.startsWith("-") ||
  packagePath.includes("..")
) {
  fatal(
    `ERROR: <package-path> must be a relative workspace path (e.g. "packages/core"), got "${packagePath}".\n${USAGE}`,
    2,
  );
}

if (!/^\d+$/.test(thresholdRaw)) {
  fatal(`ERROR: <threshold> must be an integer in [0, 100], got "${thresholdRaw}".\n${USAGE}`, 2);
}
const threshold = Number(thresholdRaw);
if (threshold < 0 || threshold > 100) {
  fatal(`ERROR: <threshold> must be an integer in [0, 100], got "${thresholdRaw}".\n${USAGE}`, 2);
}

let raw;
try {
  raw = readFileSync(summaryPath, "utf8");
} catch (err) {
  fatal(
    `ERROR: Cannot read coverage summary "${summaryPath}": ${err instanceof Error ? err.message : String(err)}`,
    2,
  );
}

let summary;
try {
  summary = JSON.parse(raw);
} catch (err) {
  fatal(
    `ERROR: Coverage summary "${summaryPath}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    2,
  );
}

if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
  fatal(`ERROR: Coverage summary "${summaryPath}" must be a JSON object keyed by file path.`, 2);
}

// Istanbul json-summary keys are absolute file paths plus a "total"
// sentinel. We accept both an absolute "/.../packages/core/src/foo.ts"
// shape and the workspace-relative "packages/core/src/foo.ts" shape so
// older reporter outputs and bespoke fixtures match identically. The
// trailing slash on the path segment guards against a sibling
// directory whose name shares the same prefix (e.g. `packages/core`
// must not match `packages/core-extras`). CI runs on Linux only, so
// we rely on POSIX `/` separators.
const segment = `/${packagePath}/`;
const relativePrefix = `${packagePath}/`;

const matchedKeys = Object.keys(summary).filter((key) => {
  if (key === "total") return false;
  return key.includes(segment) || key.startsWith(relativePrefix);
});

if (matchedKeys.length === 0) {
  fatal(
    `ERROR: No coverage entries match package "${packagePath}" in "${summaryPath}".\n` +
      `       Ensure \`vitest run --coverage\` instrumented files under "${packagePath}/"\n` +
      `       and that the json-summary reporter is enabled in vitest.config.ts.`,
    2,
  );
}

const aggregate = (metric) => {
  let total = 0;
  let covered = 0;
  let skipped = 0;
  for (const key of matchedKeys) {
    const entry = summary[key];
    if (entry === null || typeof entry !== "object") continue;
    const slot = entry[metric];
    if (slot === null || typeof slot !== "object") continue;
    const t = Number(slot.total);
    const c = Number(slot.covered);
    const s = Number(slot.skipped);
    if (Number.isFinite(t)) total += t;
    if (Number.isFinite(c)) covered += c;
    if (Number.isFinite(s)) skipped += s;
  }
  const denom = total - skipped;
  // `pct` is for human-readable output only. The threshold comparison
  // below uses raw integer counts (`covered * 100 vs threshold * denom`)
  // to avoid floating-point boundary errors where ratios such as
  // 29 / 100 evaluate to 28.999999999999996 in IEEE 754 and would
  // false-fail at threshold = 29.
  const pct = denom > 0 ? (covered / denom) * 100 : 100;
  return { total, covered, skipped, denom, pct };
};

const fmtMetric = (m, name) =>
  `${name.padEnd(8)} ${m.pct.toFixed(2).padStart(6)} %  (covered ${m.covered}/${m.denom})`;

const lines = aggregate("lines");
const branches = aggregate("branches");

// Reject a coverage summary where every matched entry has zero countable
// units across both metrics. The likely cause is a Vitest config that
// instruments no source under <package-path> (wrong `include` glob,
// stale `coverage.exclude`, or the package having no tests at all); the
// vacuous-pass otherwise hides the misconfiguration from the gate.
if (lines.total === 0 && branches.total === 0) {
  fatal(
    `ERROR: Package "${packagePath}" has zero countable units across ${matchedKeys.length} matched files.\n` +
      `       Likely cause: vitest config instrumented no source under "${packagePath}/" — check\n` +
      `       \`coverage.include\` in vitest.config.ts and that at least one test imports a source file.`,
    2,
  );
}

// Integer comparison: `pct < threshold` is equivalent to
// `covered * 100 < threshold * denom` when `denom > 0`, and avoids the
// false-fail surface that IEEE 754 introduces for ratios such as
// 29 / 100. When `denom === 0` the metric is vacuously satisfied.
const lineFail = lines.denom > 0 && lines.covered * 100 < threshold * lines.denom;
const branchFail = branches.denom > 0 && branches.covered * 100 < threshold * branches.denom;

if (lineFail || branchFail) {
  const failed = [];
  if (lineFail) failed.push(fmtMetric(lines, "lines"));
  if (branchFail) failed.push(fmtMetric(branches, "branches"));
  const passed = [];
  if (!lineFail) passed.push(fmtMetric(lines, "lines"));
  if (!branchFail) passed.push(fmtMetric(branches, "branches"));

  let message =
    `BLOCKED: Coverage below threshold for package "${packagePath}" (>= ${threshold} %).\n` +
    `  Failed:\n` +
    failed.map((l) => `    ${l}`).join("\n") +
    "\n";
  if (passed.length > 0) {
    message += `  Passing:\n` + passed.map((l) => `    ${l}`).join("\n") + "\n";
  }
  message +=
    `  Source: ${summaryPath}\n` +
    `  Files counted: ${matchedKeys.length}\n` +
    `  Raise coverage on "${packagePath}/" files or revisit the threshold via CI config.\n`;

  fatal(message, 1);
}

stderr.write(
  `OK: ${packagePath} ${fmtMetric(lines, "lines")} | ${fmtMetric(branches, "branches")} | ${matchedKeys.length} files | >= ${threshold} %\n`,
);
exit(0);
