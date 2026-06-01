// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  ClosingDelimiters,
  OpeningDelimiters,
  QuoteCharacters,
  RegexPrefixKeywords,
  RegexPrefixTokens,
  SpreadPrefixTokens,
  isDecimalDigit,
  isIdentifierPart,
  isIdentifierStart,
  isNumberLiteralPart,
  isWhitespace,
} from "./syntax-characters.js";

export type QuotedScanResult = {
  readonly closed: boolean;
  readonly escaping: boolean;
  readonly reject: boolean;
};

export function scanQuotedCharacter(
  code: string,
  index: number,
  char: string,
  quote: string,
  escaping: boolean,
): QuotedScanResult {
  if (escaping) {
    return { closed: false, escaping: false, reject: false };
  }
  if (char === "\\") {
    return { closed: false, escaping: true, reject: false };
  }
  if (quote === "`" && char === "$" && code.charAt(index + 1) === "{") {
    return { closed: false, escaping: false, reject: true };
  }
  return { closed: char === quote, escaping: false, reject: false };
}

export type RegexScanResult = {
  readonly closed: boolean;
  readonly escaping: boolean;
  readonly inRegexClass: boolean;
};

export function scanRegexCharacter(
  char: string,
  escaping: boolean,
  inRegexClass: boolean,
): RegexScanResult {
  if (escaping) {
    return { closed: false, escaping: false, inRegexClass };
  }
  if (char === "\\") {
    return { closed: false, escaping: true, inRegexClass };
  }
  if (char === "[" && !inRegexClass) {
    return { closed: false, escaping: false, inRegexClass: true };
  }
  if (char === "]" && inRegexClass) {
    return { closed: false, escaping: false, inRegexClass: false };
  }
  return { closed: char === "/" && !inRegexClass, escaping: false, inRegexClass };
}

export type NormalScanResult = {
  readonly sane: boolean;
  readonly stop?: boolean;
  readonly skip?: number;
  readonly quote?: string;
  readonly inBlockComment?: boolean;
  readonly inRegex?: boolean;
  readonly previousSignificant?: string;
};

export function scanNormalCharacter(
  code: string,
  index: number,
  char: string,
  previousSignificant: string | undefined,
  delimiterStack: string[],
): NormalScanResult {
  if (char === "/" && code.charAt(index + 1) === "/") {
    return { sane: true, stop: true };
  }
  if (char === "/" && code.charAt(index + 1) === "*") {
    return { sane: true, skip: 1, inBlockComment: true };
  }
  if (char === "/" && canStartRegexLiteral(previousSignificant)) {
    return { sane: true, inRegex: true };
  }
  if (char === "\u2026" || startsRejectedAsciiEllipsis(code, index, previousSignificant)) {
    return { sane: false };
  }
  if (QuoteCharacters.has(char)) {
    return { sane: true, quote: char };
  }
  if (isIdentifierStart(char)) {
    const identifier = readIdentifier(code, index);
    return { sane: true, skip: identifier.length - 1, previousSignificant: identifier };
  }
  if (isDecimalDigit(char)) {
    const literal = readNumberLiteral(code, index);
    return { sane: true, skip: literal.length - 1, previousSignificant: "literal" };
  }
  return scanDelimiterOrToken(code, index, char, delimiterStack);
}

function scanDelimiterOrToken(
  code: string,
  index: number,
  char: string,
  delimiterStack: string[],
): NormalScanResult {
  const expectedClosingDelimiter = OpeningDelimiters.get(char);
  if (expectedClosingDelimiter !== undefined) {
    delimiterStack.push(expectedClosingDelimiter);
    return { sane: true, previousSignificant: char };
  }
  if (ClosingDelimiters.has(char)) {
    return { sane: delimiterStack.pop() === char, previousSignificant: char };
  }
  if (char === "." && code.slice(index, index + 3) === "...") {
    return { sane: true, skip: 2, previousSignificant: "..." };
  }
  return { sane: true, previousSignificant: char };
}

function canStartRegexLiteral(previousSignificant: string | undefined): boolean {
  return (
    previousSignificant === undefined ||
    RegexPrefixTokens.has(previousSignificant) ||
    RegexPrefixKeywords.has(previousSignificant)
  );
}

function startsRejectedAsciiEllipsis(
  code: string,
  index: number,
  previousSignificant: string | undefined,
): boolean {
  if (code.slice(index, index + 3) !== "...") {
    return false;
  }
  const next = nextNonWhitespaceCharacter(code, index + 3);
  return (
    next === undefined ||
    !SpreadPrefixTokens.has(previousSignificant ?? "") ||
    !startsSpreadOperand(next)
  );
}

function nextNonWhitespaceCharacter(code: string, start: number): string | undefined {
  for (let index = start; index < code.length; index += 1) {
    const char = code.charAt(index);
    if (!isWhitespace(char)) {
      return char;
    }
  }
  return undefined;
}

function readIdentifier(code: string, start: number): string {
  let end = start + 1;
  while (end < code.length && isIdentifierPart(code.charAt(end))) {
    end += 1;
  }
  return code.slice(start, end);
}

function readNumberLiteral(code: string, start: number): string {
  let end = start + 1;
  while (end < code.length && isNumberLiteralPart(code.charAt(end))) {
    end += 1;
  }
  return code.slice(start, end);
}

function startsSpreadOperand(char: string): boolean {
  return isIdentifierStart(char) || char === "[" || char === "(" || char === "{";
}
