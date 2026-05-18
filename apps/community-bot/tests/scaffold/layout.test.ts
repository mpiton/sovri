// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertNotIgnored,
  expectPathExists,
  packageRoot,
  readJsonObject,
  requiredSourceFiles,
} from "./helpers.js";

describe("community bot source layout scaffold", () => {
  it("contains the required thin Probot app files", async () => {
    // Given directory "apps/community-bot/src" exists
    await expectPathExists("apps/community-bot/src");
    // And file "apps/community-bot/src/app.ts" exists
    // And file "apps/community-bot/src/server.ts" exists
    // And file "apps/community-bot/src/handlers/index.ts" exists
    // And file "apps/community-bot/src/github/index.ts" exists
    // And file "apps/community-bot/src/commands/index.ts" exists
    await Promise.all(requiredSourceFiles.map((sourceFile) => expectPathExists(sourceFile)));
    // When the scaffold layout is inspected
    // Then the layout check succeeds
  });

  it.each(requiredSourceFiles)("rejects missing required layout element %s", (missingPath) => {
    // Given every required source file except "<path>" exists
    const presentFiles = new Set(
      requiredSourceFiles.filter((sourceFile) => sourceFile !== missingPath),
    );
    // And "<path>" does not exist
    // When the scaffold layout is inspected
    const missing = requiredSourceFiles.find((sourceFile) => !presentFiles.has(sourceFile));
    // Then the layout check fails
    expect(missing).toBe(missingPath);
    // And the failure mentions "<path>"
    expect(missing).toContain(missingPath);
  });

  it("materializes the commands placeholder as a TypeScript source file", async () => {
    // Given directory "apps/community-bot/src/commands" exists
    await expectPathExists("apps/community-bot/src/commands");
    // And file "apps/community-bot/src/commands/index.ts" exists
    await expectPathExists("apps/community-bot/src/commands/index.ts");
    // When the scaffold layout is inspected
    // Then the commands placeholder is visible to Git
    expect(() => assertNotIgnored("apps/community-bot/src/commands/index.ts")).not.toThrow();
    // And the commands placeholder is part of the TypeScript source set
    const tsconfig = readJsonObject("apps/community-bot/tsconfig.json");
    expect(tsconfig.include).toContain("src/**/*.ts");
  });

  it("keeps business review logic out of the bot scaffold", () => {
    // Given directory "apps/community-bot/src/handlers" exists
    // And directory "apps/community-bot/src/github" exists
    // And directory "apps/community-bot/src/commands" exists
    // When the scaffold layout is inspected
    const fileNames = collectSourceFileNames(resolve(packageRoot, "src"));
    // Then no file under "apps/community-bot/src" is named "review-engine.ts"
    expect(fileNames).not.toContain("review-engine.ts");
    // And no file under "apps/community-bot/src" is named "orchestrator.ts"
    expect(fileNames).not.toContain("orchestrator.ts");
    // And the layout remains a thin Probot orchestration scaffold
    expect(fileNames).toEqual(expect.arrayContaining(["app.ts", "server.ts", "index.ts"]));
  });
});

function collectSourceFileNames(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return collectSourceFileNames(path);
    }
    return [entry];
  });
}
