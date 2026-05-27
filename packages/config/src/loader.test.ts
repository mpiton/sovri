// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { execFile } from "node:child_process";
import { type FileHandle, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted; wrapping `open` in `vi.fn(actual.open)` lets a
// per-test `mockRejectedValueOnce(...)` simulate I/O errors at open() time
// while every other test continues to hit the real filesystem. The
// `beforeEach` below restores the real implementation between tests so a
// stray `mockRejectedValue` (without `Once`) can never bleed into the next
// test.
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, open: vi.fn(actual.open) };
});

import { open as mockedOpen } from "node:fs/promises";

const { open: realOpen } =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

beforeEach(() => {
  vi.mocked(mockedOpen).mockReset();
  vi.mocked(mockedOpen).mockImplementation(realOpen);
});

import { DEFAULT_CONFIG, loadConfig } from "./loader.js";
import {
  SovriConfigParseError,
  SovriConfigSymlinkError,
  SovriConfigValidationError,
} from "./errors.js";
import { SovriConfigSchema } from "./types/SovriConfig.js";

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test-fixtures",
);

describe("loadConfig — invalid repoRoot", () => {
  it("throws TypeError when repoRoot is an empty string", async () => {
    await expect(loadConfig("")).rejects.toBeInstanceOf(TypeError);

    try {
      await loadConfig("");
      expect.unreachable("loadConfig should have thrown TypeError");
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      expect(err.message).toMatch(/repoRoot/);
    }
  });

  it("throws TypeError when repoRoot is a relative path", async () => {
    await expect(loadConfig("./relative/path")).rejects.toBeInstanceOf(TypeError);

    try {
      await loadConfig("./relative/path");
      expect.unreachable("loadConfig should have thrown TypeError");
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      expect(err.message).toMatch(/absolute/i);
    }
  });

  it("throws TypeError when repoRoot is a parent-traversal relative path", async () => {
    await expect(loadConfig("../traversal")).rejects.toBeInstanceOf(TypeError);
  });

  it("throws TypeError when repoRoot is absolute but contains parent-traversal segments", async () => {
    // /a/../etc passes path.isAbsolute but path.join normalizes it to /etc,
    // letting the loader read outside the caller's intended directory.
    await expect(loadConfig("/a/../etc")).rejects.toBeInstanceOf(TypeError);

    try {
      await loadConfig("/a/../etc");
      expect.unreachable("loadConfig should have thrown TypeError");
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      expect(err.message).toMatch(/normalized/i);
    }
  });

  it("throws TypeError when repoRoot is absolute but contains current-directory segments", async () => {
    await expect(loadConfig("/a/./b")).rejects.toBeInstanceOf(TypeError);
  });

  it("throws TypeError when repoRoot is absolute but contains duplicate separators", async () => {
    await expect(loadConfig("/a//b")).rejects.toBeInstanceOf(TypeError);
  });
});

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
    expect(cfg.review.mode).toBe("bugs-only");
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

describe("loadConfig — I/O errors at open()", () => {
  it("propagates non-missing-file errors raised during open (e.g. EACCES)", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-minimal");
    const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    vi.mocked(mockedOpen).mockRejectedValueOnce(eacces);

    await expect(loadConfig(root)).rejects.toMatchObject({ code: "EACCES" });
  });
});

