// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, expectTypeOf, it } from "vitest";
import { ZodError } from "zod";

import {
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
} from "../index.js";

const TS = "2026-05-26T14:32:00Z";

const NOMINAL_PAYLOADS = {
  "trail.started": { trail_id: "trail-7f3a", public_key: "ed25519:AAAAC3NzaC1lZDI1" },
  "review.started": {
    pr_id: 42,
    commit_sha: "abc1234",
    llm_provider: "mistral",
    llm_model: "mistral-large-2-2411",
  },
  "llm.called": { prompt_hash: "sha256:7f3a", tokens_in: 4521, tokens_out: 892 },
  "finding.created": {
    audit_reference: "SOVRI-AC-AB12-CD34",
    severity: "major",
    cwe: "CWE-798",
    compliance_references: ["GDPR-Art32", "DORA-Art9"],
  },
  "review.completed": {},
  "review.failed": { error_code: "LLM_TIMEOUT", error_message: "provider timed out after 30s" },
  correction: {
    target_audit_reference: "SOVRI-AC-AB12-CD34",
    reason: "fix typo in audit_reference",
    corrected_by: "compliance@bank.example",
  },
} as const;

const SIGNING_FIELDS = {
  previous_hash: "sha256:0000",
  entry_hash: "sha256:1111",
  signature: "ed25519:zzzz",
} as const;

function rejectLogical(value: unknown): ZodError {
  const result = AuditTrailLogicalEventSchema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected AuditTrailLogicalEventSchema to reject the value.");
  }
  return result.error;
}

function rejectSigned(value: unknown): ZodError {
  const result = SignedAuditTrailEntrySchema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected SignedAuditTrailEntrySchema to reject the value.");
  }
  return result.error;
}

// strict() reports unexpected keys via `keys` with an empty path; treat both as the error locus.
function errorLocus(error: ZodError): string[] {
  return error.issues.flatMap((issue) => {
    const segments = issue.path.map(String);
    if (issue.code === "unrecognized_keys") {
      return [...segments, ...issue.keys.map(String)];
    }
    return segments;
  });
}

describe("AuditTrailLogicalEventSchema — the seven logical event types validate (R-01, R-04, R-06)", () => {
  it.each(Object.entries(NOMINAL_PAYLOADS))(
    "validates a well-formed %s logical event",
    (event, payload) => {
      // Given a logical event with ts "2026-05-26T14:32:00Z" and event "<event>"
      // And the payload <payload>
      const logicalEvent = { ts: TS, event, ...payload };

      // When it is parsed by AuditTrailLogicalEventSchema
      const result = AuditTrailLogicalEventSchema.safeParse(logicalEvent);

      // Then the result is valid
      expect(result.success).toBe(true);

      // And the parsed event has no "previous_hash", "entry_hash" or "signature" field
      if (result.success) {
        expect(result.data).not.toHaveProperty("previous_hash");
        expect(result.data).not.toHaveProperty("entry_hash");
        expect(result.data).not.toHaveProperty("signature");
      }
    },
  );
});

describe("AuditTrailLogicalEventSchema — ts is mandatory and ISO-8601 (R-01)", () => {
  it("rejects a logical event without ts", () => {
    // Given a logical event for event "review.completed" with no ts field
    // When it is parsed by AuditTrailLogicalEventSchema
    // Then the result is invalid
    // And the error path includes "ts"
    const error = rejectLogical({ event: "review.completed" });
    expect(errorLocus(error)).toContain("ts");
  });

  it("rejects a logical event whose ts is not an ISO-8601 datetime", () => {
    // Given a logical event with ts "26/05/2026 14:32" and event "review.completed"
    // When it is parsed by AuditTrailLogicalEventSchema
    // Then the result is invalid
    // And the error path includes "ts"
    const error = rejectLogical({ ts: "26/05/2026 14:32", event: "review.completed" });
    expect(errorLocus(error)).toContain("ts");
  });
});

describe("AuditTrailLogicalEventSchema — discriminated union on event (R-06)", () => {
  it("rejects an unknown event discriminator", () => {
    // Given a logical event with ts "2026-05-26T14:32:00Z" and event "review.cancelled"
    // When it is parsed by AuditTrailLogicalEventSchema
    // Then the result is invalid
    rejectLogical({ ts: TS, event: "review.cancelled" });
  });

  it("rejects a logical event with no event discriminator", () => {
    // Given a logical event with ts "2026-05-26T14:32:00Z" and no event field
    // When it is parsed by AuditTrailLogicalEventSchema
    // Then the result is invalid
    rejectLogical({ ts: TS });
  });
});

