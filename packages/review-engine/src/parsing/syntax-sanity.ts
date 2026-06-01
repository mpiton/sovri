// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

type QuoteDelimiter = '"' | "'" | "`";

export function isSyntacticallySane(code: string): boolean {
  const trimmedCode = code.trim();
  if (trimmedCode.length === 0 || hasTruncationMarker(trimmedCode)) {
    return false;
  }

  const expectedClosings: string[] = [];
  let currentQuote: QuoteDelimiter | undefined;
  let escaped = false;
  const characters = [...code];
  let inBlockComment = false;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === undefined) {
      continue;
    }

    const nextCharacter = characters[index + 1];
    if (inBlockComment) {
      if (closesBlockComment(character, nextCharacter)) {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (currentQuote !== undefined) {
      if (opensTemplateInterpolation(currentQuote, character, nextCharacter, escaped)) {
        return false;
      }

      const quoteResult = readQuotedCharacter(character, currentQuote, escaped);
      currentQuote = quoteResult.currentQuote;
      escaped = quoteResult.escaped;
      continue;
    }

    const quote = toQuoteDelimiter(character);
    if (quote !== undefined) {
      currentQuote = quote;
      continue;
    }

    if (startsLineComment(character, nextCharacter)) {
      break;
    }

    if (startsBlockComment(character, nextCharacter)) {
      inBlockComment = true;
      index += 1;
      continue;
    }

    const expectedClosing = expectedClosingDelimiter(character);
    if (expectedClosing !== undefined) {
      expectedClosings.push(expectedClosing);
      continue;
    }

    if (isClosingDelimiter(character) && expectedClosings.pop() !== character) {
      return false;
    }
  }

  return currentQuote === undefined && !inBlockComment && expectedClosings.length === 0;
}

function hasTruncationMarker(trimmedCode: string): boolean {
  const codeWithoutTerminator = trimmedCode.replace(/[;\s]+$/u, "");
  return codeWithoutTerminator.endsWith("...") || codeWithoutTerminator.endsWith("…");
}

function opensTemplateInterpolation(
  currentQuote: QuoteDelimiter,
  character: string,
  nextCharacter: string | undefined,
  escaped: boolean,
): boolean {
  return currentQuote === "`" && !escaped && character === "$" && nextCharacter === "{";
}

function startsLineComment(character: string, nextCharacter: string | undefined): boolean {
  return character === "/" && nextCharacter === "/";
}

function startsBlockComment(character: string, nextCharacter: string | undefined): boolean {
  return character === "/" && nextCharacter === "*";
}

function closesBlockComment(character: string, nextCharacter: string | undefined): boolean {
  return character === "*" && nextCharacter === "/";
}

function readQuotedCharacter(
  character: string,
  currentQuote: QuoteDelimiter,
  escaped: boolean,
): { currentQuote: QuoteDelimiter | undefined; escaped: boolean } {
  if (escaped) {
    return { currentQuote, escaped: false };
  }

  if (character === "\\") {
    return { currentQuote, escaped: true };
  }

  if (character === currentQuote) {
    return { currentQuote: undefined, escaped: false };
  }

  return { currentQuote, escaped: false };
}

function toQuoteDelimiter(character: string): QuoteDelimiter | undefined {
  switch (character) {
    case '"':
    case "'":
    case "`":
      return character;
    default:
      return undefined;
  }
}

function expectedClosingDelimiter(character: string): string | undefined {
  switch (character) {
    case "(":
      return ")";
    case "[":
      return "]";
    case "{":
      return "}";
    default:
      return undefined;
  }
}

function isClosingDelimiter(character: string): boolean {
  return character === ")" || character === "]" || character === "}";
}
