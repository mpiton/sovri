// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * Split a unified diff into per-file patch blocks, each starting at a
 * `diff --git ` header line. Internal helper shared by the diff filter and
 * parser; intentionally not re-exported from the package barrel.
 */
export function splitFilePatches(unifiedDiff: string): string[] {
  const patches: string[] = [];
  let currentPatch: string[] | undefined;

  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentPatch !== undefined) {
        patches.push(currentPatch.join("\n"));
      }
      currentPatch = [line];
    } else {
      currentPatch?.push(line);
    }
  }

  if (currentPatch !== undefined) {
    patches.push(currentPatch.join("\n"));
  }

  return patches;
}
