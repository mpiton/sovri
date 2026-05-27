// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getCweMap } from "../index.js";

const loaderSourcePath = fileURLToPath(new URL("./loader.ts", import.meta.url));
const forbiddenLoaderPatterns = ["import(", "fs.readFile", "readFileSync"];

function findForbiddenLoaderPattern(source: string): string | undefined {
  return forbiddenLoaderPatterns.find((pattern) => source.includes(pattern));
}

describe("getCweMap", () => {
  it("returns a pre-built readonly map", () => {
    const cweMap = getCweMap();

    expect(cweMap).toBeInstanceOf(Map);
    for (const key of cweMap.keys()) {
      expect(key).toMatch(/^CWE-\d+$/);
    }
  });

  it("returns undefined for an unknown CWE without throwing", () => {
    const cweMap = getCweMap();

    expect(() => cweMap.get("CWE-9999")).not.toThrow();
    expect(cweMap.get("CWE-9999")).toBeUndefined();
  });

  it("returns the statically imported CWE-798 mapping entry", () => {
    const entry = getCweMap().get("CWE-798");

    expect(entry?.cwe_id).toBe("CWE-798");
    expect(entry?.title).toBe("Use of Hard-coded Credentials");
    expect(entry?.references[0]?.framework).toBe("CWE");
  });

  it("does not return a placeholder entry for an unknown CWE", () => {
    const entry = getCweMap().get("CWE-9999");

    expect(entry).toBeUndefined();
  });

  it("keeps missing lookup behavior stable across repeated calls", () => {
    const cweMap = getCweMap();

    expect([cweMap.get("CWE-9999"), cweMap.get("CWE-9999"), cweMap.get("CWE-9999")]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("contains no runtime filesystem or dynamic import path", () => {
    const loaderSource = readFileSync(loaderSourcePath, "utf8");

    expect(loaderSource).not.toContain("node:fs");
    expect(findForbiddenLoaderPattern(loaderSource)).toBeUndefined();
  });

  it.each(forbiddenLoaderPatterns)(
    "rejects forbidden loader pattern %s in the static constraint check",
    (forbiddenPattern) => {
      const candidateLoaderSource = `export function load() { return ${forbiddenPattern}; }`;

      expect(findForbiddenLoaderPattern(candidateLoaderSource)).toBe(forbiddenPattern);
    },
  );

  it("reuses the same loaded map contents across calls", () => {
    expect(getCweMap()).toEqual(getCweMap());
    expect(getCweMap().get("CWE-9999")).toBeUndefined();
  });

  it("prevents mutation of one returned map from corrupting later lookups", () => {
    const returnedMap = getCweMap();
    if (!(returnedMap instanceof Map)) {
      throw new TypeError("Expected getCweMap to return a Map-compatible value.");
    }

    returnedMap.clear();

    expect(getCweMap().get("CWE-798")?.cwe_id).toBe("CWE-798");
  });

  it("prevents mutation of returned mapping entries from corrupting later lookups", () => {
    const entry = getCweMap().get("CWE-798");
    if (entry === undefined) {
      throw new TypeError("Expected CWE-798 to be mapped.");
    }
    const reference = entry.references[0];
    if (reference === undefined) {
      throw new TypeError("Expected CWE-798 to include a reference.");
    }

    expect(() => {
      entry.title = "Corrupted mapping";
    }).toThrow(TypeError);
    expect(() => {
      entry.references.push(reference);
    }).toThrow(TypeError);

    expect(getCweMap().get("CWE-798")?.title).toBe("Use of Hard-coded Credentials");
    expect(getCweMap().get("CWE-798")?.references).toHaveLength(1);
  });
});
