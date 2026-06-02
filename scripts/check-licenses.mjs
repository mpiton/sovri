#!/usr/bin/env node
// scripts/check-licenses.mjs — License allowlist gate (#12).
//
// Reads `pnpm licenses list --json`, classifies every direct and
// transitive dependency against the allowlist (Apache-2.0, MIT,
// BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0, CC-BY-4.0,
// Python-2.0, Unlicense, BlueOak-1.0.0) and the deny-list (every AGPL/GPL/LGPL `*-only` /
// `*-or-later` variant declared by the dependency-review action
// allowlist), and exits non-zero on the first deny match.
// Non-SPDX strings (`Unknown`, `UNLICENSED`, `SEE LICENSE IN ...`,
// `Custom`, `UNDEFINED`) are denied — compliance review cannot proceed
// without a canonical identifier.
//
// Contract (issue #12):
//   node scripts/check-licenses.mjs [--input <pnpm-licenses-list.json>]
//
// The no-argument form invokes `pnpm licenses list --json` itself; the
// `--input` flag reads a pre-captured JSON file instead so the
// companion test harness can exercise fixtures without `node_modules/`.
//
// Exit codes:
//   0   Every package is on the allowlist (including satisfiable SPDX
//       compounds such as `(MIT OR Apache-2.0)`).
//   1   At least one package is denied (printed with name, version,
//       license, and install path on stderr).
//   2   Infrastructure error (pnpm spawn failure, malformed JSON,
//       unreadable file, unknown flag).
//
// Intended for the `supply-chain` CI job after
// `pnpm audit --audit-level=high`. No npm dependencies; node:builtins
// only. ESM via `.mjs`.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { argv, exit, stderr } from "node:process";

const USAGE = "Usage: node scripts/check-licenses.mjs [--input <pnpm-licenses-list.json>]";

const fatal = (message, code) => {
  const text = message.endsWith("\n") ? message : `${message}\n`;
  stderr.write(text);
  exit(code);
};

// Allowlist + deny-list mirror the `allow-licenses` / `deny-licenses`
// arguments of the `dependency-review-action` step verbatim. Treat both
// as exact-match sets of SPDX short identifiers; the SPDX-expression
// evaluator below handles compound expressions atom-by-atom.
const ALLOWED_LICENSES = new Set([
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
]);

const DENIED_LICENSES = new Set([
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
]);

// Catch the GPL family even when a package declares a non-canonical
// short form. The pattern intentionally has no trailing word boundary:
// real-world strings include `GPLv2`, `GPLv3`, `LGPLv3`, `GPL2`, `GPL3`
// (older npm packages predating SPDX 2.0), and the `\b` variant of the
// regex misses every one of them because the next character is a word
// char. Any string that *starts* with GPL/AGPL/LGPL is regulated
// copyleft — no permissive SPDX identifier in the allowlist begins with
// those letters, so this stays safe as a defense-in-depth backstop even
// if the explicit allowlist is edited.
const COPYLEFT_FAMILY = /^(?:A?GPL|LGPL)/i;

// Non-SPDX strings npm/pnpm emit. Each must be denied: a license review
// cannot proceed without a canonical identifier. The regex is anchored
// at the start so a real SPDX id whose name happens to embed one of
// these tokens is untouched.
const NON_DECLARED_LICENSE = /^(?:Unknown|UNLICENSED|SEE LICENSE IN |Custom|UNDEFINED)\b/i;

