// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { isIdentifierPart } from "./syntax-characters.js";

const RegexFlags = new Set<string>(["d", "g", "i", "m", "s", "u", "v", "y"]);

export type RegexFlagsScanResult = {
  readonly sane: boolean;
  readonly skip: number;
};

export function scanRegexFlags(code: string, start: number): RegexFlagsScanResult {
  const seen = new Set<string>();
  let end = start;
  while (end < code.length && isIdentifierPart(code.charAt(end))) {
    const flag = code.charAt(end);
    if (!RegexFlags.has(flag) || seen.has(flag)) {
      return { sane: false, skip: 0 };
    }
    seen.add(flag);
    end += 1;
  }
  return { sane: true, skip: end - start };
}
