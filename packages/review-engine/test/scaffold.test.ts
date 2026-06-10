// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildReviewPrompt,
  composeWalkthrough,
  parseLLMReviewResponse,
  parseReviewDiff,
  parseUnifiedDiff,
  runReview,
} from "../src/index.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const previewSourceRoot = join(packageRoot, "src/preview");
const previewScriptRoot = join(packageRoot, "scripts");
const sourceRoot = join(packageRoot, "src");
const workspaceRoot = join(packageRoot, "../..");
const RelativeTypeScriptImportExpression =
  /\bfrom\s+["'](?<fromSpecifier>\.{1,2}\/[^"']+)["']|^\s*import\s+["'](?<sideEffectSpecifier>\.{1,2}\/[^"']+)["']|\bimport\s*\(\s*["'](?<dynamicSpecifier>\.{1,2}\/[^"']+)["']\s*\)/gmu;
const PreviewHtmlOutputRelativePaths: readonly string[] = [
  "packages/review-engine/.preview/comments-light.html",
  "packages/review-engine/.preview/comments-dark.html",
];
const PreviewOnlyRuntimePackages: readonly string[] = [
  "@playwright/test",
  "happy-dom",
  "jsdom",
  "marked",
  "markdown-it",
  "playwright",
  "puppeteer",
  "react",
  "react-dom",
  "vite",
];

interface ReviewEnginePackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly scripts: Readonly<Record<string, string>>;
}

interface ForbiddenCommonJsExpression {
  readonly label: string;
  readonly pattern: RegExp;
}

/** Forbidden TypeScript fragment tracked by the preview scaffold gate. */
interface ForbiddenTypeScriptEscapeHatchExpression {
  readonly label: string;
  readonly pattern: RegExp;
}

/** Regression case for a forbidden TypeScript escape-hatch fragment. */
interface ForbiddenTypeScriptEscapeHatchCase {
  readonly forbiddenFragment: string;
  readonly source: string;
}

