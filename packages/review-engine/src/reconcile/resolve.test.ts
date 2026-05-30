// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Rule: R-04 — a finding the bot previously posted that the current review run
// no longer produces is classified as resolved (its comment is marked
// outdated). A bot comment without a finding marker is never classified.
// Mirrors specs/bug-1965-rereview-finding-dedup/r-04-resolved-comment-minimized.feature

import { describe, expect, it } from "vitest";

import { classifyResolvedComments, type PostedComment } from "./resolve.js";

describe("classifyResolvedComments", () => {
  it("classifies a posted finding the current run no longer produces as outdated", () => {
    // Given the bot previously posted a comment "RC_node_A" carrying fingerprint
    //   "0a1b2c3d4e5f6a7b"
    const posted: PostedComment[] = [{ nodeId: "RC_node_A", fingerprint: "0a1b2c3d4e5f6a7b" }];
    // And the current review run only produces fingerprint "ffeeddccbbaa9988"
    const currentFingerprints = new Set(["ffeeddccbbaa9988"]);

    // When the bot classifies posted comments against the current findings
    const resolved = classifyResolvedComments(posted, currentFingerprints);

    // Then "RC_node_A" is returned among the comments to minimize as outdated
    expect(resolved).toContain("RC_node_A");
  });

  it("does not classify a posted finding the current run still produces", () => {
    // Given the bot previously posted a comment "RC_node_A" carrying fingerprint
    //   "0a1b2c3d4e5f6a7b"
    const posted: PostedComment[] = [{ nodeId: "RC_node_A", fingerprint: "0a1b2c3d4e5f6a7b" }];
    // And the current review run still produces that fingerprint (the issue
    //   persists, possibly on a shifted line)
    const currentFingerprints = new Set(["0a1b2c3d4e5f6a7b"]);

    // When the bot classifies posted comments against the current findings
    const resolved = classifyResolvedComments(posted, currentFingerprints);

    // Then "RC_node_A" is not returned among the comments to minimize
    expect(resolved).not.toContain("RC_node_A");
  });

  it("never classifies a bot comment that carries no finding marker", () => {
    // Given a bot-authored comment "RC_walkthrough" without any finding marker
    const posted: PostedComment[] = [{ nodeId: "RC_walkthrough" }];
    // And a current run that produces no matching fingerprint
    const currentFingerprints = new Set(["ffeeddccbbaa9988"]);

    // When the bot classifies posted comments against the current findings
    const resolved = classifyResolvedComments(posted, currentFingerprints);

    // Then "RC_walkthrough" is not returned among the comments to minimize
    expect(resolved).not.toContain("RC_walkthrough");
  });
});
