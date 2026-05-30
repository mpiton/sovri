// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Documentation-contract test for CHANGELOG.md. The Community changelog is a
// monorepo-wide document owned by no single package, so this acceptance test lives at
// the repository root (tests/) rather than under any packages/* tree.
//
// It is a pure, deterministic read of the versioned CHANGELOG.md — no network, no
// adapters, no shipped parser module (every helper stays inline here). @nominal cases
// assert the real file; @violation cases feed synthetic section strings to the same
// helpers, proving the contract rejects what it should.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const changelogPath = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
const changelog = readFileSync(changelogPath, "utf8");

// Keep a Changelog 1.1.0 category set.
const KEEP_A_CHANGELOG_CATEGORIES = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
] as const;

// Conventional Commit types accepted on a changelog entry (R-02). Mirrors the allowed-types
// list published in CONTRIBUTING.md; keep the two in sync.
const ALLOWED_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "ci",
  "perf",
  "build",
] as const;

// The v0.3 scopes that MUST all appear under [Unreleased] -> Added (R-02).
const REQUIRED_V03_SCOPES = [
  "feat(compliance)",
  "feat(core)",
  "feat(review-engine)",
  "docs(adr)",
] as const;

// Files unversioned from an external contributor's point of view (R-03).
const FORBIDDEN_INTERNAL_DOCS = ["CLAUDE.md", "PRD.md", "ARCHI.md"] as const;

// "- `<type>(<scope>)`: <summary>" — the lead of a well-formed entry's first line. The scope
// character class matches CONVENTIONAL_PREFIX so a documented slashed scope (e.g.
// `chore(deps/ci)`) is accepted here too, not only in the whole-section check.
const SCOPE_PREFIX = /^- `([a-z]+)\(([a-z0-9/._-]+)\)`:\s*(.*)$/;

// A valid Conventional Commit lead for ANY [Unreleased] entry, in any category. The scope
// is optional (type-only commits like `test:` are valid) and may contain "/" (e.g.
// `chore(deps/ci)`), so this is deliberately looser than SCOPE_PREFIX, which the v0.3
// feature entries under Added are additionally held to.
const CONVENTIONAL_PREFIX = /^- `([a-z]+)(?:\([a-z0-9/._-]+\))?`:\s/;

// --- inline helpers (no shipped parser) ---