const ForbiddenCommonJsExpressions: readonly ForbiddenCommonJsExpression[] = [
  {
    label: "require(",
    pattern: /\brequire\s*\(/u,
  },
  {
    label: "module.exports",
    pattern: /\bmodule\.exports\b/u,
  },
  {
    label: "exports",
    pattern: /\bexports(?:\.|\[)/u,
  },
];

const ExplicitAnyTypePositionPatternFragments: readonly string[] = [
  // Type annotations: const value: any
  String.raw`(?<typeAnnotation>:\s*any\b)`,
  // Type assertions: value as any
  String.raw`(?<typeAssertion>\bas\s+any\b)`,
  // Alias, generic, union, intersection, and tuple positions.
  String.raw`(?<structuredTypePosition>(?:[=<,|&]|\[)\s*any\b)`,
];

const ExplicitAnyTypePositionPattern = new RegExp(
  ExplicitAnyTypePositionPatternFragments.join("|"),
  "u",
);
const UnknownTypeAssertionPattern = /(?:\b[\w$]+|[)\]}])\s+as\s+unknown\b/u;
const TypeScriptQuotedStringExpression = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu;
const RegexLiteralPrecedingCharacters = new Set([
  "(",
  ",",
  ";",
  ":",
  "=",
  "{",
  "&",
  "|",
  "!",
  "?",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

const ForbiddenTypeScriptTypePositionEscapeHatchExpressions: readonly ForbiddenTypeScriptEscapeHatchExpression[] =
  [
    {
      label: "any",
      pattern: ExplicitAnyTypePositionPattern,
    },
    {
      label: "as unknown",
      pattern: UnknownTypeAssertionPattern,
    },
  ];

const ForbiddenTypeScriptDirectiveEscapeHatchExpressions: readonly ForbiddenTypeScriptEscapeHatchExpression[] =
  [
    {
      label: "@ts-ignore",
      pattern: /@ts-ignore/u,
    },
    {
      label: "@ts-expect-error",
      pattern: /@ts-expect-error/u,
    },
  ];

const ForbiddenTypeScriptEscapeHatchCases: readonly ForbiddenTypeScriptEscapeHatchCase[] = [
  {
    forbiddenFragment: "any",
    source: "const unsafeValue: any = {};",
  },
  {
    forbiddenFragment: "any",
    source: "const unsafeValue = `${/* } */ value as any}`;",
  },
  {
    forbiddenFragment: "as unknown",
    source: "const unsafeValue = value as unknown;",
  },
  {
    forbiddenFragment: "@ts-ignore",
    source: ["// @ts-ignore", "const ignored = value;"].join("\n"),
  },
  {
    forbiddenFragment: "@ts-expect-error",
    source: ["// @ts-expect-error", "const expectedError = value;"].join("\n"),
  },
];

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readReviewEnginePackageManifest(): ReviewEnginePackageManifest {
  const manifest = readJson(join(packageRoot, "package.json"));

  if (!isRecord(manifest)) {
    throw new TypeError("Expected review-engine package manifest to be a JSON object.");
  }

  const { dependencies, exports: packageExports, scripts } = manifest;

  if (!isStringRecord(scripts)) {
    throw new TypeError("Expected review-engine package manifest scripts to be string entries.");
  }

  if (dependencies !== undefined && !isStringRecord(dependencies)) {
    throw new TypeError(
      "Expected review-engine package manifest dependencies to be string entries.",
    );
  }

  const validatedManifest = dependencies === undefined ? { scripts } : { dependencies, scripts };

  return packageExports === undefined
    ? validatedManifest
    : { ...validatedManifest, exports: packageExports };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => extname(path) === ".ts");
}

describe("@sovri/review-engine scaffold", () => {
  it("declares a buildable workspace package with the expected dependencies", () => {
    expect(readJson(join(packageRoot, "package.json"))).toMatchObject({
      name: "@sovri/review-engine",
      license: "Apache-2.0",
      type: "module",
      scripts: { build: "tsup" },
      dependencies: {
        "@sovri/core": "workspace:*",
        "@sovri/llm-providers": "workspace:*",
        "@sovri/observability": "workspace:*",
        "parse-diff": "0.12.0",
        uuid: "14.0.0",
        zod: "4.4.3",
      },
    });
    expect(existsSync(join(packageRoot, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(packageRoot, "tsup.config.ts"))).toBe(true);
  });

  it("exposes the comments preview script without runtime preview dependencies", () => {
    // When the review-engine package manifest is inspected
    const manifest = readReviewEnginePackageManifest();

    // Then the "scripts" object contains "preview:comments"
    expect(manifest.scripts["preview:comments"]).toBeDefined();
    expect(manifest.scripts["preview:comments"]?.length).toBeGreaterThan(0);

    // And the "dependencies" object contains no package added only for preview rendering
    const dependencies = manifest.dependencies ?? {};
    for (const packageName of PreviewOnlyRuntimePackages) {
      expect(dependencies).not.toHaveProperty(packageName);
    }

    // And the preview script is not referenced by the package "build" script
    expect(manifest.scripts.build ?? "").not.toContain("preview:comments");
  });

  it("generates ignored comments preview HTML outside the shipped source surface", () => {
    // Given the preview script writes light and dark HTML files
    const manifest = readReviewEnginePackageManifest();
    removePreviewHtmlOutputs();

    const result = spawnSync("pnpm", ["--filter", "@sovri/review-engine", "preview:comments"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    });

    expect(result.status, formatProcessOutput(result)).toBe(0);

    for (const outputRelativePath of PreviewHtmlOutputRelativePaths) {
      const outputPath = join(workspaceRoot, outputRelativePath);

      expect(existsSync(outputPath), `${outputRelativePath} must be generated`).toBe(true);

      // When the repository status is inspected after generation
      const ignoreResult = spawnSync("git", ["check-ignore", "--quiet", outputRelativePath], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });

      // Then the generated HTML files are ignored by Git
      expect(ignoreResult.status, `${outputRelativePath} must be ignored by Git`).toBe(0);
    }

    const packageExports = JSON.stringify(manifest.exports ?? {});
    const rootBarrel = readFileSync(join(sourceRoot, "index.ts"), "utf8");

    // And no generated HTML file is listed in the package exports
    // And no generated HTML file is included by the package root barrel
    for (const outputRelativePath of PreviewHtmlOutputRelativePaths) {
      expect(packageExports).not.toContain(outputRelativePath);
      expect(rootBarrel).not.toContain(outputRelativePath);
    }
    expect(packageExports).not.toContain(".preview");
    expect(packageExports).not.toContain(".html");
    expect(rootBarrel).not.toContain(".preview");
    expect(rootBarrel).not.toContain(".html");
  });

  it("keeps preview TypeScript files under the required source contract", () => {
    // Given the new preview source files are under "packages/review-engine/src/preview/"
    const previewSourceFiles = listTypeScriptFiles(previewSourceRoot);
    // And the new preview script is under "packages/review-engine/scripts/"
    const previewScriptFiles = listTypeScriptFilesIfPresent(previewScriptRoot);
    expect(previewSourceFiles.length).toBeGreaterThan(0);
    expect(
      previewScriptFiles,
      "packages/review-engine/scripts/ must contain the preview script TypeScript file",
    ).not.toEqual([]);

    // When the preview source files are inspected
    const inspectedFiles = [...previewSourceFiles, ...previewScriptFiles];

    for (const inspectedFile of inspectedFiles) {
      const content = readFileSync(inspectedFile, "utf8");
      const relativePath = relative(packageRoot, inspectedFile);
      const [spdxHeader, copyrightHeader] = content.split(/\r?\n/u);

      // Then every new TypeScript file starts with "SPDX-License-Identifier: Apache-2.0"
      expect(spdxHeader, `${relativePath} must start with the SPDX header`).toContain(
        "SPDX-License-Identifier: Apache-2.0",
      );
      // And every new TypeScript file starts with "Copyright 2026 Sovri SAS"
      expect(copyrightHeader, `${relativePath} must carry the Sovri copyright header`).toContain(
        "Copyright 2026 Sovri SAS",
      );
      // And every relative TypeScript import uses an explicit ".js" extension
      for (const importSpecifier of collectRelativeImportSpecifiers(content)) {
        expect(
          importSpecifier,
          `${relativePath} relative import "${importSpecifier}" must use a .js extension`,
        ).toMatch(/\.js$/u);
      }
      // And no file contains "require(" or other CommonJS export forms
      expect(
        collectForbiddenCommonJsExpressions(content),
        `${relativePath} must not contain CommonJS entry points`,
      ).toEqual([]);
      // And no file contains forbidden TypeScript escape hatches
      expect(
        collectForbiddenTypeScriptEscapeHatches(content),
        `${relativePath} must not contain TypeScript escape hatches`,
      ).toEqual([]);
    }
  });

  it("collects side-effect relative imports for source contract checks", () => {
    expect(
      collectRelativeImportSpecifiers(`
        import "./setup";
        import { value } from "../value";
        export { exported } from "../exported";
        const lazy = await import("./lazy");
      `),
    ).toEqual(["./setup", "../value", "../exported", "./lazy"]);
  });

  it("collects forbidden CommonJS expressions for source contract checks", () => {
    expect(
      collectForbiddenCommonJsExpressions(`
        const loader = require("./setup");
        module.exports = {};
        exports.value = 1;
        exports["other"] = 2;
      `),
    ).toEqual(["require(", "module.exports", "exports"]);
  });

  it.each(ForbiddenTypeScriptEscapeHatchCases)(
    "fails preview quality gate for $forbiddenFragment",
    ({ forbiddenFragment, source }) => {
      // Given a new preview source file contains "<forbiddenFragment>"
      // When the quality gate runs
      const violations = collectForbiddenTypeScriptEscapeHatches(source);

      // Then validation fails
      expect(violations).not.toEqual([]);
      // And the failure names "<forbiddenFragment>"
      expect(violations).toContain(forbiddenFragment);
    },
  );

  it("allows ordinary prose that contains any without an explicit any type", () => {
    expect(
      collectForbiddenTypeScriptEscapeHatches(`
        // type Unsafe = any;
        const previewCopy = "render any markdown payload";
        const summary = "Record<string, any> appears in docs";
        const unknownSummary = "value as unknown to the system";
        const directiveSnippet = "// @ts-ignore";
        const templateDirectiveSnippet = \`markdown mentions @ts-expect-error\`;
      `),
    ).toEqual([]);

    expect(
      collectForbiddenTypeScriptEscapeHatches(`
        type Unsafe = any;
        const explicitType: any = {};
        const asserted = value as any;
        const recordValues: Record<string, any> = {};
        const unionValue: Safe | any = value;
        const intersectionValue: Safe & any = value;
        const genericValues = new Set<any>();
        const arrayValues: any[] = [];
        const templateCast = \`\${value as any}\`;
        const templateUrlCast = \`https://example.test/\${value as any}\`;
        const templateQuotedBraceCast = \`\${"}" && (value as any)}\`;
        const templateUnknown = \`\${value as unknown as string}\`;
        const objectLiteralUnknown = ({ payload } as unknown as PreviewValue);
      `),
    ).toEqual(["any", "as unknown"]);
  });

  it("still catches an escape hatch hidden behind a regex literal slash", () => {
    // Given a regex literal whose character class holds "//"
    // When a forbidden cast follows it on the same line
    // Then the regex body is stepped over and the cast is still reported
    expect(
      collectForbiddenTypeScriptEscapeHatches(
        "const pattern = /[//]/u; const unsafe = value as any;",
      ),
    ).toEqual(["any"]);
  });

  it("strips a real comment that trails a regex literal containing slashes", () => {
    // Given a regex literal followed by a genuine line comment carrying "as any"
    // When the quality gate runs
    // Then the comment is removed and nothing is reported
    expect(
      collectForbiddenTypeScriptEscapeHatches(
        ["const pattern = /[//]/u; // const ignored = value as any;", "const safe = value;"].join(
          "\n",
        ),
      ),
    ).toEqual([]);
  });

  it("keeps division operators from being read as regex literals", () => {
    // Given a division expression whose operands surround a forbidden cast
    // When the quality gate runs
    // Then the slash stays division and the cast is still reported
    expect(
      collectForbiddenTypeScriptEscapeHatches("const ratio = total / (value as any) / divisor;"),
    ).toEqual(["any"]);
  });

  it("separates the review-engine responsibilities into dedicated modules", () => {
    expect(existsSync(join(sourceRoot, "diff/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "prompt/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "parsing/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "walkthrough/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "orchestrator.ts"))).toBe(true);
  });

  it("exports a thin public surface for the scaffold responsibilities", () => {
    expect(typeof parseReviewDiff).toBe("function");
    expect(typeof buildReviewPrompt).toBe("function");
    expect(typeof parseLLMReviewResponse).toBe("function");
    expect(typeof composeWalkthrough).toBe("function");
    expect(typeof runReview).toBe("function");
    expect(typeof parseUnifiedDiff).toBe("function");
  });
});

function removePreviewHtmlOutputs(): void {
  for (const outputRelativePath of PreviewHtmlOutputRelativePaths) {
    rmSync(join(workspaceRoot, outputRelativePath), { force: true });
  }
}

function listTypeScriptFilesIfPresent(root: string): string[] {
  return existsSync(root) ? listTypeScriptFiles(root) : [];
}

function collectRelativeImportSpecifiers(content: string): readonly string[] {
  return [...content.matchAll(RelativeTypeScriptImportExpression)].flatMap((match) => {
    const fromSpecifier = match.groups?.fromSpecifier;
    const sideEffectSpecifier = match.groups?.sideEffectSpecifier;
    const dynamicSpecifier = match.groups?.dynamicSpecifier;
    return [fromSpecifier, sideEffectSpecifier, dynamicSpecifier].filter(isDefinedString);
  });
}

function collectForbiddenCommonJsExpressions(content: string): readonly string[] {
  return ForbiddenCommonJsExpressions.flatMap(({ label, pattern }) =>
    pattern.test(content) ? [label] : [],
  );
}

function collectForbiddenTypeScriptEscapeHatches(content: string): readonly string[] {
  const typePositionContent = stripTypeScriptCommentsAndStrings(content);
  const directiveContent = stripTypeScriptStringsAndTemplateStaticText(content);
  const typePositionMatches = collectForbiddenTypeScriptExpressionLabels(
    typePositionContent,
    ForbiddenTypeScriptTypePositionEscapeHatchExpressions,
  );
  const directiveMatches = collectForbiddenTypeScriptExpressionLabels(
    directiveContent,
    ForbiddenTypeScriptDirectiveEscapeHatchExpressions,
  );

  return [...typePositionMatches, ...directiveMatches];
}

function collectForbiddenTypeScriptExpressionLabels(
  content: string,
  expressions: readonly ForbiddenTypeScriptEscapeHatchExpression[],
): readonly string[] {
  const labels: string[] = [];

  for (const { label, pattern } of expressions) {
    if (pattern.test(content)) {
      labels.push(label);
    }
  }

  return labels;
}

function stripTypeScriptCommentsAndStrings(content: string): string {
  return stripTypeScriptComments(stripTypeScriptStringsAndTemplateStaticText(content));
}

/**
 * Removes line and block comments while stepping over regex literals, so a `//`
 * or `/*` marker inside a regex body is never mistaken for a comment that would
 * swallow a forbidden token later on the same line. Strings and template prose
 * are already gone before this pass, leaving comments, regex literals, and
 * division as the only `/`-led constructs.
 */
function stripTypeScriptComments(content: string): string {
  let stripped = "";
  let index = 0;
  let previousSignificantCharacter = "";

  while (index < content.length) {
    const character = content[index] ?? "";
    const regexEnd = startsRegexLiteral(content, index, previousSignificantCharacter)
      ? readRegexLiteralEnd(content, index)
      : undefined;

    if (regexEnd !== undefined) {
      stripped += content.slice(index, regexEnd);
      previousSignificantCharacter = "/";
      index = regexEnd;
      continue;
    }

    const comment = readTypeScriptCommentContent(content, index);

    if (comment !== undefined) {
      index = comment.nextIndex;
      continue;
    }

    stripped += character;
    if (!/\s/u.test(character)) {
      previousSignificantCharacter = character;
    }
    index += 1;
  }

  return stripped;
}

/**
 * Decides whether the slash at `index` opens a regex literal. A `/` followed by
 * `/` or `*` is always a comment, never an empty regex, so those are excluded.
 * Otherwise the slash opens a regex only in expression position, biased toward
 * division so a stray match can never consume real code.
 */
function startsRegexLiteral(
  content: string,
  index: number,
  previousSignificantCharacter: string,
): boolean {
  if (content[index] !== "/") {
    return false;
  }

  const nextCharacter = content[index + 1];

  if (nextCharacter === undefined || nextCharacter === "/" || nextCharacter === "*") {
    return false;
  }

  return (
    previousSignificantCharacter === "" ||
    RegexLiteralPrecedingCharacters.has(previousSignificantCharacter)
  );
}

/**
 * Returns the index past a regex literal that opens at `startIndex`, including
 * its trailing flags. Slashes inside a character class do not close the literal,
 * and a regex never spans a line, so an unterminated candidate yields undefined.
 */
function readRegexLiteralEnd(content: string, startIndex: number): number | undefined {
  let index = startIndex + 1;
  let insideCharacterClass = false;

  while (index < content.length) {
    const character = content[index];

    if (character === "\\") {
      index = skipEscapedCharacter(index);
      continue;
    }

    if (character === "\n" || character === "\r") {
      return undefined;
    }

    if (character === "[") {
      insideCharacterClass = true;
    } else if (character === "]") {
      insideCharacterClass = false;
    } else if (character === "/" && !insideCharacterClass) {
      return skipRegexLiteralFlags(content, index + 1);
    }

    index += 1;
  }

  return undefined;
}

/** Advances past the lowercase flag suffix that follows a regex literal. */
function skipRegexLiteralFlags(content: string, startIndex: number): number {
  let index = startIndex;

  while (index < content.length && /[a-z]/iu.test(content[index] ?? "")) {
    index += 1;
  }

  return index;
}

function stripTypeScriptStringsAndTemplateStaticText(content: string): string {
  return stripTemplateLiteralStaticText(content).replace(TypeScriptQuotedStringExpression, "");
}

interface TemplateLiteralExpressionContent {
  readonly content: string;
  readonly nextIndex: number;
}

/**
 * Drops static template prose while preserving interpolation expressions so the
 * scanner still catches forbidden TypeScript inside `${...}` blocks.
 * Unclosed templates are scanned to EOF, and nested interpolations are stripped
 * recursively before their expression source is retained.
 */
function stripTemplateLiteralStaticText(content: string): string {
  let strippedContent = "";
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (character !== "`") {
      strippedContent += character;
      index += 1;
      continue;
    }

    const templateContent = readTemplateLiteralRetainedContent(content, index + 1);
    strippedContent += templateContent.content;
    index = templateContent.nextIndex;
  }

  return strippedContent;
}