describe("AuditTrailLogicalEventSchema — per-type payloads (R-04)", () => {
  it("rejects a review.started event missing commit_sha", () => {
    // Given event "review.started" without commit_sha
    // Then the result is invalid / the error path includes "commit_sha"
    const error = rejectLogical({
      ts: TS,
      event: "review.started",
      pr_id: 42,
      llm_provider: "mistral",
      llm_model: "mistral-large-2-2411",
    });
    expect(errorLocus(error)).toContain("commit_sha");
  });

  it("rejects a finding.created event with a severity outside the allowed set", () => {
    // Given finding.created with severity "catastrophic"
    // Then the result is invalid / the error path includes "severity"
    const error = rejectLogical({
      ts: TS,
      event: "finding.created",
      audit_reference: "SOVRI-AC-AB12-CD34",
      severity: "catastrophic",
      compliance_references: [],
    });
    expect(errorLocus(error)).toContain("severity");
  });

  it("rejects a finding.created event with a malformed audit_reference", () => {
    // Given finding.created with audit_reference "AC-AB12-CD34"
    // Then the result is invalid / the error path includes "audit_reference"
    const error = rejectLogical({
      ts: TS,
      event: "finding.created",
      audit_reference: "AC-AB12-CD34",
      severity: "major",
      compliance_references: [],
    });
    expect(errorLocus(error)).toContain("audit_reference");
  });

  it("accepts a finding.created event without the optional cwe", () => {
    // Given finding.created without cwe / Then the result is valid
    const result = AuditTrailLogicalEventSchema.safeParse({
      ts: TS,
      event: "finding.created",
      audit_reference: "SOVRI-AC-AB12-CD34",
      severity: "minor",
      compliance_references: ["GDPR-Art32"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a finding.created event with a malformed cwe", () => {
    // Given finding.created with cwe "798"
    // Then the result is invalid / the error path includes "cwe"
    const error = rejectLogical({
      ts: TS,
      event: "finding.created",
      audit_reference: "SOVRI-AC-AB12-CD34",
      severity: "major",
      cwe: "798",
      compliance_references: [],
    });
    expect(errorLocus(error)).toContain("cwe");
  });
});

describe("AuditTrailLogicalEventSchema — never carries chain/signature fields (R-02)", () => {
  it("rejects a logical event carrying signing fields", () => {
    // Given event "review.completed" with previous_hash, entry_hash and signature
    // Then the result is invalid
    rejectLogical({
      ts: TS,
      event: "review.completed",
      previous_hash: "sha256:0000",
      entry_hash: "sha256:1111",
      signature: "ed25519:zzzz",
    });
  });

  it("keeps the chain/signature fields off the logical type", () => {
    expectTypeOf<AuditTrailLogicalEvent>().not.toHaveProperty("previous_hash");
    expectTypeOf<AuditTrailLogicalEvent>().not.toHaveProperty("entry_hash");
    expectTypeOf<AuditTrailLogicalEvent>().not.toHaveProperty("signature");
  });
});

describe("AuditTrailLogicalEventSchema — payload hygiene (R-05)", () => {
  it.each(["prompt", "diff", "token", "body", "webhook"])(
    "rejects a logical event carrying the forbidden raw field %s",
    (forbidden) => {
      // Given event "llm.called" carrying a forbidden raw field
      // Then the result is invalid
      rejectLogical({
        ts: TS,
        event: "llm.called",
        prompt_hash: "sha256:7f3a",
        tokens_in: 4521,
        tokens_out: 892,
        [forbidden]: "x",
      });
    },
  );

  it("rejects a correction event carrying a product-decision field", () => {
    // Given event "correction" carrying decision "dismissed"
    // Then the result is invalid / the error path includes "decision"
    const error = rejectLogical({
      ts: TS,
      event: "correction",
      target_audit_reference: "SOVRI-AC-AB12-CD34",
      reason: "fix typo",
      corrected_by: "compliance@bank.example",
      decision: "dismissed",
    });
    expect(errorLocus(error)).toContain("decision");
  });
});

describe("SignedAuditTrailEntrySchema — logical event + 3 crypto fields (R-03)", () => {
  it("validates a signed entry with previous_hash, entry_hash and signature", () => {
    // Given event "review.started" and the signing fields / Then the result is valid
    const result = SignedAuditTrailEntrySchema.safeParse({
      ts: "2026-05-26T14:32:01Z",
      event: "review.started",
      ...NOMINAL_PAYLOADS["review.started"],
      ...SIGNING_FIELDS,
    });
    expect(result.success).toBe(true);
  });

  it("allows the first signed entry to set previous_hash to null", () => {
    // Given event "trail.started" and signing fields with previous_hash null / Then valid
    const result = SignedAuditTrailEntrySchema.safeParse({
      ts: TS,
      event: "trail.started",
      ...NOMINAL_PAYLOADS["trail.started"],
      previous_hash: null,
      entry_hash: "sha256:1111",
      signature: "ed25519:zzzz",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a signed entry missing entry_hash", () => {
    // Then the result is invalid / the error path includes "entry_hash"
    const error = rejectSigned({
      ts: "2026-05-26T14:32:01Z",
      event: "review.completed",
      previous_hash: "sha256:0000",
      signature: "ed25519:zzzz",
    });
    expect(errorLocus(error)).toContain("entry_hash");
  });

  it("rejects a signed entry missing signature", () => {
    // Then the result is invalid / the error path includes "signature"
    const error = rejectSigned({
      ts: "2026-05-26T14:32:01Z",
      event: "review.completed",
      previous_hash: "sha256:0000",
      entry_hash: "sha256:1111",
    });
    expect(errorLocus(error)).toContain("signature");
  });

  it("rejects a signed entry missing previous_hash", () => {
    // Then the result is invalid / the error path includes "previous_hash"
    const error = rejectSigned({
      ts: "2026-05-26T14:32:01Z",
      event: "review.completed",
      entry_hash: "sha256:1111",
      signature: "ed25519:zzzz",
    });
    expect(errorLocus(error)).toContain("previous_hash");
  });

  it("carries the three crypto fields on the signed type", () => {
    expectTypeOf<SignedAuditTrailEntry>().toHaveProperty("previous_hash");
    expectTypeOf<SignedAuditTrailEntry>().toHaveProperty("entry_hash");
    expectTypeOf<SignedAuditTrailEntry>().toHaveProperty("signature");
  });
});

describe("public exports from @sovri/compliance (R-07)", () => {
  it("publishes the audit-trail schemas from the package entry point", () => {
    // Given the public entry point of the @sovri/compliance package
    // Then it exports AuditTrailLogicalEventSchema and SignedAuditTrailEntrySchema
    expect(AuditTrailLogicalEventSchema).toBeDefined();
    expect(SignedAuditTrailEntrySchema).toBeDefined();
  });

  it("publishes the audit-trail types from the package entry point", () => {
    // And it exports the types AuditTrailLogicalEvent and SignedAuditTrailEntry
    expectTypeOf<AuditTrailLogicalEvent>().not.toBeNever();
    expectTypeOf<SignedAuditTrailEntry>().not.toBeNever();
  });
});

describe("SignedAuditTrailEntrySchema — trail.completed seal (R-08)", () => {
  const SEAL_SIGNING = {
    previous_hash: "sha256:1111",
    entry_hash: "sha256:2222",
    signature: "ed25519:zzzz",
  };

  it("validates a signed trail.completed seal", () => {
    // Given a signed entry with ts "2026-05-26T14:35:00Z" and event "trail.completed"
    // And the seal payload {"entry_count":5} / And the signing fields
    // When it is parsed by SignedAuditTrailEntrySchema / Then the result is valid
    const result = SignedAuditTrailEntrySchema.safeParse({
      ts: "2026-05-26T14:35:00Z",
      event: "trail.completed",
      entry_count: 5,
      ...SEAL_SIGNING,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a trail.completed seal missing entry_count", () => {
    // Then the result is invalid / the error path includes "entry_count"
    const error = rejectSigned({
      ts: "2026-05-26T14:35:00Z",
      event: "trail.completed",
      ...SEAL_SIGNING,
    });
    expect(errorLocus(error)).toContain("entry_count");
  });

  it.each([-1, 5.5])("rejects a trail.completed seal whose entry_count is %s", (entry_count) => {
    // Given a seal payload with a non-count entry_count
    // Then the result is invalid / the error path includes "entry_count"
    const error = rejectSigned({
      ts: "2026-05-26T14:35:00Z",
      event: "trail.completed",
      entry_count,
      ...SEAL_SIGNING,
    });
    expect(errorLocus(error)).toContain("entry_count");
  });

  it("does not accept trail.completed as a logical event", () => {
    // Given a logical event with ts "2026-05-26T14:35:00Z" and event "trail.completed"
    // And the payload {"entry_count":5}
    // When it is parsed by AuditTrailLogicalEventSchema / Then the result is invalid
    rejectLogical({ ts: "2026-05-26T14:35:00Z", event: "trail.completed", entry_count: 5 });
  });
});