// SPDX-registered exception identifiers (SPDX License List 3.x). A
// `WITH <exception>` clause is only honoured when the exception token
// is a member of this set; otherwise the bucket is denied as a parse
// error. Without this check, `MIT WITH totally-made-up` (or
// `MIT WITH OR`) would parse as the bare `MIT` atom and pass the gate
// — the fail-closed contract requires us to reject the whole compound.
// Source: https://spdx.org/licenses/exceptions.html — keep alphabetised
// for diff legibility.
const SPDX_EXCEPTIONS = new Set([
  "389-exception",
  "Asterisk-exception",
  "Asterisk-linking-protocols-exception",
  "Autoconf-exception-2.0",
  "Autoconf-exception-3.0",
  "Autoconf-exception-generic",
  "Autoconf-exception-generic-3.0",
  "Autoconf-exception-macro",
  "Bison-exception-1.24",
  "Bison-exception-2.2",
  "Bootloader-exception",
  "CLISP-exception-2.0",
  "Classpath-exception-2.0",
  "DigiRule-FOSS-exception",
  "FLTK-exception",
  "Fawkes-Runtime-exception",
  "Font-exception-2.0",
  "GCC-exception-2.0",
  "GCC-exception-2.0-note",
  "GCC-exception-3.1",
  "GNAT-exception",
  "GNU-compiler-exception",
  "GPL-3.0-interface-exception",
  "GPL-3.0-linking-exception",
  "GPL-3.0-linking-source-exception",
  "GPL-CC-1.0",
  "GStreamer-exception-2005",
  "GStreamer-exception-2008",
  "KiCad-libraries-exception",
  "LGPL-3.0-linking-exception",
  "LLGPL",
  "LLVM-exception",
  "LZMA-exception",
  "Libtool-exception",
  "Linux-syscall-note",
  "Nokia-Qt-exception-1.1",
  "OCCT-exception-1.0",
  "OCaml-LGPL-linking-exception",
  "OpenJDK-assembly-exception-1.0",
  "PS-or-PDF-font-exception-20170817",
  "QPL-1.0-INRIA-2004-exception",
  "Qt-GPL-exception-1.0",
  "Qt-LGPL-exception-1.1",
  "Qwt-exception-1.0",
  "SHL-2.0-extension",
  "SHL-2.1",
  "SWI-exception",
  "Swift-exception",
  "Texinfo-exception",
  "UBDL-exception",
  "Universal-FOSS-exception-1.0",
  "WxWindows-exception-3.1",
  "cryptsetup-OpenSSL-exception",
  "eCos-exception-2.0",
  "erlang-otp-linking-exception",
  "fmt-exception",
  "freertos-exception-2.0",
  "gnu-javamail-exception",
  "i2p-gpl-java-exception",
  "libpri-OpenH323-exception",
  "mif-exception",
  "openvpn-openssl-exception",
  "romic-exception",
  "stunnel-exception",
  "u-boot-exception-2.0",
  "vsftpd-openssl-exception",
  "x11vnc-openssl-exception",
]);

// Maximum size of the `pnpm licenses list --json` stdout buffer. The
// real-world output for a large monorepo is well under 5 MiB; 64 MiB
// is a generous ceiling that surfaces overflow as a clean
// `result.error` rather than a corrupt parse.
const PNPM_MAX_STDOUT_BYTES = 64 * 1024 * 1024;

// Parse arguments.
const args = argv.slice(2);
let inputPath = null;
for (let i = 0; i < args.length; i += 1) {
  const flag = args[i];
  if (flag === "--input") {
    if (i + 1 >= args.length) {
      fatal(`ERROR: --input requires a path.\n${USAGE}`, 2);
    }
    inputPath = args[i + 1];
    i += 1;
  } else if (flag === "--help" || flag === "-h") {
    stderr.write(`${USAGE}\n`);
    exit(2);
  } else {
    fatal(`ERROR: Unknown argument "${flag}".\n${USAGE}`, 2);
  }
}

// Acquire JSON payload.
let rawOutput;
if (inputPath !== null) {
  try {
    rawOutput = readFileSync(inputPath, "utf8");
  } catch (err) {
    fatal(
      `ERROR: Cannot read --input file "${inputPath}": ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }
} else {
  // CI invokes us after `pnpm install --frozen-lockfile
  // --ignore-scripts`, so `pnpm` is on PATH and the store is populated.
  // No `--prod` filter — the CI step lists a single
  // `node scripts/check-licenses.mjs` with no flag, so we audit the
  // full installed graph (production + dev).
  const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: PNPM_MAX_STDOUT_BYTES,
  });
  if (result.error) {
    fatal(`ERROR: Failed to spawn "pnpm licenses list --json": ${result.error.message}`, 2);
  }
  // A signalled child has `status === null` and `signal !== null`. The
  // numeric-status guard below would not fire, so without this branch a
  // SIGTERMed pnpm with empty stdout falls through to the
  // "no packages to audit" vacuous pass and silently bypasses the
  // license gate. Reject any non-clean termination outright.
  if (result.signal !== null && result.signal !== undefined) {
    fatal(`ERROR: "pnpm licenses list --json" terminated by signal ${result.signal}.`, 2);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    const errOut = (result.stderr ?? "").trim();
    fatal(
      `ERROR: "pnpm licenses list --json" exited with code ${result.status}${errOut ? `:\n${errOut}` : "."}`,
      2,
    );
  }
  if (typeof result.status !== "number") {
    fatal(
      `ERROR: "pnpm licenses list --json" produced no exit status (status=${String(result.status)}, signal=${String(result.signal)}).`,
      2,
    );
  }
  rawOutput = result.stdout ?? "";
}