describe("loadConfig — I/O errors after open()", () => {
  it("propagates errors raised during fd.stat()", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-minimal");
    const eio = Object.assign(new Error("EIO: input/output error"), { code: "EIO" });
    const closeMock = vi.fn<FileHandle["close"]>().mockResolvedValue(undefined);
    vi.mocked(mockedOpen).mockResolvedValueOnce({
      stat: vi.fn<FileHandle["stat"]>().mockRejectedValueOnce(eio),
      readFile: vi.fn<FileHandle["readFile"]>(),
      close: closeMock,
    } as unknown as FileHandle);

    await expect(loadConfig(root)).rejects.toMatchObject({ code: "EIO" });
    expect(closeMock).toHaveBeenCalledOnce();
  });

  it("propagates errors raised during fd.readFile() and still closes the fd", async () => {
    const root = path.join(FIXTURES_ROOT, "valid-minimal");
    const eio = Object.assign(new Error("EIO: input/output error"), { code: "EIO" });
    const closeMock = vi.fn<FileHandle["close"]>().mockResolvedValue(undefined);
    vi.mocked(mockedOpen).mockResolvedValueOnce({
      stat: vi.fn<FileHandle["stat"]>().mockResolvedValue({
        size: 100,
        isFile: () => true,
      } as unknown as import("node:fs").Stats),
      readFile: vi.fn<FileHandle["readFile"]>().mockRejectedValueOnce(eio),
      close: closeMock,
    } as unknown as FileHandle);

    await expect(loadConfig(root)).rejects.toMatchObject({ code: "EIO" });
    expect(closeMock).toHaveBeenCalledOnce();
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

// `symlink()` on Windows requires SeCreateSymbolicLinkPrivilege (admin or
// Developer Mode) and CI runners lack it. The production threat model is
// Linux Docker (community-bot runs distroless Linux), so POSIX coverage is
// the safety net that matters; the `lstat` check still runs on Windows at
// runtime, this `describe` only skips test creation.
describe.skipIf(process.platform === "win32")(
  "loadConfig — symlink rejection (issue #1744)",
  () => {
    let symlinkDir: string;
    let externalTargetDir: string;

    beforeAll(async () => {
      symlinkDir = await mkdtemp(path.join(tmpdir(), "sovri-cfg-symlink-"));
      externalTargetDir = await mkdtemp(path.join(tmpdir(), "sovri-cfg-symlink-target-"));

      // Stand-in for `/etc/passwd` or a private key — kept inside the test
      // tmpdir so the test does not depend on host-file readability.
      await writeFile(
        path.join(externalTargetDir, "secret.txt"),
        "SENSITIVE_HOST_CONTENT\n",
        "utf8",
      );

      // Case A: .sovri.yml → /tmp/<external>/secret.txt (out-of-repo).
      const externalCase = path.join(symlinkDir, "case-external");
      await mkdir(externalCase, { recursive: true });
      await symlink(
        path.join(externalTargetDir, "secret.txt"),
        path.join(externalCase, ".sovri.yml"),
      );

      // Case B: .sovri.yml → sibling actual.yml (intra-repo, still rejected).
      const intraDir = path.join(symlinkDir, "case-intra");
      await mkdir(intraDir, { recursive: true });
      await writeFile(
        path.join(intraDir, "actual.yml"),
        "llm:\n  provider: anthropic\n  model: claude-3-5-sonnet-latest\n  apiKeySecret: ANTHROPIC_API_KEY\n",
        "utf8",
      );
      await symlink(path.join(intraDir, "actual.yml"), path.join(intraDir, ".sovri.yml"));

      // Case C: dangling symlink (target does not exist).
      const danglingDir = path.join(symlinkDir, "case-dangling");
      await mkdir(danglingDir, { recursive: true });
      await symlink(
        path.join(danglingDir, "does-not-exist.yml"),
        path.join(danglingDir, ".sovri.yml"),
      );

      // Case D: regular file (negative control).
      const regularDir = path.join(symlinkDir, "case-regular");
      await mkdir(regularDir, { recursive: true });
      await writeFile(
        path.join(regularDir, ".sovri.yml"),
        "llm:\n  provider: anthropic\n  model: claude-3-5-sonnet-latest\n  apiKeySecret: ANTHROPIC_API_KEY\n",
        "utf8",
      );

      // Case E: .sovri.yml is itself a directory (regression for L1 finding).
      const dirAsConfigDir = path.join(symlinkDir, "case-directory");
      await mkdir(path.join(dirAsConfigDir, ".sovri.yml"), { recursive: true });
    });

    afterAll(async () => {
      await rm(symlinkDir, { recursive: true, force: true });
      await rm(externalTargetDir, { recursive: true, force: true });
    });

    it("rejects .sovri.yml that symlinks to an out-of-repo file", async () => {
      const root = path.join(symlinkDir, "case-external");

      await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigSymlinkError);

      try {
        await loadConfig(root);
        expect.unreachable("loadConfig should have thrown SovriConfigSymlinkError");
      } catch (err) {
        if (!(err instanceof SovriConfigSymlinkError)) throw err;
        expect(err.name).toBe("SovriConfigSymlinkError");
        expect(err.filePath.endsWith(".sovri.yml")).toBe(true);
        expect(err.filePath).toContain("case-external");
        // Critical: no `cause` chain means no file-fragment disclosure vector.
        expect(err.cause).toBeUndefined();
      }
    });

    it("rejects .sovri.yml that symlinks to a sibling file inside the same repo", async () => {
      // Policy: ALL symlinks rejected, including intra-repo. Simpler audit
      // story than realpath+containment; legitimate `.sovri.yml` symlink use
      // cases are not observed in the wild and would be surprising to a
      // reviewer reading a malicious repo.
      const root = path.join(symlinkDir, "case-intra");

      await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigSymlinkError);
    });

    it("rejects a dangling symlink rather than treating it as a missing file", async () => {
      // Without lstat, a dangling symlink would surface as ENOENT at open()
      // and return DEFAULT_CONFIG silently — masking the malicious intent.
      const root = path.join(symlinkDir, "case-dangling");

      await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigSymlinkError);
    });

    it("loads normally when .sovri.yml is a regular file (negative control)", async () => {
      const root = path.join(symlinkDir, "case-regular");

      const cfg = await loadConfig(root);

      expect(cfg.llm.provider).toBe("anthropic");
    });

    it("rejects .sovri.yml that is itself a directory with SovriConfigParseError", async () => {
      // Without the !isFile() guard, this would surface as a raw EISDIR at
      // readFile() time — undocumented and untyped (L1 finding).
      const root = path.join(symlinkDir, "case-directory");

      await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigParseError);

      try {
        await loadConfig(root);
        expect.unreachable("loadConfig should have thrown SovriConfigParseError");
      } catch (err) {
        if (!(err instanceof SovriConfigParseError)) throw err;
        expect(err.filePath).toContain("case-directory");
        // cause is a sanitized Error (no host-file content), not a YAMLException.
        expect(err.cause).toBeInstanceOf(Error);
        if (err.cause instanceof Error) {
          expect(err.cause.message).toMatch(/regular file/i);
        }
      }
    });

    it("returns DEFAULT_CONFIG when open() races to ENOENT after lstat (TOCTOU disappearance)", async () => {
      // Simulates the file vanishing between lstat (which saw a regular
      // file) and open() (which now sees nothing). Per contract, missing
      // file → DEFAULT_CONFIG, not raw ENOENT.
      const root = path.join(symlinkDir, "case-regular");
      const enoent = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      vi.mocked(mockedOpen).mockRejectedValueOnce(enoent);

      const cfg = await loadConfig(root);

      expect(cfg).toEqual(DEFAULT_CONFIG);
    });

    it("returns DEFAULT_CONFIG when open() races to ENOTDIR after lstat", async () => {
      const root = path.join(symlinkDir, "case-regular");
      const enotdir = Object.assign(new Error("ENOTDIR: not a directory"), { code: "ENOTDIR" });
      vi.mocked(mockedOpen).mockRejectedValueOnce(enotdir);

      const cfg = await loadConfig(root);

      expect(cfg).toEqual(DEFAULT_CONFIG);
    });

    it("throws SovriConfigParseError when fd.stat() reveals a non-regular file (TOCTOU type-flip)", async () => {
      // Simulates the file morphing into a directory/FIFO between lstat
      // and open. fd.stat().isFile() returns false; the loader must
      // promote to the typed contract before readFile() surfaces raw EISDIR.
      const root = path.join(symlinkDir, "case-regular");
      const closeMock = vi.fn<FileHandle["close"]>().mockResolvedValue(undefined);
      const fakeDirStats = {
        size: 100,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      } as unknown as import("node:fs").Stats;
      vi.mocked(mockedOpen).mockResolvedValueOnce({
        stat: vi.fn<FileHandle["stat"]>().mockResolvedValue(fakeDirStats),
        readFile: vi.fn<FileHandle["readFile"]>(),
        close: closeMock,
      } as unknown as FileHandle);

      await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigParseError);
      expect(closeMock).toHaveBeenCalledOnce();
    });

    it("maps ELOOP from O_NOFOLLOW open() to SovriConfigSymlinkError (TOCTOU defense)", async () => {
      // Force the open() path even though lstat succeeds on a regular file:
      // simulates a TOCTOU swap where the file becomes a symlink between
      // lstat and open. O_NOFOLLOW refuses atomically on POSIX with ELOOP,
      // which the loader maps to the typed contract.
      const root = path.join(symlinkDir, "case-regular");
      const eloop = Object.assign(new Error("ELOOP: too many symbolic links"), { code: "ELOOP" });
      vi.mocked(mockedOpen).mockRejectedValueOnce(eloop);

      await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigSymlinkError);
    });
  },
);