/** Body of a top-level "## <heading>" section, up to the next "## " heading. */
function sectionBody(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const unreleased = sectionBody(changelog, "[Unreleased]");

/** "### " subsection headings within a section body. */
function categoryHeadings(body: string): string[] {
  return [...body.matchAll(/^### (.+)$/gm)].map((m) => (m[1] ?? "").trim());
}

/** Body of a "### <name>" subsection, up to the next "### " heading or the end. */
function subsection(body: string, name: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l === `### ${name}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("### "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** Full top-level bullets ("- " at column 0), each including its continuation lines. */
function splitBullets(block: string): string[] {
  const bullets: string[] = [];
  let current: string[] | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("- ")) {
      if (current) bullets.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) bullets.push(current.join("\n"));
  return bullets;
}

const addedBullets = splitBullets(subsection(unreleased, "Added"));
const addedFirstLines = addedBullets.map((b) => b.split("\n")[0] ?? "");

// First lines of every top-level bullet in [Unreleased], across all categories.
const unreleasedFirstLines = splitBullets(unreleased).map((b) => b.split("\n")[0] ?? "");

/** The "`<type>(<scope>)`" tokens used by the Added entries. */
function addedScopes(): string[] {
  return addedFirstLines.flatMap((line) => {
    const m = SCOPE_PREFIX.exec(line);
    return m ? [`${m[1]}(${m[2]})`] : [];
  });
}

/** Forbidden internal-doc tokens present in an arbitrary block. */
function forbiddenHits(block: string): string[] {
  return FORBIDDEN_INTERNAL_DOCS.filter((token) => block.includes(token));
}

/** A first-line summary that is nothing but an issue / task reference. */
function isBareRef(summary: string): boolean {
  const stripped = summary
    .replace(/\(#\d+\)|#\d+/g, "")
    .replace(/\(task-\d+\)|task-\d+/gi, "")
    .replace(/[\s,().;:-]/g, "");
  return stripped.length === 0;
}

describe("CHANGELOG [Unreleased] documents the v0.3 Compliance Trail set (#1968)", () => {
  // --- R-01: Keep a Changelog 1.1.0 format ---

  it("@nominal exposes exactly one ### Added subsection with only allowed categories", () => {
    // When the category subsections of [Unreleased] are collected
    const categories = categoryHeadings(unreleased);
    // Then there is exactly one "### Added" subsection
    expect(categories.filter((c) => c === "Added")).toHaveLength(1);
    // And every "### " heading is one of the Keep a Changelog categories
    for (const category of categories) {
      expect(KEEP_A_CHANGELOG_CATEGORIES).toContain(category);
    }
  });

  it("@nominal links the Keep a Changelog and SemVer references in the header", () => {
    expect(changelog).toContain("https://keepachangelog.com/en/1.1.0/");
    expect(changelog).toContain("https://semver.org/spec/v2.0.0.html");
  });

  it("@violation rejects a subsection under an unrecognised category", () => {
    // Given a synthetic Unreleased section whose only subsection heading is "### Notes"
    const synthetic = "### Notes\n\n- `feat(core)`: a change\n";
    // When its category headings are validated against the Keep a Changelog set
    const unknown = categoryHeadings(synthetic).filter(
      (c) => !(KEEP_A_CHANGELOG_CATEGORIES as readonly string[]).includes(c),
    );
    // Then validation fails because "Notes" is not an allowed category
    expect(unknown).toContain("Notes");
  });

  // --- R-02: Conventional Commit scopes (docs(adr) is the RED trigger) ---

  it("@nominal every [Unreleased] entry, in any category, has a Conventional Commit prefix", () => {
    // Scope coverage below is asserted on Added, but the prefix contract holds for the
    // whole section — including type-only leads (`test:`) and slashed scopes (`chore(deps/ci)`).
    for (const line of unreleasedFirstLines) {
      const match = CONVENTIONAL_PREFIX.exec(line);
      expect(match, `entry has no Conventional Commit prefix: ${line}`).not.toBeNull();
      expect(ALLOWED_TYPES).toContain(match?.[1]);
    }
  });

  it("@nominal every Added entry begins with a backticked Conventional Commit scope", () => {
    for (const line of addedFirstLines) {
      const match = SCOPE_PREFIX.exec(line);
      expect(match, `entry is not scope-prefixed: ${line}`).not.toBeNull();
      expect(ALLOWED_TYPES).toContain(match?.[1]);
    }
  });

  it.each(REQUIRED_V03_SCOPES)(
    "@nominal required v0.3 scope %s is present under Added",
    (scope) => {
      // When the set of scope prefixes used in Added is collected
      // Then it contains at least one entry for the required scope
      expect(addedScopes()).toContain(scope);
    },
  );

  it("@nominal the docs(adr) entry records both ADR-013 and ADR-014", () => {
    const entry = addedBullets.find((b) => b.startsWith("- `docs(adr)`"));
    expect(entry, "no docs(adr) entry under Added").toBeDefined();
    expect(entry).toContain("ADR-013");
    expect(entry).toContain("ADR-014");
  });

  it("@violation rejects an Added entry with no Conventional Commit scope", () => {
    // Given a synthetic Added bullet without a scope prefix
    const bullet = "- added a new thing for the trail";
    // Then it does not match the scope-prefix contract
    expect(SCOPE_PREFIX.test(bullet)).toBe(false);
  });

  // --- R-03: no references to unversioned internal docs ---

  it("@nominal no [Unreleased] entry references an internal planning file", () => {
    // When the section is scanned for CLAUDE.md / PRD.md / ARCHI.md
    // Then none of them appear
    expect(forbiddenHits(unreleased)).toEqual([]);
  });

  it.each(FORBIDDEN_INTERNAL_DOCS)(
    "@violation rejects an entry citing the internal file %s",
    (forbidden) => {
      // Given a synthetic Unreleased section that cites a forbidden internal file
      const synthetic = `${unreleased}\n- \`docs(x)\`: see ${forbidden} for details\n`;
      // Then the scan flags that token
      expect(forbiddenHits(synthetic)).toContain(forbidden);
    },
  );

  it("@nominal allows an entry that references a versioned ADR path", () => {
    // Given a synthetic bullet that cites a versioned docs/adr path
    const synthetic = "- `docs(adr)`: see docs/adr/013 for the rationale";
    // Then the forbidden-token scan passes
    expect(forbiddenHits(synthetic)).toEqual([]);
  });

  // --- R-04: self-sufficient entries ---

  it("@nominal every Added entry has a prose summary, never a bare reference", () => {
    for (const bullet of addedBullets) {
      const firstLine = bullet.split("\n")[0] ?? "";
      const match = SCOPE_PREFIX.exec(firstLine);
      expect(match, `entry is not scope-prefixed: ${firstLine}`).not.toBeNull();
      // The whole bullet, minus its scope prefix, is the self-sufficient summary.
      const summary = bullet.replace(SCOPE_PREFIX, "$3").replace(/\s+/g, " ").trim();
      expect(summary.length, `summary too short: ${firstLine}`).toBeGreaterThanOrEqual(12);
      // No entry's first line consists solely of a "#<n>" or "(task-NN)" reference.
      expect(isBareRef(match?.[3] ?? ""), `bare reference: ${firstLine}`).toBe(false);
    }
  });

  it("@nominal the docs(adr) entry names both ADR subjects so it stands alone", () => {
    const entry = addedBullets.find((b) => b.startsWith("- `docs(adr)`"));
    expect(entry, "no docs(adr) entry under Added").toBeDefined();
    expect(entry).toMatch(/ADR-013/);
    expect(entry).toMatch(/ADR-014/);
  });

  it("@violation rejects a bare-reference Added entry", () => {
    // Given a synthetic Added bullet that is only an issue reference
    const firstLine = "- `feat(core)`: #1942";
    const match = SCOPE_PREFIX.exec(firstLine);
    expect(match).not.toBeNull();
    // Then it is flagged as a bare reference
    expect(isBareRef(match?.[3] ?? "")).toBe(true);
  });
});