// `pnpm licenses list --prod` emits a plain "No licenses in packages
// found" sentinel (not JSON) when the install has no production
// packages — and pnpm 10 may emit an empty stdout for a brand-new
// workspace. Treat both as a vacuous pass.
const trimmedOutput = rawOutput.trim();
if (trimmedOutput.length === 0 || trimmedOutput === "No licenses in packages found") {
  stderr.write("OK: pnpm reported no packages to audit.\n");
  exit(0);
}

let parsed;
try {
  parsed = JSON.parse(trimmedOutput);
} catch (err) {
  fatal(
    `ERROR: pnpm output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    2,
  );
}

if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
  fatal(`ERROR: pnpm output must be a JSON object keyed by license.`, 2);
}

// SPDX expression evaluator.
//
// `pnpm licenses list --json` keys each bucket by the literal license
// string declared in the package's `package.json`. That string can be:
//   - a single SPDX short identifier (`MIT`, `Apache-2.0`),
//   - a parenthesised dual licence (`(MIT OR Apache-2.0)`),
//   - a bare compound (`MIT OR GPL-2.0`),
//   - a conjunctive expression (`MIT AND BSD-3-Clause`),
//   - an exception clause (`Apache-2.0 WITH LLVM-exception`),
//   - a `+` suffix meaning "or any later version" (`LGPL-2.1+`),
//   - a non-SPDX free-form string (`Unknown`, `UNLICENSED`,
//     `SEE LICENSE IN LICENSE.md`).
//
// We implement the subset of SPDX 2.3 Annex D semantics that
// `pnpm licenses list` can plausibly emit:
//   - OR  : satisfied if any branch is on the allowlist (recipient
//           picks one — SPDX 2.3 §D.5).
//   - AND : satisfied if every branch is on the allowlist (recipient
//           must satisfy all simultaneously — SPDX 2.3 §D.6).
//   - parentheses : grouping (AND binds tighter than OR by default).
//   - WITH : the licence atom is the licence, the exception identifier
//           is consumed but ignored for the allowlist decision.
//   - `+`  : kept on the atom for denylist matching; otherwise stripped
//           so `LGPL-2.1+` still hits COPYLEFT_FAMILY and is denied.
//
// Anything we cannot evaluate falls closed — `parseExpression` builds
// `{type: "fail", reason}` subtrees and `classifyLicense` rejects the
// bucket if any subtree carries a fail node, even when an evaluator
// short-circuit would otherwise hide it.

const tokenize = (expr) => {
  const tokens = [];
  let buf = "";
  const flush = () => {
    if (buf.length > 0) {
      tokens.push(buf);
      buf = "";
    }
  };
  for (const ch of expr) {
    if (ch === "(" || ch === ")") {
      flush();
      tokens.push(ch);
    } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      flush();
    } else {
      buf += ch;
    }
  }
  flush();
  return tokens;
};

const classifyAtom = (atom) => {
  // Strip a trailing `+` ("or later") for allowlist lookup but evaluate
  // both raw and base form against the denylist so a legacy
  // `LGPL-2.1+` still trips the copyleft guard even though SPDX 2.3
  // deprecated the `+` operator in favour of `-or-later`.
  const base = atom.endsWith("+") ? atom.slice(0, -1) : atom;
  if (DENIED_LICENSES.has(atom) || DENIED_LICENSES.has(base)) {
    return { satisfied: false, reason: `denied license: ${atom}` };
  }
  if (COPYLEFT_FAMILY.test(base)) {
    return { satisfied: false, reason: `copyleft family: ${atom}` };
  }
  if (ALLOWED_LICENSES.has(base)) return { satisfied: true };
  return { satisfied: false, reason: `not on allowlist: ${atom}` };
};

const peek = (state) => state.tokens[state.pos];
const advance = (state) => {
  if (state.pos >= state.tokens.length) return undefined;
  const token = state.tokens[state.pos];
  state.pos += 1;
  return token;
};

const parseAtom = (state) => {
  const tok = advance(state);
  if (tok === undefined) {
    return { type: "fail", reason: "unexpected end of license expression" };
  }
  if (tok === "(") {
    const inner = parseExpr(state);
    const close = advance(state);
    if (close !== ")") {
      return { type: "fail", reason: 'missing ")" in license expression' };
    }
    return inner;
  }
  if (tok === ")") {
    return { type: "fail", reason: 'unexpected ")"' };
  }
  // `WITH <exception>` keeps the licence atom for the allowlist
  // decision (exceptions modify allocation terms but cannot promote a
  // permissive licence to copyleft), but only when the exception token
  // is a known SPDX-registered identifier. Without the membership
  // check, `MIT WITH totally-made-up` and `MIT WITH OR` would parse as
  // the bare `MIT` atom and pass the gate — the fail-closed contract
  // requires denying any unrecognised exception.
  const next = peek(state);
  if (next !== undefined && next.toUpperCase() === "WITH") {
    advance(state);
    const exception = advance(state);
    if (exception === undefined) {
      return { type: "fail", reason: `dangling WITH after "${tok}"` };
    }
    if (!SPDX_EXCEPTIONS.has(exception)) {
      return {
        type: "fail",
        reason: `unknown SPDX exception after WITH: ${exception}`,
      };
    }
    return { type: "atom", value: tok };
  }
  return { type: "atom", value: tok };
};

const parseAnd = (state) => {
  let left = parseAtom(state);
  while (peek(state) !== undefined && peek(state).toUpperCase() === "AND") {
    advance(state);
    const right = parseAtom(state);
    left = { type: "and", left, right };
  }
  return left;
};

const parseExpr = (state) => {
  let left = parseAnd(state);
  while (peek(state) !== undefined && peek(state).toUpperCase() === "OR") {
    advance(state);
    const right = parseAnd(state);
    left = { type: "or", left, right };
  }
  return left;
};

const parseExpression = (tokens) => {
  const state = { tokens, pos: 0 };
  const node = parseExpr(state);
  if (state.pos !== tokens.length) {
    return {
      type: "fail",
      reason: `trailing tokens in license expression: ${tokens.slice(state.pos).join(" ")}`,
    };
  }
  return node;
};

// Walk the parse tree and collect the first failure reason encountered,
// regardless of whether evalNode's OR short-circuit would have hidden
// it. The header contract guarantees parse errors fail closed, so an
// expression like `MIT OR <malformed-right>` must deny even though
// MIT alone would have satisfied.
const collectParseFailure = (node) => {
  if (node.type === "fail") return node.reason;
  if (node.type === "atom") return null;
  return collectParseFailure(node.left) ?? collectParseFailure(node.right);
};

const evalNode = (node) => {
  if (node.type === "atom") return classifyAtom(node.value);
  if (node.type === "or") {
    const left = evalNode(node.left);
    if (left.satisfied) return { satisfied: true };
    const right = evalNode(node.right);
    if (right.satisfied) return { satisfied: true };
    return {
      satisfied: false,
      reason: `OR has no allowed branch (${left.reason}; ${right.reason})`,
    };
  }
  if (node.type === "and") {
    const left = evalNode(node.left);
    if (!left.satisfied) {
      return { satisfied: false, reason: `AND fails on left: ${left.reason}` };
    }
    const right = evalNode(node.right);
    if (!right.satisfied) {
      return { satisfied: false, reason: `AND fails on right: ${right.reason}` };
    }
    return { satisfied: true };
  }
  return { satisfied: false, reason: node.reason ?? "unparseable expression" };
};

const classifyLicense = (licenseStr) => {
  if (typeof licenseStr !== "string" || licenseStr.length === 0) {
    return { satisfied: false, reason: "missing license field" };
  }
  const trimmed = licenseStr.trim();
  if (NON_DECLARED_LICENSE.test(trimmed)) {
    return { satisfied: false, reason: `non-SPDX license string: ${trimmed}` };
  }
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return { satisfied: false, reason: "empty license expression" };
  }
  const node = parseExpression(tokens);
  const parseFailure = collectParseFailure(node);
  if (parseFailure !== null) {
    return { satisfied: false, reason: `parse error: ${parseFailure}` };
  }
  return evalNode(node);
};

// Memoize verdicts so a workspace with thousands of MIT packages still
// classifies each unique license string once.
const verdictCache = new Map();
const verdictFor = (licenseStr) => {
  const cached = verdictCache.get(licenseStr);
  if (cached !== undefined) return cached;
  const verdict = classifyLicense(licenseStr);
  verdictCache.set(licenseStr, verdict);
  return verdict;
};

const toOffender = (entry, bucketKey, reason) => {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { name: "<malformed entry>", version: "", license: bucketKey, path: "", reason };
  }
  const name = typeof entry.name === "string" ? entry.name : "<unnamed>";
  const versions = Array.isArray(entry.versions) ? entry.versions : [];
  const version =
    versions.length > 0 && versions.every((v) => typeof v === "string") ? versions.join(", ") : "";
  const paths = Array.isArray(entry.paths) ? entry.paths : [];
  const path = paths.length > 0 && typeof paths[0] === "string" ? paths[0] : "";
  const license =
    typeof entry.license === "string" && entry.license.length > 0 ? entry.license : bucketKey;
  return { name, version, license, path, reason };
};

// Iterate every license bucket; collect violations. Each entry is
// classified against BOTH the bucket key and its own `license` field so
// a hypothetical pnpm misgrouping (entry's declared license disagrees
// with the bucket it lives in) cannot smuggle a denied package through.
const offenders = [];
let scannedPackages = 0;
const licenseKeys = Object.keys(parsed);

for (const bucketKey of licenseKeys) {
  const entries = parsed[bucketKey];
  if (!Array.isArray(entries)) {
    fatal(
      `ERROR: pnpm bucket "${bucketKey}" is not an array (got ${entries === null ? "null" : typeof entries}).`,
      2,
    );
  }
  const bucketVerdict = verdictFor(bucketKey);
  for (const entry of entries) {
    scannedPackages += 1;
    if (!bucketVerdict.satisfied) {
      offenders.push(toOffender(entry, bucketKey, bucketVerdict.reason));
      continue;
    }
    const entryLicense =
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.license === "string"
        ? entry.license
        : null;
    if (entryLicense !== null && entryLicense !== bucketKey) {
      const entryVerdict = verdictFor(entryLicense);
      if (!entryVerdict.satisfied) {
        offenders.push(
          toOffender(
            entry,
            bucketKey,
            `entry license disagrees with bucket and is denied: ${entryVerdict.reason}`,
          ),
        );
      }
    }
  }
}

if (offenders.length > 0) {
  const lines = [
    `BLOCKED: ${offenders.length} package(s) violate the license allowlist.`,
    `  Allowlist: ${[...ALLOWED_LICENSES].join(", ")}`,
    `  Denied family: AGPL/GPL/LGPL (any version) + Unknown / UNLICENSED / SEE LICENSE`,
    `  Offenders:`,
  ];
  for (const offender of offenders) {
    lines.push(`    - ${offender.name}${offender.version ? `@${offender.version}` : ""}`);
    lines.push(`        license: ${offender.license}`);
    lines.push(`        reason : ${offender.reason}`);
    if (offender.path) lines.push(`        path   : ${offender.path}`);
  }
  lines.push(`  Fix: replace the offending dependency or pin a permissive-licensed alternative.`);
  fatal(lines.join("\n"), 1);
}

stderr.write(
  `OK: ${scannedPackages} package(s) across ${licenseKeys.length} license bucket(s) — all on allowlist.\n`,
);
exit(0);