/**
 * Reads one template literal body and returns only nested interpolation source.
 * Nested templates are stripped recursively so static prose never reaches the
 * type-position scanner.
 */
function readTemplateLiteralRetainedContent(
  content: string,
  startIndex: number,
): TemplateLiteralExpressionContent {
  let retainedContent = "";
  let index = startIndex;

  while (index < content.length) {
    const character = content[index];

    if (character === "\\") {
      index = skipEscapedCharacter(index);
      continue;
    }

    if (character === "`") {
      return { content: retainedContent, nextIndex: index + 1 };
    }

    if (isTemplateInterpolationStart(content, index)) {
      const expression = readTemplateLiteralExpressionContent(content, index + 2);
      retainedContent += stripTemplateLiteralStaticText(expression.content);
      index = expression.nextIndex;
      continue;
    }

    index += 1;
  }

  return { content: retainedContent, nextIndex: content.length };
}

/** Detects the start of a `${...}` interpolation inside a template literal. */
function isTemplateInterpolationStart(content: string, index: number): boolean {
  return content[index] === "$" && content[index + 1] === "{";
}

/** Advances over an escaped byte pair while scanning TypeScript-like text. */
function skipEscapedCharacter(index: number): number {
  return index + 2;
}

/**
 * Reads an interpolation expression until its matching closing brace, ignoring
 * braces that appear inside quoted strings, comments, or nested expression
 * blocks.
 */
