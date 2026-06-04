// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  ClosingDelimiters,
  OpeningDelimiters,
  QuoteCharacters,
  isDecimalDigit,
  isIdentifierStart,
  isTerminalOperatorToken,
  isWhitespace,
} from "./syntax-characters.js";
import { scanRegexFlags } from "./syntax-regex-flags.js";
import {
  canStartRegexLiteral,
  isCannotEndToken,
  isCannotPrecedeColonToken,
  isOperandToken,
  isPostfixUpdateOperator,
  isSupportedNumberLiteral,
  isUnexpectedAdjacentOperand,
  readIdentifier,
  readNumberLiteral,
  scanComparisonToken,
  significantIdentifierToken,
  startsRejectedAsciiEllipsis,
} from "./syntax-token-rules.js";

const StatementTerminatorAllowedPrefixKeywords = new Set<string>(["return", "yield"]);
const JsxContentToken = "jsx-content";

type QuotedScanResult = {
  readonly closed: boolean;
  readonly escaping: boolean;
  readonly opensTemplateExpression: boolean;
};

function scanQuotedCharacter(
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

type RegexScanResult = {
  readonly closed: boolean;
  readonly escaping: boolean;
  readonly inRegexClass: boolean;
};

function scanRegexCharacter(
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

type NormalScanResult = {
  readonly sane: boolean;
  readonly stop?: boolean;
  readonly skip?: number;
  readonly quote?: string;
  readonly inBlockComment?: boolean;
  readonly inRegex?: boolean;
  readonly resumeTemplate?: boolean;
  readonly previousSignificant?: string;
  readonly opensTernary?: boolean;
  readonly closesTernary?: boolean;
};

type DelimiterStackEntry = {
  readonly closing: string;
  readonly resumesTemplate: boolean;
  readonly openedAfterOperand: boolean;
  readonly containsTernary: boolean;
  readonly resumesJsxContent: boolean;
};

export type SyntaxFragmentScanResult = {
  readonly sane: boolean;
  readonly skip: number;
};

type SyntaxFragmentScanOptions = {
  readonly stopAfterBalancedDelimiter?: boolean;
  readonly rejectEmptyInitialDelimiter?: boolean;
};

function scanNormalCharacter(
  code: string,
  index: number,
  char: string,
  previousSignificant: string | undefined,
  delimiterStack: DelimiterStackEntry[],
): NormalScanResult {
  if (char === "/" && code.charAt(index + 1) === "/") {
    return { sane: true, skip: lineCommentSkipLength(code, index) };
  }
  if (char === "/" && code.charAt(index + 1) === "*") {
    return { sane: true, skip: 1, inBlockComment: true };
  }
  if (char === "<" && code.charAt(index + 1) === "/") {
    const jsxClosingTag = scanJsxClosingTag(code, index);
    if (jsxClosingTag !== undefined) {
      return jsxClosingTag;
    }
  }
  if (char === "<" && !isOperandToken(previousSignificant)) {
    const jsxOpeningTag = scanJsxOpeningTag(code, index);
    if (jsxOpeningTag !== undefined) {
      return jsxOpeningTag;
    }
  }
  if (isJsxTextContext(previousSignificant) && canStartJsxText(char)) {
    const jsxText = scanJsxTextContent(code, index);
    if (jsxText !== undefined) {
      return jsxText;
    }
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
    if (char !== "`" && isOperandToken(previousSignificant)) {
      return { sane: false };
    }
    return { sane: true, quote: char };
  }
  if (isIdentifierStart(char)) {
    const identifier = readIdentifier(code, index);
    if (isUnexpectedAdjacentOperand(previousSignificant, identifier)) {
      return { sane: false };
    }
    return {
      sane: true,
      skip: identifier.length - 1,
      previousSignificant: significantIdentifierToken(identifier, previousSignificant),
    };
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

  if (char === "?") {
    const next = code.charAt(index + 1);
    if (next === "?") {
      return { sane: true, skip: 1, previousSignificant: char };
    }
    if (next === ".") {
      return { sane: true, skip: 1, previousSignificant: "." };
    }
    markTopDelimiterContainsTernary(delimiterStack);
    return { sane: true, previousSignificant: char, opensTernary: next !== "." };
  }
  if (char === ":") {
    if (code.charAt(index + 1) === ":" && isOperandToken(previousSignificant)) {
      return { sane: true, skip: 1, previousSignificant: "." };
    }
    if (isCannotPrecedeColonToken(previousSignificant)) {
      return { sane: false, previousSignificant: char };
    }
    return { sane: true, previousSignificant: char, closesTernary: true };
  }
  if (char === "!" && isOperandToken(previousSignificant)) {
    return { sane: true, previousSignificant: "literal" };
  }
  if (char === ",") {
    if (
      (previousSignificant === "," || isOpeningDelimiterToken(previousSignificant)) &&
      !isArrayElisionComma(previousSignificant, delimiterStack)
    ) {
      return { sane: false, previousSignificant: char };
    }
    return { sane: true, previousSignificant: char };
  }
  if (char === ";") {
    if (
      isCannotEndToken(previousSignificant) &&
      !StatementTerminatorAllowedPrefixKeywords.has(previousSignificant ?? "")
    ) {
      return { sane: false, previousSignificant: char };
    }
    return { sane: true, previousSignificant: char };
  }

  const expectedClosingDelimiter = OpeningDelimiters.get(char);
  if (expectedClosingDelimiter !== undefined) {
    delimiterStack.push({
      closing: expectedClosingDelimiter,
      resumesTemplate: false,
      openedAfterOperand: isOperandToken(previousSignificant),
      containsTernary: false,
      resumesJsxContent: char === "{" && previousSignificant === JsxContentToken,
    });
    return { sane: true, previousSignificant: char };
  }
  if (ClosingDelimiters.has(char)) {
    if (
      isTerminalOperatorToken(previousSignificant) &&
      !isSliceClosingDelimiter(char, previousSignificant, delimiterStack)
    ) {
      return { sane: false, previousSignificant: char };
    }
    const entry = delimiterStack.pop();
    if (entry === undefined || entry.closing !== char) {
      return { sane: false, previousSignificant: char };
    }
    return {
      sane: true,
      resumeTemplate: entry.resumesTemplate,
      previousSignificant: entry.resumesJsxContent ? JsxContentToken : char,
    };
  }
  if (char === "." && code.slice(index, index + 3) === "...") {
    return { sane: true, skip: 2, previousSignificant: "..." };
  }
  return { sane: true, previousSignificant: char };
}

function lineCommentSkipLength(code: string, index: number): number {
  const lineEnd = code.indexOf("\n", index + 2);
  const commentEnd = lineEnd === -1 ? code.length : lineEnd;
  return commentEnd - index - 1;
}

function scanJsxClosingTag(code: string, index: number): NormalScanResult | undefined {
  let cursor = index + 2;
  if (code.charAt(cursor) === ">") {
    return { sane: true, skip: cursor - index, previousSignificant: "literal" };
  }
  if (!isIdentifierStart(code.charAt(cursor))) {
    return undefined;
  }
  cursor += 1;
  while (cursor < code.length && isJsxTagNamePart(code.charAt(cursor))) {
    cursor += 1;
  }
  while (cursor < code.length && code.charAt(cursor) === " ") {
    cursor += 1;
  }
  if (code.charAt(cursor) !== ">") {
    return undefined;
  }
  return { sane: true, skip: cursor - index, previousSignificant: "literal" };
}

function scanJsxOpeningTag(code: string, index: number): NormalScanResult | undefined {
  let cursor = index + 1;
  if (code.charAt(cursor) === ">") {
    return { sane: true, skip: cursor - index, previousSignificant: JsxContentToken };
  }
  if (!isIdentifierStart(code.charAt(cursor))) {
    return undefined;
  }
  cursor += 1;
  while (cursor < code.length && isJsxTagNamePart(code.charAt(cursor))) {
    cursor += 1;
  }

  let quote: string | undefined;
  let escaping = false;
  let previousAttributeToken: "name" | "=" | "value" | undefined;
  for (; cursor < code.length; cursor += 1) {
    const char = code.charAt(cursor);
    if (quote !== undefined) {
      const quoted = scanQuotedCharacter(code, cursor, char, quote, escaping);
      escaping = quoted.escaping;
      if (quoted.closed) {
        quote = undefined;
        previousAttributeToken = "value";
      }
      continue;
    }
    if (QuoteCharacters.has(char)) {
      if (char === "`" || previousAttributeToken !== "=") {
        return { sane: false };
      }
      quote = char;
      escaping = false;
      continue;
    }
    if (char === "{") {
      const expression = scanJsxAttributeExpression(code, cursor);
      if (!expression.sane) {
        return { sane: false };
      }
      cursor += expression.skip;
      previousAttributeToken = "value";
      continue;
    }
    if (char === "=") {
      if (previousAttributeToken !== "name") {
        return { sane: false };
      }
      previousAttributeToken = "=";
      continue;
    }
    if (isIdentifierStart(char)) {
      if (previousAttributeToken === "=") {
        return { sane: false };
      }
      cursor += scanJsxNameLength(code, cursor) - 1;
      previousAttributeToken = "name";
      continue;
    }
    if (char === "}") {
      return { sane: false };
    }
    if (char === ">") {
      if (previousAttributeToken === "=") {
        return { sane: false };
      }
      return { sane: true, skip: cursor - index, previousSignificant: JsxContentToken };
    }
  }
  return { sane: false };
}

function scanJsxTextContent(code: string, index: number): NormalScanResult | undefined {
  let cursor = index;
  let sawText = false;
  while (cursor < code.length) {
    const char = code.charAt(cursor);
    if (char === "<" || char === "{") {
      if (!sawText) {
        return undefined;
      }
      return { sane: true, skip: cursor - index - 1, previousSignificant: JsxContentToken };
    }
    if (char === "}") {
      return { sane: false };
    }
    if (!isWhitespace(char)) {
      sawText = true;
    }
    cursor += 1;
  }
  return undefined;
}

function isJsxTextContext(previousSignificant: string | undefined): boolean {
  return previousSignificant === JsxContentToken;
}

function canStartJsxText(char: string): boolean {
  return !ClosingDelimiters.has(char) && char !== ";" && char !== ",";
}

function isJsxTagNamePart(char: string): boolean {
  return (
    isIdentifierStart(char) || isDecimalDigit(char) || char === "-" || char === "." || char === ":"
  );
}

function isOpeningDelimiterToken(token: string | undefined): boolean {
  return token !== undefined && OpeningDelimiters.has(token);
}

function isArrayElisionComma(
  previousSignificant: string | undefined,
  delimiterStack: DelimiterStackEntry[],
): boolean {
  const entry = delimiterStack[delimiterStack.length - 1];
  return (
    (previousSignificant === "[" || previousSignificant === ",") &&
    entry?.closing === "]" &&
    !entry.openedAfterOperand
  );
}

function scanJsxNameLength(code: string, start: number): number {
  let cursor = start + 1;
  while (cursor < code.length && isJsxTagNamePart(code.charAt(cursor))) {
    cursor += 1;
  }
  return cursor - start;
}

function isSliceClosingDelimiter(
  char: string,
  previousSignificant: string | undefined,
  delimiterStack: DelimiterStackEntry[],
): boolean {
  if (char !== "]" || previousSignificant !== ":") {
    return false;
  }
  const entry = delimiterStack[delimiterStack.length - 1];
  return entry?.closing === "]" && entry.openedAfterOperand && !entry.containsTernary;
}

function markTopDelimiterContainsTernary(delimiterStack: DelimiterStackEntry[]): void {
  const topIndex = delimiterStack.length - 1;
  const entry = delimiterStack[topIndex];
  if (entry === undefined) {
    return;
  }
  delimiterStack[topIndex] = { ...entry, containsTernary: true };
}

function scanJsxAttributeExpression(code: string, start: number): SyntaxFragmentScanResult {
  return scanSyntaxFragment(code, start, {
    stopAfterBalancedDelimiter: true,
    rejectEmptyInitialDelimiter: true,
  });
}

export function scanSyntaxFragment(
  code: string,
  start = 0,
  options: SyntaxFragmentScanOptions = {},
): SyntaxFragmentScanResult {
  const stopAfterBalancedDelimiter = options.stopAfterBalancedDelimiter ?? false;
  const rejectEmptyInitialDelimiter = options.rejectEmptyInitialDelimiter ?? false;
  const delimiterStack: DelimiterStackEntry[] = [];
  const pendingTernaryDepths: number[] = [];
  let quote: string | undefined;
  let escaping = false;
  let inBlockComment = false;
  let inRegex = false;
  let inRegexClass = false;
  let previousSignificant: string | undefined;

  for (let index = start; index < code.length; index += 1) {
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
      escaping = result.escaping;
      if (result.opensTemplateExpression) {
        quote = undefined;
        delimiterStack.push({
          closing: "}",
          resumesTemplate: true,
          openedAfterOperand: false,
          containsTernary: false,
          resumesJsxContent: false,
        });
        previousSignificant = "=";
        index += 1;
        continue;
      }
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
        const flags = scanRegexFlags(code, index + 1);
        if (!flags.sane) {
          return { sane: false, skip: index - start };
        }
        index += flags.skip;
        inRegex = false;
        previousSignificant = "literal";
      }
      continue;
    }

    if (isWhitespace(char)) {
      continue;
    }

    if (
      rejectEmptyInitialDelimiter &&
      index > start &&
      char === "}" &&
      delimiterStack.length === 1 &&
      previousSignificant === "{"
    ) {
      return { sane: false, skip: index - start };
    }

    const token = scanNormalCharacter(code, index, char, previousSignificant, delimiterStack);
    if (!token.sane) {
      return { sane: false, skip: index - start };
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
    if (token.resumeTemplate) {
      quote = "`";
      escaping = false;
    }
    if (token.opensTernary) {
      pendingTernaryDepths.push(delimiterStack.length);
    }
    if (token.closesTernary) {
      const pendingDepth = pendingTernaryDepths[pendingTernaryDepths.length - 1];
      if (pendingDepth === delimiterStack.length) {
        pendingTernaryDepths.pop();
      }
    }
    if (token.previousSignificant !== undefined) {
      previousSignificant = token.previousSignificant;
    }
    if (stopAfterBalancedDelimiter && index > start && delimiterStack.length === 0) {
      return {
        sane: isCompleteSyntaxState(
          delimiterStack,
          pendingTernaryDepths,
          quote,
          inBlockComment,
          inRegex,
          previousSignificant,
        ),
        skip: index - start,
      };
    }
  }

  return {
    sane:
      !stopAfterBalancedDelimiter &&
      isCompleteSyntaxState(
        delimiterStack,
        pendingTernaryDepths,
        quote,
        inBlockComment,
        inRegex,
        previousSignificant,
      ),
    skip: code.length - start,
  };
}

function isCompleteSyntaxState(
  delimiterStack: DelimiterStackEntry[],
  pendingTernaryDepths: number[],
  quote: string | undefined,
  inBlockComment: boolean,
  inRegex: boolean,
  previousSignificant: string | undefined,
): boolean {
  return (
    delimiterStack.length === 0 &&
    pendingTernaryDepths.length === 0 &&
    quote === undefined &&
    !inBlockComment &&
    !inRegex &&
    !isCannotEndToken(previousSignificant)
  );
}
