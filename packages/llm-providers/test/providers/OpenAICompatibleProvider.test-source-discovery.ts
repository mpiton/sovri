// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readdir, readFile } from "node:fs/promises";

const ProviderTestDiscovery = {
  directory: new URL("../../src/providers/", import.meta.url),
  selfFileName: "OpenAICompatibleProvider.no-network.test.ts",
  additionalFileNames: ["OpenAIProvider.compatible.exports.test.ts"],
};

export interface ProviderTestSource {
  readonly fileName: string;
  readonly source: string;
}

export async function readOpenAICompatibleProviderTestSources(): Promise<ProviderTestSource[]> {
  const fileNames = (await readdir(ProviderTestDiscovery.directory))
    .filter(
      (fileName) =>
        isDiscoveredCompatibleProviderTestFile(fileName) &&
        fileName.endsWith(".test.ts") &&
        fileName !== ProviderTestDiscovery.selfFileName,
    )
    .toSorted();

  return Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      source: await readFile(new URL(fileName, ProviderTestDiscovery.directory), "utf8"),
    })),
  );
}

function isDiscoveredCompatibleProviderTestFile(fileName: string): boolean {
  return (
    fileName.startsWith("OpenAICompatibleProvider.") ||
    ProviderTestDiscovery.additionalFileNames.includes(fileName)
  );
}
