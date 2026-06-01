// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  ClosingDelimiters,
  OpeningDelimiters,
  QuoteCharacters,
  isDecimalDigit,
  isIdentifierStart,
  isTerminalOperatorToken,
} from "./syntax-characters.js";
import {
  canStartRegexLiteral,
  isPostfixUpdateOperator,
  isSupportedNumberLiteral,
  isUnexpectedAdjacentOperand,
  readIdentifier,
  readNumberLiteral,
  scanComparisonToken,
  startsRejectedAsciiEllipsis,
} from "./syntax-token-rules.js";

export type QuotedScanResult = {
  readonly closed: boolean;
  readonly escaping: boolean;
  readonly opensTemplateExpression: boolean;
};

export function scanQuotedCharacter(
  code: string,
  index: number,
  char: string,
  quote: string,
  escaping: boolean,
): QuotedScanResult {
  if (escaping) {
    return { closed: false, escaping: false, opensTemplateExpression: false };
  }
  if (char === "\\") {
    return { closed: false, escaping: true, opensTemplateExpression: false };
  }
  if (quote === "`" && char === "$" && code.charAt(index + 1) === "{") {
    return { closed: false, escaping: false, opensTemplateExpression: true };
  }
  return { closed: char === quote, escaping: false, opensTemplateExpression: false };
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
  readonly resumeTemplate?: boolean;
  readonly previousSignificant?: string;
};

export type DelimiterStackEntry = {
  readonly closing: string;
  readonly resumesTemplate: boolean;
};

export function scanNormalCharacter(
  code: string,
  index: number,
  char: string,
  previousSignificant: string | undefined,
  delimiterStack: DelimiterStackEntry[],
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
  if (isPostfixUpdateOperator(code, index, char, previousSignificant)) {
    return { sane: true, skip: 1, previousSignificant: "literal" };
  }
  if (char === "\u2026" || startsRejectedAsciiEllipsis(code, index, previousSignificant)) {
    return { sane: false };
  }
  if (QuoteCharacters.has(char)) {
    return { sane: true, quote: char };
  }
  if (isIdentifierStart(char)) {
    const identifier = readIdentifier(code, index);
    if (isUnexpectedAdjacentOperand(previousSignificant, identifier)) {
      return { sane: false };
    }
    return { sane: true, skip: identifier.length - 1, previousSignificant: identifier };
  }
  if (isDecimalDigit(char)) {
    const literal = readNumberLiteral(code, index);
    if (
      !isSupportedNumberLiteral(literal) ||
      isUnexpectedAdjacentOperand(previousSignificant, literal)
    ) {
      return { sane: false };
    }
    return { sane: true, skip: literal.length - 1, previousSignificant: "literal" };
  }
  return scanDelimiterOrToken(code, index, char, previousSignificant, delimiterStack);
}

function scanDelimiterOrToken(
  code: string,
  index: number,
  char: string,
  previousSignificant: string | undefined,
  delimiterStack: DelimiterStackEntry[],
): NormalScanResult {
  const comparisonToken = scanComparisonToken(char, previousSignificant);
  if (comparisonToken !== undefined) {
    return { sane: true, previousSignificant: comparisonToken };
  }

  const expectedClosingDelimiter = OpeningDelimiters.get(char);
  if (expectedClosingDelimiter !== undefined) {
    delimiterStack.push({ closing: expectedClosingDelimiter, resumesTemplate: false });
    return { sane: true, previousSignificant: char };
  }
  if (ClosingDelimiters.has(char)) {
    if (isTerminalOperatorToken(previousSignificant)) {
      return { sane: false, previousSignificant: char };
    }
    const entry = delimiterStack.pop();
    if (entry === undefined || entry.closing !== char) {
      return { sane: false, previousSignificant: char };
    }
    return { sane: true, resumeTemplate: entry.resumesTemplate, previousSignificant: char };
  }
  if (char === "." && code.slice(index, index + 3) === "...") {
    return { sane: true, skip: 2, previousSignificant: "..." };
  }
  return { sane: true, previousSignificant: char };
}