function readTemplateLiteralExpressionContent(
  content: string,
  startIndex: number,
): TemplateLiteralExpressionContent {
  let expressionContent = "";
  let index = startIndex;
  let depth = 1;

  while (index < content.length) {
    const character = content[index];

    if (character === '"' || character === "'" || character === "`") {
      const stringContent = readQuotedStringContent(content, index, character);
      expressionContent += stringContent.content;
      index = stringContent.nextIndex;
      continue;
    }

    const commentContent = readTypeScriptCommentContent(content, index);

    if (commentContent !== undefined) {
      expressionContent += commentContent.content;
      index = commentContent.nextIndex;
      continue;
    }

    if (character === "\\") {
      expressionContent += content.slice(index, index + 2);
      index = skipEscapedCharacter(index);
      continue;
    }

    if (character === "{") {
      depth += 1;
      expressionContent += character;
      index += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return { content: expressionContent, nextIndex: index + 1 };
      }

      expressionContent += character;
      index += 1;
      continue;
    }

    expressionContent += character;
    index += 1;
  }

  return { content: expressionContent, nextIndex: content.length };
}

/**
 * Reads a TypeScript comment inside an interpolation without interpreting
 * comment braces as syntax.
 */
function readTypeScriptCommentContent(
  content: string,
  startIndex: number,
): TemplateLiteralExpressionContent | undefined {
  if (content[startIndex] !== "/") {
    return undefined;
  }

  if (content[startIndex + 1] === "/") {
    return readLineCommentContent(content, startIndex);
  }

  if (content[startIndex + 1] === "*") {
    return readBlockCommentContent(content, startIndex);
  }

  return undefined;
}

