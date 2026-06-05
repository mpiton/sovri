// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

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
const PreviewRepositoryIdentityExpression =
  /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?\/[a-z0-9](?:[a-z0-9_-]{0,98}[a-z0-9])?$/u;
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
  const trimmedValue = value.trim();

  if (trimmedValue === PreviewPlaceholderRepositoryName) {
    return false;
  }

  if (!PreviewRepositoryIdentityExpression.test(trimmedValue)) {
    return false;
  }

  const [owner] = trimmedValue.split("/");

  if (owner === undefined) {
    return false;
  }

  return !PreviewSourcePathOwners.has(owner);
}
