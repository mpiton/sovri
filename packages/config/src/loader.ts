// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { load as parseYaml } from "js-yaml";

import { createLogger } from "@sovri/observability";

import { SovriConfigParseError, SovriConfigValidationError } from "./errors.js";
import { SovriConfigSchema, type SovriConfig } from "./types/SovriConfig.js";

const CONFIG_FILENAME = ".sovri.yml";

// 64 KiB cap. A realistic `.sovri.yml` is tens to hundreds of bytes; the
// ceiling is several orders of magnitude above legitimate usage but small
// enough to bound the memory the YAML parser can allocate per webhook.
//
// NOTE (follow-up): js-yaml 4.x has no `maxAliasCount`, so a crafted file
// with deeply nested anchors/aliases can still expand to high memory during
// parse. A later iteration should swap to `eemeli/yaml` (which supports
// `maxAliasCount`) or add a parse-time guard.
const MAX_CONFIG_BYTES = 64 * 1024;

const logger = createLogger("config.loader");

/**
 * Deep-freeze an arbitrary value so consumers cannot mutate shared module
 * state. Re-entrant on already-frozen sub-trees.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isMissingFileError(err: unknown): boolean {
  if (!(err instanceof Error) || !("code" in err)) return false;
  const code = err.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Defaults applied when `.sovri.yml` is absent or empty. v0.1 targets
 * Anthropic exclusively (PRD §7.1), so the default LLM block points at the
 * canonical env-var name `ANTHROPIC_API_KEY` — never a raw secret — and a
 * Sonnet model identifier that matches the schema's strict character set.
 *
 * The object is deep-frozen: every importer receives the same singleton;
 * mutating it would silently corrupt every subsequent review. Clone with
 * `structuredClone(...)` if you need a writable baseline.
 */
export const DEFAULT_CONFIG: SovriConfig = deepFreeze(
  SovriConfigSchema.parse({
    llm: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      apiKeySecret: "ANTHROPIC_API_KEY",
    },
  }),
);

/**
 * Load and validate `.sovri.yml` from a repository root.
 *
 * Resolution order:
 *   1. File missing (`ENOENT`/`ENOTDIR`)         → returns `DEFAULT_CONFIG`.
 *   2. File empty or YAML root is null/undefined → returns `DEFAULT_CONFIG`.
 *   3. File larger than `MAX_CONFIG_BYTES`       → throws `SovriConfigParseError`.
 *   4. YAML invalid                              → throws `SovriConfigParseError`.
 *   5. Schema invalid                            → throws `SovriConfigValidationError`.
 *   6. Valid file                                → returns the parsed `SovriConfig`.
 *
 * Any other I/O failure (`EACCES`, `EISDIR`, …) is propagated as-is so the
 * caller can decide whether to bail out or surface it to the operator.
 *
 * SECURITY: `SovriConfigParseError.cause` (`YAMLException`) may quote a
 * fragment of the offending YAML. Callers must NOT log `err.cause` raw —
 * the snippet may contain text from the repo's `.sovri.yml` (e.g. a real
 * secret a user pasted by mistake before the schema's `apiKeySecret`
 * env-var-name regex would have rejected it).
 */
export async function loadConfig(repoRoot: string): Promise<SovriConfig> {
  const filePath = path.join(repoRoot, CONFIG_FILENAME);

  let size: number;
  try {
    const stats = await stat(filePath);
    size = stats.size;
  } catch (err) {
    if (isMissingFileError(err)) {
      logger.debug({ filePath }, "no .sovri.yml found, falling back to defaults");
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  if (size > MAX_CONFIG_BYTES) {
    throw new SovriConfigParseError(
      filePath,
      new Error(
        `.sovri.yml is ${String(size)} bytes; maximum allowed is ${String(MAX_CONFIG_BYTES)} bytes`,
      ),
    );
  }

  // The same fallback applies if the file disappears between `stat` and
  // `readFile` (TOCTOU on a long-lived bot host where another process can
  // delete `.sovri.yml` between the two syscalls).
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (isMissingFileError(err)) {
      logger.debug({ filePath }, "no .sovri.yml found during read, falling back to defaults");
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw, { filename: filePath });
  } catch (err) {
    throw new SovriConfigParseError(filePath, err);
  }

  // An empty file or a file containing only YAML whitespace/comments parses
  // to `null` or `undefined`; treat both as "no config" rather than failing
  // schema validation on a missing `llm` block.
  if (parsed === null || parsed === undefined) {
    logger.debug({ filePath }, "empty .sovri.yml, falling back to defaults");
    return DEFAULT_CONFIG;
  }

  const result = SovriConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new SovriConfigValidationError(filePath, result.error);
  }

  logger.debug({ filePath }, ".sovri.yml loaded and validated");
  return result.data;
}
