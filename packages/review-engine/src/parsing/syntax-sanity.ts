// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { isWhitespace } from "./syntax-characters.js";
import { scanNormalCharacter, scanQuotedCharacter, scanRegexCharacter } from "./syntax-scanner.js";

export function isSyntacticallySane(code: string): boolean {
  const delimiterStack: string[] = [];
  let quote: string | undefined;
  let escaping = false;
  let inBlockComment = false;
  let inRegex = false;
  let inRegexClass = false;
  let previousSignificant: string | undefined;

  for (let index = 0; index < code.length; index += 1) {
    const char = code.charAt(index);

    if (inBlockComment) {
      if (char === "*" && code.charAt(index + 1) === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote !== undefined) {
      const result = scanQuotedCharacter(code, index, char, quote, escaping);
      if (result.reject) {
        return false;
      }
      escaping = result.escaping;
      if (result.closed) {
        quote = undefined;
        previousSignificant = "literal";
      }
      continue;
    }

    if (inRegex) {
      const result = scanRegexCharacter(char, escaping, inRegexClass);
      escaping = result.escaping;
      inRegexClass = result.inRegexClass;
      if (result.closed) {
        inRegex = false;
        previousSignificant = "literal";
      }
      continue;
    }

    if (isWhitespace(char)) {
      continue;
    }

    const token = scanNormalCharacter(code, index, char, previousSignificant, delimiterStack);
    if (!token.sane) {
      return false;
    }
    if (token.stop) {
      break;
    }
    if (token.skip !== undefined) {
      index += token.skip;
    }
    if (token.quote !== undefined) {
      quote = token.quote;
      escaping = false;
    }
    if (token.inBlockComment) {
      inBlockComment = true;
    }
    if (token.inRegex) {
      inRegex = true;
      inRegexClass = false;
      escaping = false;
    }
    if (token.previousSignificant !== undefined) {
      previousSignificant = token.previousSignificant;
    }
  }

  return delimiterStack.length === 0 && quote === undefined && !inBlockComment && !inRegex;
}
