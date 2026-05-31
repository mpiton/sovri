// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  ForbiddenCompatibleNetworkPatterns,
  UnmockedCompatibleSdkConstructionLabel,
} from "./OpenAICompatibleProvider.no-network-patterns.js";
import type { ProviderTestSource } from "./OpenAICompatibleProvider.test-source-discovery.js";

export {
  CompatibleProviderFixture,
  ForbiddenCompatibleNetworkPatterns,
  ForbiddenEnvironmentLookupSamples,
  UnmockedCompatibleSdkConstructionLabel,
} from "./OpenAICompatibleProvider.no-network-patterns.js";
export { readOpenAICompatibleProviderTestSources } from "./OpenAICompatibleProvider.test-source-discovery.js";

const OpenAIMockPattern = /vi\.doMock\(\s*["']openai["']/;
const TestBlockPattern = /\b(?:it|test)(?:\.each)?\s*\(/g;
const DirectCompatibleProviderConstructionPattern =
  /\bcreateOpenAICompatibleProvider\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
const NonInlineCompatibleProviderConstructionPattern =
  /\bcreateOpenAICompatibleProvider\s*\(\s*([A-Za-z_$][\w$]*(?:\s*\([^)]*\))?)\s*\)/g;
const IdentifierPattern = /^[A-Za-z_$][\w$]*$/;
const HelperCallPattern = /^([A-Za-z_$][\w$]*)\s*\(/;
const TopLevelClientOptionPattern = /\bclient\s*:/g;
const HelperObjectLiteralPattern = /(?:return|=)\s*\{([\s\S]*?)\}/g;

export function committedSourceViolations(sources: ReadonlyArray<ProviderTestSource>): string[] {
  return sources.flatMap((source) =>
    findForbiddenCompatibleNetworkPatterns(source.source).map(
      (forbiddenPattern) => `${source.fileName}: ${forbiddenPattern}`,
    ),
  );
}

export function findForbiddenCompatibleNetworkPatterns(source: string): string[] {
  const forbiddenPatterns = ForbiddenCompatibleNetworkPatterns.filter(({ matches }) =>
    matches(source),
  ).map(({ label }) => label);

  if (hasUnmockedCompatibleProviderConstruction(source)) {
    return [...forbiddenPatterns, UnmockedCompatibleSdkConstructionLabel];
  }

  return forbiddenPatterns;
}

function hasUnmockedCompatibleProviderConstruction(source: string): boolean {
  for (const match of source.matchAll(DirectCompatibleProviderConstructionPattern)) {
    const options = match[1];
    if (
      options !== undefined &&
      !hasTopLevelClientOption(options) &&
      !hasOpenAIMockInCurrentTestBlock(source, match.index)
    ) {
      return true;
    }
  }

  for (const match of source.matchAll(NonInlineCompatibleProviderConstructionPattern)) {
    const optionsExpression = match[1];
    if (
      optionsExpression !== undefined &&
      !hasOpenAIMockInCurrentTestBlock(source, match.index) &&
      !nonInlineOptionsIncludeClient(source, optionsExpression, match.index)
    ) {
      return true;
    }
  }

  return false;
}

function nonInlineOptionsIncludeClient(
  source: string,
  optionsExpression: string,
  constructionIndex: number,
): boolean {
  const expression = optionsExpression.trim();
  if (IdentifierPattern.test(expression)) {
    return assignedOptionsIncludeClient(source, expression, constructionIndex);
  }

  const helperCall = HelperCallPattern.exec(expression);
  const helperName = helperCall?.[1];
  if (helperName === undefined) {
    return false;
  }

  return helperOptionsIncludeClient(source, helperName);
}

function assignedOptionsIncludeClient(
  source: string,
  variableName: string,
  constructionIndex: number,
): boolean {
  const assignmentPattern = new RegExp(
    `\\b(?:const|let)\\s+${escapeRegExp(variableName)}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
    "g",
  );
  const sourceBeforeConstruction = source.slice(
    currentTestBlockStart(source, constructionIndex),
    constructionIndex,
  );
  let optionsSource: string | undefined;

  for (const match of sourceBeforeConstruction.matchAll(assignmentPattern)) {
    optionsSource = match[1];
  }

  return optionsSource !== undefined && hasTopLevelClientOption(optionsSource);
}

function helperOptionsIncludeClient(source: string, helperName: string): boolean {
  const functionStart = source.indexOf(`function ${helperName}`);
  if (functionStart === -1) {
    return false;
  }

  const nextFunction = source.indexOf("\nfunction ", functionStart + 1);
  const functionSource = source.slice(
    functionStart,
    nextFunction === -1 ? source.length : nextFunction,
  );
  return Array.from(functionSource.matchAll(HelperObjectLiteralPattern)).some((match) => {
    const optionsSource = match[1];
    return optionsSource !== undefined && hasTopLevelClientOption(optionsSource);
  });
}

function hasOpenAIMockInCurrentTestBlock(source: string, constructionIndex: number): boolean {
  const testBlockStart = currentTestBlockStart(source, constructionIndex);
  return OpenAIMockPattern.test(source.slice(testBlockStart, constructionIndex));
}

function currentTestBlockStart(source: string, constructionIndex: number): number {
  let testBlockStart = 0;
  const sourceBeforeConstruction = source.slice(0, constructionIndex);

  for (const match of sourceBeforeConstruction.matchAll(TestBlockPattern)) {
    testBlockStart = match.index;
  }

  return testBlockStart;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTopLevelClientOption(optionsSource: string): boolean {
  for (const match of optionsSource.matchAll(TopLevelClientOptionPattern)) {
    if (objectLiteralDepthAt(optionsSource, match.index) === 0) {
      return true;
    }
  }

  return false;
}

function objectLiteralDepthAt(source: string, targetIndex: number): number {
  let depth = 0;

  for (let index = 0; index < targetIndex; index += 1) {
    const char = source.at(index);
    if (char === "{") {
      depth += 1;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
    }
  }

  return depth;
}
