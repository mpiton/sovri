// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  ComparisonLessToken,
  RegexPrefixKeywords,
  RegexPrefixTokens,
  SpreadPrefixTokens,
  TerminalOperatorTokens,
  isIdentifierPart,
  isIdentifierStart,
  isNumberLiteralPart,
  isWhitespace,
} from "./syntax-characters.js";

const AssertionAsToken = "assertion-as";

const NonOperandKeywords = new Set<string>([
  "as",
  "await",
  "case",
  "catch",
  "class",
  "const",
  "default",
  "delete",
  "do",
  "else",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "of",
  "return",
  "satisfies",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "void",
  "while",
  "yield",
]);

const IdentifierOperatorKeywords = new Set<string>([
  "as",
  "extends",
  "in",
  "instanceof",
  "of",
  "satisfies",
]);

const BlockContinuationKeywords = new Set<string>(["catch", "else", "finally", "while"]);

const NumberLiteralPattern =
  /^(?:0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:[0-9](?:_?[0-9])*)(?:\.(?:[0-9](?:_?[0-9])*)?)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?)(?:n)?$/u;

export function isCannotEndToken(token: string | undefined): boolean {
  return (
    token !== undefined &&
    (TerminalOperatorTokens.has(token) ||
      token === "," ||
      token === AssertionAsToken ||
      RegexPrefixKeywords.has(token) ||
      NonOperandKeywords.has(token))
  );
}

export function isCannotPrecedeColonToken(token: string | undefined): boolean {
  return (
    token !== undefined &&
    (TerminalOperatorTokens.has(token) || token === "," || RegexPrefixKeywords.has(token))
  );
}

export function isPostfixUpdateOperator(
  code: string,
  index: number,
  char: string,
  previousSignificant: string | undefined,
): boolean {
  return (
    (char === "+" || char === "-") &&
    code.charAt(index + 1) === char &&
    isOperandToken(previousSignificant)
  );
}

export function scanComparisonToken(
  char: string,
  previousSignificant: string | undefined,
): string | undefined {
  if (char === "<" && isOperandToken(previousSignificant)) {
    return ComparisonLessToken;
  }
  return undefined;
}

export function isUnexpectedAdjacentOperand(
  previousSignificant: string | undefined,
  current: string,
): boolean {
  if (previousSignificant === "}" && BlockContinuationKeywords.has(current)) {
    return false;
  }
  return isOperandToken(previousSignificant) && !IdentifierOperatorKeywords.has(current);
}

export function isSupportedNumberLiteral(literal: string): boolean {
  return NumberLiteralPattern.test(literal);
}

export function canStartRegexLiteral(previousSignificant: string | undefined): boolean {
  return (
    previousSignificant === undefined ||
    RegexPrefixTokens.has(previousSignificant) ||
    RegexPrefixKeywords.has(previousSignificant)
  );
}

export function startsRejectedAsciiEllipsis(
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

export function readIdentifier(code: string, start: number): string {
  let end = start + 1;
  while (end < code.length && isIdentifierPart(code.charAt(end))) {
    end += 1;
  }
  return code.slice(start, end);
}

export function significantIdentifierToken(
  identifier: string,
  previousSignificant: string | undefined,
): string {
  if (previousSignificant === ".") {
    return "literal";
  }
  if (identifier === "as" && isOperandToken(previousSignificant)) {
    return AssertionAsToken;
  }
  if (identifier === "const" && previousSignificant === AssertionAsToken) {
    return "literal";
  }
  return identifier;
}

export function readNumberLiteral(code: string, start: number): string {
  let end = start + 1;
  while (end < code.length && canContinueNumberLiteral(code, end)) {
    end += 1;
  }
  return code.slice(start, end);
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

function startsSpreadOperand(char: string): boolean {
  return isIdentifierStart(char) || char === "[" || char === "(" || char === "{";
}

function canContinueNumberLiteral(code: string, index: number): boolean {
  const char = code.charAt(index);
  return isNumberLiteralPart(char) || isExponentSign(code, index);
}

function isExponentSign(code: string, index: number): boolean {
  const char = code.charAt(index);
  const previous = code.charAt(index - 1);
  return (char === "+" || char === "-") && (previous === "e" || previous === "E");
}

export function isOperandToken(token: string | undefined): boolean {
  if (token === undefined || NonOperandKeywords.has(token)) {
    return false;
  }
  return (
    token === "literal" || token === ")" || token === "]" || token === "}" || isIdentifier(token)
  );
}

function isIdentifier(token: string): boolean {
  if (!isIdentifierStart(token.charAt(0))) {
    return false;
  }
  for (let index = 1; index < token.length; index += 1) {
    if (!isIdentifierPart(token.charAt(index))) {
      return false;
    }
  }
  return true;
}
