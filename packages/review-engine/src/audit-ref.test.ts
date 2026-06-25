// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import type { Category } from "@sovri/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAuditReference } from "./audit-ref.js";

// Controlled entropy: node:crypto is the only randomness source (R-05). Mocking
// it makes every scenario deterministic and avoids flaky uniqueness sampling.
const cryptoMock = vi.hoisted(() => ({
  randomBytes: vi.fn<(size: number) => Buffer>(),
}));

vi.mock("node:crypto", () => ({
  randomBytes: cryptoMock.randomBytes,
}));

const AUDIT_REFERENCE_PATTERN = /^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/;

// R-02: the fixed category -> two-letter code table.
const CATEGORY_CODE_CASES: ReadonlyArray<readonly [Category, string]> = [
  ["bug", "BG"],
  ["security", "SC"],
];

// R-01 + R-03: boundary byte values must still render a well-formed reference.
const BOUNDARY_CASES: ReadonlyArray<
  readonly [readonly number[], readonly number[], string, string]
> = [
  [[0x00, 0x00], [0x00, 0x00], "0000", "0000"],
  [[0xff, 0xff], [0xff, 0xff], "FFFF", "FFFF"],
];

beforeEach(() => {
  vi.resetAllMocks();
  // Default entropy so format/prefix scenarios are deterministic.
  cryptoMock.randomBytes.mockReturnValue(Buffer.from([0xab, 0x12]));
});

describe("generateAuditReference", () => {
  // Rule: R-01, R-02
  it("produces a reference in the canonical SOVRI-XX-HHHH-HHHH format", () => {
    // Given a finding in the "security" category
    // When an audit reference is generated for it
    const reference = generateAuditReference("security");

    // Then the reference matches the canonical pattern
    expect(reference).toMatch(AUDIT_REFERENCE_PATTERN);
    // And the reference starts with "SOVRI-SC-"
    expect(reference.startsWith("SOVRI-SC-")).toBe(true);
  });

  // Rule: R-02
  it.each(CATEGORY_CODE_CASES)('maps category "%s" to its fixed code "%s"', (category, code) => {
    // Given a finding in the "<category>" category
    // When an audit reference is generated for it
    const reference = generateAuditReference(category);

    // Then the reference starts with "SOVRI-<code>-"
    expect(reference.startsWith(`SOVRI-${code}-`)).toBe(true);
    // And the reference matches the canonical pattern
    expect(reference).toMatch(AUDIT_REFERENCE_PATTERN);
  });

  // Rule: R-03, R-05
  it("builds each segment from two random bytes as four uppercase hex chars", () => {
    // Given the entropy source yields the bytes "AB 12" then "CD 34"
    cryptoMock.randomBytes
      .mockReturnValueOnce(Buffer.from([0xab, 0x12]))
      .mockReturnValueOnce(Buffer.from([0xcd, 0x34]));

    // And a finding in the "security" category
    // When an audit reference is generated for it
    const reference = generateAuditReference("security");

    // Then the reference equals "SOVRI-SC-AB12-CD34"
    expect(reference).toBe("SOVRI-SC-AB12-CD34");
    // And the entropy source was read twice, two bytes per read
    expect(cryptoMock.randomBytes).toHaveBeenCalledTimes(2);
    expect(cryptoMock.randomBytes).toHaveBeenNthCalledWith(1, 2);
    expect(cryptoMock.randomBytes).toHaveBeenNthCalledWith(2, 2);
  });

  // Rule: R-01, R-03
  it.each(BOUNDARY_CASES)(
    "renders boundary bytes (%j, %j) as a well-formed reference",
    (first, second, seg1, seg2) => {
      // Given the entropy source yields the boundary bytes
      cryptoMock.randomBytes
        .mockReturnValueOnce(Buffer.from([...first]))
        .mockReturnValueOnce(Buffer.from([...second]));

      // And a finding in the "bug" category
      // When an audit reference is generated for it
      const reference = generateAuditReference("bug");

      // Then the reference equals the expected boundary value
      expect(reference).toBe(`SOVRI-BG-${seg1}-${seg2}`);
      // And the reference matches the canonical pattern
      expect(reference).toMatch(AUDIT_REFERENCE_PATTERN);
    },
  );

  // Rule: R-04, R-05
  it("produces different references for different entropy draws", () => {
    // Given a finding in the "security" category
    // And the entropy source yields "AB 12"/"CD 34" then "56 78"/"9A BC"
    cryptoMock.randomBytes
      .mockReturnValueOnce(Buffer.from([0xab, 0x12]))
      .mockReturnValueOnce(Buffer.from([0xcd, 0x34]))
      .mockReturnValueOnce(Buffer.from([0x56, 0x78]))
      .mockReturnValueOnce(Buffer.from([0x9a, 0xbc]));

    // When an audit reference is generated twice for it
    const first = generateAuditReference("security");
    const second = generateAuditReference("security");

    // Then each reference equals its expected value
    expect(first).toBe("SOVRI-SC-AB12-CD34");
    expect(second).toBe("SOVRI-SC-5678-9ABC");
    // And the two references are different
    expect(first).not.toBe(second);
  });
});