/** Reads a line comment through its line terminator or EOF. */
function readLineCommentContent(
  content: string,
  startIndex: number,
): TemplateLiteralExpressionContent {
  const lineFeedIndex = content.indexOf("\n", startIndex + 2);
  const carriageReturnIndex = content.indexOf("\r", startIndex + 2);
  const endIndex = minFoundIndex(lineFeedIndex, carriageReturnIndex) ?? content.length;

  return { content: content.slice(startIndex, endIndex), nextIndex: endIndex };
}

/** Reads a block comment through its closing marker or EOF. */
function readBlockCommentContent(
  content: string,
  startIndex: number,
): TemplateLiteralExpressionContent {
  const closingIndex = content.indexOf("*/", startIndex + 2);
  const nextIndex = closingIndex === -1 ? content.length : closingIndex + 2;

  return { content: content.slice(startIndex, nextIndex), nextIndex };
}

/** Returns the smallest found string index, treating -1 as not found. */
function minFoundIndex(firstIndex: number, secondIndex: number): number | undefined {
  if (firstIndex === -1) {
    return secondIndex === -1 ? undefined : secondIndex;
  }

  if (secondIndex === -1) {
    return firstIndex;
  }

  return Math.min(firstIndex, secondIndex);
}

/**
 * Reads a quoted string without interpreting braces inside it as syntax.
 * Escaped quotes are skipped with their escaped byte pair, so they do not end
 * the string.
 */
function readQuotedStringContent(
  content: string,
  startIndex: number,
  quoteCharacter: string,
): TemplateLiteralExpressionContent {
  let index = startIndex + 1;

  while (index < content.length) {
    const character = content[index];

    if (character === "\\") {
      index = skipEscapedCharacter(index);
      continue;
    }

    if (character === quoteCharacter) {
      return {
        content: content.slice(startIndex, index + 1),
        nextIndex: index + 1,
      };
    }

    index += 1;
  }

  return { content: content.slice(startIndex), nextIndex: content.length };
}

function isDefinedString(value: string | undefined): value is string {
  return value !== undefined;
}

function formatProcessOutput(result: SpawnSyncReturns<string>): string {
  return [result.stdout.trim(), result.stderr.trim()]
    .filter((output) => output.length > 0)
    .join("\n");
}
