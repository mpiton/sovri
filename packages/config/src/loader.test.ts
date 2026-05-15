// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, loadConfig } from "./loader.js";
import { SovriConfigParseError, SovriConfigValidationError } from "./errors.js";
import { SovriConfigSchema } from "./types/SovriConfig.js";

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test-fixtures",
);

describe("loadConfig — file missing", () => {
  it("returns DEFAULT_CONFIG without throwing when no .sovri.yml exists at repoRoot", async () => {
    const root = path.join(FIXTURES_ROOT, "no-file");

    const cfg = await loadConfig(root);

    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("returns DEFAULT_CONFIG when repoRoot itself does not exist (ENOENT)", async () => {
    const root = path.join(FIXTURES_ROOT, "does-not-exist-anywhere");

    const cfg = await loadConfig(root);

    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("returns DEFAULT_CONFIG when repoRoot points at a regular file (ENOTDIR)", async () => {
    // valid-full/.sovri.yml is a regular file; using it as `repoRoot` makes
    // node:fs join ".sovri.yml" to a non-directory, surfacing ENOTDIR.
    const root = path.join(FIXTURES_ROOT, "valid-full", ".sovri.yml");

    const cfg = await loadConfig(root);

    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});

describe("loadConfig — empty or comment-only file", () => {
  it("returns DEFAULT_CONFIG when .sovri.yml is empty (zero bytes)", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-empty");

    const cfg = await loadConfig(root);

    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("returns DEFAULT_CONFIG when .sovri.yml contains only YAML comments", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-comments-only");

    const cfg = await loadConfig(root);

    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});

describe("loadConfig — valid YAML", () => {
  it("parses a minimal config (only llm) and applies schema defaults to the rest", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-minimal");

    const cfg = await loadConfig(root);

    expect(cfg.llm).toEqual({
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      apiKeySecret: "ANTHROPIC_API_KEY",
    });
    expect(cfg.review).toEqual({
      mode: "full",
      autoReviewDrafts: false,
      severityThreshold: "minor",
    });
    expect(cfg.ignores).toEqual([]);
    expect(cfg.limits).toEqual({
      maxFilesPerReview: 50,
      maxLinesPerReview: 5000,
    });
  });

  it("parses a full config preserving every overridden value", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-full");

    const cfg = await loadConfig(root);

    expect(cfg.llm.baseUrl).toBe("https://api.anthropic.com");
    expect(cfg.review.mode).toBe("strict");
    expect(cfg.review.autoReviewDrafts).toBe(true);
    expect(cfg.review.severityThreshold).toBe("major");
    expect(cfg.ignores).toEqual(["**/*.md", "dist/**"]);
    expect(cfg.limits.maxFilesPerReview).toBe(100);
    expect(cfg.limits.maxLinesPerReview).toBe(10000);
  });
});

describe("loadConfig — malformed YAML", () => {
  it("throws SovriConfigParseError with the underlying YAMLException in cause", async () => {
    const root = path.join(FIXTURES_ROOT, "malformed");

    await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigParseError);

    try {
      await loadConfig(root);
      expect.unreachable("loadConfig should have thrown");
    } catch (err) {
      if (!(err instanceof SovriConfigParseError)) throw err;
      expect(err.filePath.endsWith(".sovri.yml")).toBe(true);
      expect(err.filePath).toContain("malformed");
      expect(err.cause).toBeDefined();
    }
  });
});

describe("loadConfig — oversize file", () => {
  let oversizeDir: string;

  beforeAll(async () => {
    oversizeDir = await mkdtemp(path.join(tmpdir(), "sovri-cfg-oversize-"));
    // 80 KiB worth of harmless YAML comments — well above the 64 KiB limit
    // baked into loader.ts. Using a comment payload keeps the test isolated
    // from any anchor/alias parsing behaviour.
    const payload = "# pad\n".repeat((80 * 1024) / "# pad\n".length + 1);
    await writeFile(path.join(oversizeDir, ".sovri.yml"), payload, "utf8");
  });

  afterAll(async () => {
    await rm(oversizeDir, { recursive: true, force: true });
  });

  it("throws SovriConfigParseError when the file exceeds the byte limit", async () => {
    await expect(loadConfig(oversizeDir)).rejects.toBeInstanceOf(SovriConfigParseError);

    try {
      await loadConfig(oversizeDir);
      expect.unreachable("loadConfig should have thrown");
    } catch (err) {
      if (!(err instanceof SovriConfigParseError)) throw err;
      expect(err.cause).toBeInstanceOf(Error);
      if (err.cause instanceof Error) {
        expect(err.cause.message).toMatch(/bytes/);
      }
    }
  });
});

describe("loadConfig — schema violation", () => {
  it("throws SovriConfigValidationError when an unknown top-level key is present", async () => {
    const root = path.join(FIXTURES_ROOT, "schema-violation-unknown-key");

    try {
      await loadConfig(root);
      expect.unreachable("loadConfig should have thrown");
    } catch (err) {
      if (!(err instanceof SovriConfigValidationError)) throw err;
      expect(err.filePath).toContain("schema-violation-unknown-key");
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.cause).toBeDefined();
    }
  });

  it("throws SovriConfigValidationError when llm.provider is mistral (rejected by v0.1 .refine())", async () => {
    // mistral IS in the ProviderSchema enum but the v0.1 `.refine()` narrows
    // accepted providers to "anthropic" only, so this exercises the
    // refinement path rather than the enum-stage rejection.
    const root = path.join(FIXTURES_ROOT, "schema-violation-bad-provider");

    await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigValidationError);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("is itself a valid SovriConfig (idempotent round-trip through the schema)", () => {
    const reparsed = SovriConfigSchema.parse(DEFAULT_CONFIG);

    expect(reparsed).toEqual(DEFAULT_CONFIG);
  });

  it("targets Anthropic in v0.1 with an env-var name (never a raw secret)", () => {
    expect(DEFAULT_CONFIG.llm.provider).toBe("anthropic");
    expect(DEFAULT_CONFIG.llm.apiKeySecret).toMatch(/^[A-Z_][A-Z0-9_]*$/);
  });

  it("is deep-frozen so consumers cannot mutate the shared singleton", () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.llm)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.review)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.limits)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.ignores)).toBe(true);
  });
});
