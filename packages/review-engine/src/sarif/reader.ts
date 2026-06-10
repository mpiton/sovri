// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

/**
 * Raised when a SARIF report is rejected whole: not valid JSON, a `version`
 * other than the exact string `2.1.0`, or a top-level shape that does not match
 * the SARIF 2.1.0 log structure. The original failure (a `SyntaxError` from
 * `JSON.parse`, or a `ZodError`) is preserved as `cause` for diagnostics.
 */
export class SarifParseError extends Error {
  public override readonly name = "SarifParseError";

  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

// Minimal SARIF 2.1.0 surface needed for R-01 acceptance. The reader validates
// untrusted external input at the boundary, so every nested object is a loose
// object (`z.looseObject`), tolerant of the many optional fields later rules
// consume. `$schema` is optional and ignored for acceptance (Trivy/older Semgrep omit it);
// `runs` may be empty and `run.results` may be absent (notifications-only run).
const SarifResultSchema = z.looseObject({});

const SarifRunSchema = z.looseObject({
  results: z.array(SarifResultSchema).optional(),
});

const SarifLogSchema = z.looseObject({
  version: z.literal("2.1.0"),
  $schema: z.string().optional(),
  runs: z.array(SarifRunSchema),
});

export type SarifLog = z.infer<typeof SarifLogSchema>;
export type SarifResult = z.infer<typeof SarifResultSchema>;

/**
 * Validate one untrusted SARIF report string and return the parsed SARIF 2.1.0
 * log. Throws {@link SarifParseError} when the string is not valid JSON, the
 * `version` is not exactly `2.1.0`, or the top-level shape is invalid.
 */
export function parseSarifReport(raw: string): SarifLog {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new SarifParseError("SARIF report is not valid JSON", { cause });
  }

  const parsed = SarifLogSchema.safeParse(json);
  if (!parsed.success) {
    throw new SarifParseError("SARIF report is not a valid SARIF 2.1.0 log", {
      cause: parsed.error,
    });
  }

  return parsed.data;
}