// `mkfifo(1)` is POSIX-only; Windows has no equivalent and the production
// threat model is Linux Docker. The post-open mocked tests below still run
// cross-platform and pin the same contract via fd.stat() injection.
describe.skipIf(process.platform === "win32")(
  "loadConfig — FIFO rejection at lstat() (issue #1745)",
  () => {
    const execFileAsync = promisify(execFile);
    let fifoDir: string;

    beforeAll(async () => {
      fifoDir = await mkdtemp(path.join(tmpdir(), "sovri-cfg-fifo-"));
      // mkfifo creates a named pipe whose `stats.size` is 0 — would slip past
      // the 64 KiB cap and let `fd.readFile()` block indefinitely (or, when
      // the FIFO actually points at /dev/zero via a writer, OOM the worker).
      await execFileAsync("mkfifo", [path.join(fifoDir, ".sovri.yml")]);
    });

    afterAll(async () => {
      await rm(fifoDir, { recursive: true, force: true });
    });

    it("rejects .sovri.yml that is a FIFO with SovriConfigParseError before open()", async () => {
      vi.mocked(mockedOpen).mockRejectedValue(
        new Error("loadConfig should reject FIFO before open()"),
      );

      // Pre-open `lstat` sees a non-regular file (FIFO) and rejects before
      // any byte flows into `readFile()`. The mocked `open()` makes guard
      // regressions fail deterministically instead of blocking on the FIFO.
      await expect(loadConfig(fifoDir)).rejects.toBeInstanceOf(SovriConfigParseError);
      expect(mockedOpen).not.toHaveBeenCalled();

      try {
        await loadConfig(fifoDir);
        expect.unreachable("loadConfig should have thrown SovriConfigParseError");
      } catch (err) {
        if (!(err instanceof SovriConfigParseError)) throw err;
        expect(err.filePath.endsWith(".sovri.yml")).toBe(true);
        expect(err.cause).toBeInstanceOf(Error);
        if (err.cause instanceof Error) {
          expect(err.cause.message).toMatch(/regular file/i);
        }
      }
    });
  },
);

