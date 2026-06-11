#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors
//
// check-headers.mjs — enforce per-file license headers across the
// Community/Cloud boundary (docs/adr/010-licence-apache-2.md).
//
// Rules:
//   packages/** + apps/community-bot/**  -> Apache 2.0 header
//       // SPDX-License-Identifier: Apache-2.0
//       // Copyright <year> Sovri contributors
//   apps/cloud-api/**                    -> Proprietary header
//       // Proprietary — Sovri
// A proprietary file must NOT carry an Apache SPDX line (license leak), and an
// Apache file must carry both header lines within the first lines of the file.
//
// Contract:
//   node scripts/check-headers.mjs [--staged|--all]
//   --staged (default): scan staged source files (git diff --cached), reading
//                       the index blob so a partially-staged file is evaluated
//                       exactly as it will land in the commit.
//   --all:              scan every tracked source file (git ls-files).
//
// Exit codes: 0 ok | 1 header violation(s) | 2 usage / git error.
// All output is written to stderr; stdout stays empty.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { argv, exit, stderr } from "node:process";

const APACHE_DIRS = /^(packages\/|apps\/community-bot\/)/;
const CLOUD_DIRS = /^apps\/cloud-api\//;
const SOURCE_EXT = /\.(ts|tsx)$/;

// The header must sit at the very top; only the first lines are inspected.
const HEADER_SCAN_LINES = 5;
const APACHE_SPDX = /^\/\/ SPDX-License-Identifier: Apache-2\.0$/;
const APACHE_COPYRIGHT = /^\/\/ Copyright 20\d\d Sovri contributors$/;
const PROPRIETARY = /^\/\/ Proprietary — Sovri$/;

function fatal(message, code) {
  stderr.write(`${message}\n`);
  exit(code);
}

function git(args) {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.status !== 0) {
    fatal(`ERROR: git ${args.join(" ")} failed: ${res.stderr?.trim() ?? ""}`, 2);
  }
  return res.stdout;
}

function inScope(path) {
  return (APACHE_DIRS.test(path) || CLOUD_DIRS.test(path)) && SOURCE_EXT.test(path);
}

function listTargets(mode) {
  const raw =
    mode === "--all"
      ? git(["ls-files"])
      : git(["diff", "--cached", "--diff-filter=d", "--name-only"]);
  return raw.split("\n").filter(Boolean).filter(inScope);
}

function readContent(path, mode) {
  if (mode === "--all") {
    return readFileSync(path, "utf8");
  }
  // Read the staged blob from the index, not the working tree.
  const res = spawnSync("git", ["show", `:${path}`], { encoding: "utf8" });
  if (res.status !== 0) {
    fatal(`ERROR: git show :${path} failed: ${res.stderr?.trim() ?? ""}`, 2);
  }
  return res.stdout;
}

function checkFile(path, content) {
  const head = content.split(/\r?\n/).slice(0, HEADER_SCAN_LINES);

  if (CLOUD_DIRS.test(path)) {
    if (head.some((line) => APACHE_SPDX.test(line))) {
      return "Apache-2.0 header in proprietary apps/cloud-api/ (license leak)";
    }
    if (!head.some((line) => PROPRIETARY.test(line))) {
      return 'missing "// Proprietary — Sovri"';
    }
    return null;
  }

  // Apache surface: packages/** + apps/community-bot/**.
  if (!head.some((line) => APACHE_SPDX.test(line))) {
    return 'missing "// SPDX-License-Identifier: Apache-2.0"';
  }
  if (!head.some((line) => APACHE_COPYRIGHT.test(line))) {
    return 'missing "// Copyright <year> Sovri contributors"';
  }
  return null;
}

function main() {
  const mode = argv[2] ?? "--staged";
  if (mode !== "--staged" && mode !== "--all") {
    fatal(`Usage: node scripts/check-headers.mjs [--staged|--all] (got: ${mode})`, 2);
  }

  const targets = listTargets(mode);
  if (targets.length === 0) {
    exit(0);
  }

  const violations = [];
  for (const path of targets) {
    const reason = checkFile(path, readContent(path, mode));
    if (reason) {
      violations.push({ path, reason });
    }
  }

  if (violations.length > 0) {
    const lines = [
      `BLOCKED: ${violations.length} file(s) with a missing or wrong license header (ADR-010 boundary):`,
      ...violations.map((v) => `  ${v.path}: ${v.reason}`),
      "",
      "packages/** and apps/community-bot/** must start with:",
      "  // SPDX-License-Identifier: Apache-2.0",
      "  // Copyright <year> Sovri contributors",
      "apps/cloud-api/** must start with:",
      "  // Proprietary — Sovri",
      "",
      "Add the header to the listed file(s).",
    ];
    fatal(lines.join("\n"), 1);
  }

  stderr.write(`OK: ${targets.length} file(s) carry a valid license header.\n`);
  exit(0);
}

main();
