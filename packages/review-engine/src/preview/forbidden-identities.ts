// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * Detects secret-shaped and real repository identity strings in preview fixtures.
 * Kept separate from traversal so anonymization stays focused on JSON walking and reporting.
 */
interface PreviewForbiddenIdentityPattern {
  readonly reason: string;
  readonly matches: (value: string) => boolean;
}

export const PreviewPlaceholderRepositoryName = "example/review-target";

const PreviewSourcePathOwners = new Set([
  "apps",
  "dist",
  "docs",
  "fixtures",
  "node_modules",
  "packages",
  "scripts",
  "src",
  "test",
  "tests",
]);
const PreviewGithubTokenExpression = /\bghp_[A-Za-z0-9_]{20,}\b/u;
const PreviewLlmKeyExpression = /\bsk-ant-api03-[A-Za-z0-9_-]+\b/u;
const PreviewRepositoryIdentityCandidateExpression =
  /(?:^|[^A-Za-z0-9._-])([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?)(?=$|[^A-Za-z0-9._-])/gu;
const PreviewForbiddenIdentityPatterns: readonly PreviewForbiddenIdentityPattern[] = [
  {
    reason: "github token shape",
    matches: (value) => PreviewGithubTokenExpression.test(value),
  },
  {
    reason: "llm key shape",
    matches: (value) => PreviewLlmKeyExpression.test(value),
  },
  {
    reason: "real repo shape",
    matches: hasRealRepositoryShape,
  },
];

export function collectPreviewForbiddenIdentityReasons(value: string): readonly string[] {
  const reasons: string[] = [];

  for (const pattern of PreviewForbiddenIdentityPatterns) {
    if (pattern.matches(value)) {
      reasons.push(pattern.reason);
    }
  }

  return reasons;
}

function hasRealRepositoryShape(value: string): boolean {
  if (value.includes("://") && !value.includes("github.com/")) {
    return false;
  }

  for (const match of value.matchAll(PreviewRepositoryIdentityCandidateExpression)) {
    const candidate = match[1];

    if (candidate === undefined || candidate === PreviewPlaceholderRepositoryName) {
      continue;
    }

    const [owner, repository] = candidate.split("/");

    if (owner === undefined || repository === undefined) {
      continue;
    }

    if (
      !PreviewSourcePathOwners.has(owner.toLowerCase()) &&
      !PreviewSourcePathOwners.has(repository.toLowerCase())
    ) {
      return true;
    }
  }

  return false;
}
