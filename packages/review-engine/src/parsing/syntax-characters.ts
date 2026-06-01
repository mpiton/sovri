// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export const OpeningDelimiters = new Map<string, string>([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

export const ClosingDelimiters = new Set<string>([")", "]", "}"]);
export const QuoteCharacters = new Set<string>(["'", '"', "`"]);
export const RegexPrefixTokens = new Set<string>([
  "(",
  "[",
  "{",
  "=",
  ":",
  ",",
  ";",
  "!",
  "&",
  "|",
  "?",
  "+",
  "-",
  "*",
  "~",
  "^",
  "<",
  ">",
]);
export const RegexPrefixKeywords = new Set<string>([
  "return",
  "throw",
  "case",
  "yield",
  "typeof",
  "delete",
  "void",
]);
export const SpreadPrefixTokens = new Set<string>(["(", "[", "{", ","]);

export function isIdentifierStart(char: string): boolean {
  return /[$A-Z_a-z]/u.test(char);
}

export function isIdentifierPart(char: string): boolean {
  return /[$0-9A-Z_a-z]/u.test(char);
}

export function isDecimalDigit(char: string): boolean {
  return /[0-9]/u.test(char);
}

export function isNumberLiteralPart(char: string): boolean {
  return /[.0-9A-FX_a-fx]/u.test(char);
}

export function isWhitespace(char: string): boolean {
  return char.trim().length === 0;
}