describe("loadConfig — TOCTOU type-flip at fd.stat() (issue #1745)", () => {
  // Verbatim issue #1745 scenario: regular file at lstat time, non-regular
  // (FIFO or chardev symlinked to /dev/zero) at open time. `size:0` passes
  // the 64 KiB cap; without the `!isFile()` guard, `fd.readFile()` would
  // read until EOF — unbounded for /dev/zero, OOM on the webhook worker.
  it.each([
    {
      kind: "FIFO",
      stats: {
        size: 0,
        isFile: () => false,
        isDirectory: () => false,
        isFIFO: () => true,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
      },
    },
    {
      kind: "character device",
      stats: {
        size: 0,
        isFile: () => false,
        isDirectory: () => false,
        isFIFO: () => false,
        isCharacterDevice: () => true,
        isSymbolicLink: () => false,
      },
    },
  ])(
    "throws SovriConfigParseError when fd.stat() reveals a $kind with size 0",
    async ({ stats }) => {
      const root = path.join(FIXTURES_ROOT, "valid-minimal");
      const closeMock = vi.fn<FileHandle["close"]>().mockResolvedValue(undefined);
      const readFileMock = vi.fn<FileHandle["readFile"]>();
      vi.mocked(mockedOpen).mockResolvedValueOnce({
        stat: vi
          .fn<FileHandle["stat"]>()
          .mockResolvedValue(stats as unknown as import("node:fs").Stats),
        readFile: readFileMock,
        close: closeMock,
      } as unknown as FileHandle);

      // Single call: `mockResolvedValueOnce` fires only once, so capture the
      // error here rather than re-invoking loadConfig (which would hit the
      // real `valid-minimal/.sovri.yml` and resolve normally).
      const err = await loadConfig(root).then(
        () => {
          throw new Error("loadConfig should have thrown SovriConfigParseError");
        },
        (caught: unknown) => caught,
      );

      expect(err).toBeInstanceOf(SovriConfigParseError);
      if (err instanceof SovriConfigParseError) {
        expect(err.cause).toBeInstanceOf(Error);
        if (err.cause instanceof Error) {
          expect(err.cause.message).toMatch(/regular file/i);
        }
      }

      // Critical invariant: readFile MUST NOT be invoked on a non-regular
      // file. Calling it is precisely the OOM path the !isFile() guard
      // exists to prevent.
      expect(readFileMock).not.toHaveBeenCalled();
      expect(closeMock).toHaveBeenCalledOnce();
    },
  );
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

  it("throws SovriConfigValidationError when llm.provider is openai (rejected by v0.2 .refine())", async () => {
    // openai IS in the ProviderSchema enum but the v0.2 `.refine()` narrows
    // accepted providers to {"anthropic", "mistral"}, so this exercises the
    // refinement path rather than the enum-stage rejection.
    const root = path.join(FIXTURES_ROOT, "schema-violation-bad-provider");

    await expect(loadConfig(root)).rejects.toBeInstanceOf(SovriConfigValidationError);
  });

  // Issue #1171, R-04 technical (loader surfaces the provider refine issue
  // through SovriConfigValidationError with name, filePath, and structured
  // issues array — the same shape PR-comment renderers walk).
  // Scenario:
  //   Given a .sovri.yml at "/repo/.sovri.yml" with llm.provider
  //     "openai-compatible"
  //   When loadConfig("/repo") runs and the validation step fails
  //   Then the rejected promise carries a SovriConfigValidationError
  //   And error.name equals "SovriConfigValidationError"
  //   And error.filePath equals "/repo/.sovri.yml"
  //   And error.issues has at least one entry with path
  //     ["llm", "provider"]
  //   And that entry.message equals
  //     "Only 'anthropic' and 'mistral' are enabled in this release."
  it("R-04 technical — SovriConfigValidationError surfaces the v0.2 provider refine issue (openai-compatible)", async () => {
    const root = path.join(FIXTURES_ROOT, "schema-violation-openai-compatible");

    try {
      await loadConfig(root);
      expect.unreachable("loadConfig should have thrown SovriConfigValidationError");
    } catch (err) {
      if (!(err instanceof SovriConfigValidationError)) throw err;

      expect(err.name).toBe("SovriConfigValidationError");
      expect(err.filePath).toContain(path.join("schema-violation-openai-compatible", ".sovri.yml"));

      const providerIssue = err.issues.find(
        (issue) =>
          issue.path.length === 2 && issue.path[0] === "llm" && issue.path[1] === "provider",
      );

      expect(providerIssue).toBeDefined();
      expect(providerIssue?.path).toEqual(["llm", "provider"]);
      expect(providerIssue?.message).toBe(
        "Only 'anthropic' and 'mistral' are enabled in this release.",
      );
    }
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
