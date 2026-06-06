// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * Detects secret-shaped values and real repository identities inside preview fixtures.
 *
 * The fixture anonymization walker passes every collected string here. This module
 * owns the sensitive token patterns, the allowed placeholder repository identity,
 * and URL-aware repository scanning so the walker can stay focused on traversal
 * and violation reporting.
 */
interface PreviewForbiddenIdentityPattern {
  readonly reason: string;
  readonly matches: (value: string) => boolean;
}

/**
 * Tracks a URL-like substring and the source-string offsets it occupies.
 */
interface PreviewUrlMatch {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Repository identity placeholder allowed in checked preview fixtures.
 */
export const PreviewPlaceholderRepositoryName = "example/review-target";

const PreviewDiffPathOwnerSegments = new Set(["a", "b"]);
const PreviewGitHubHostnames = new Set(["github.com", "www.github.com"]);
const PreviewSourcePathOwnerSegments = new Set([
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
const PreviewRepositoryNameInnerMaxLength = 98;
const PreviewRepositoryOwnerInnerMaxLength = 37;
const PreviewGitHubTokenExpression =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u;
const PreviewLlmKeyExpression = /\bsk-ant-api03-[A-Za-z0-9_-]+\b/u;
const PreviewUrlExpression = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+/giu;
const PreviewRepositoryIdentityCandidateExpression = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9._-])([A-Za-z0-9](?:[A-Za-z0-9-]{0,${PreviewRepositoryOwnerInnerMaxLength}}[A-Za-z0-9])?/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,${PreviewRepositoryNameInnerMaxLength}}[A-Za-z0-9])?)(?=$|[^A-Za-z0-9_-])`,
  "gu",
);
const PreviewForbiddenIdentityPatterns: readonly PreviewForbiddenIdentityPattern[] = [
  {
    reason: "github token shape",
    matches: (value) => PreviewGitHubTokenExpression.test(value),
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

/**
 * Returns every forbidden identity reason detected in one collected fixture string.
 */
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
  const searchableValue = removeNonGithubUrls(value);
  const githubUrls = collectUrlMatches(searchableValue).filter((url) =>
    hasGithubHostname(url.value),
  );

  for (const match of searchableValue.matchAll(PreviewRepositoryIdentityCandidateExpression)) {
    const candidate = match[1];

    if (candidate === undefined || candidate === PreviewPlaceholderRepositoryName) {
      continue;
    }

    const candidateStart = getRepositoryCandidateStart(match, candidate);
    const [owner, repository] = candidate.split("/");

    if (candidateStart === undefined || owner === undefined || repository === undefined) {
      continue;
    }

    if (!isSourcePathCandidate(owner, repository, candidateStart, githubUrls)) {
      return true;
    }
  }

  return false;
}

function getRepositoryCandidateStart(
  match: RegExpMatchArray,
  candidate: string,
): number | undefined {
  const matchText = match[0];

  if (matchText === undefined || match.index === undefined) {
    return undefined;
  }

  const candidateOffset = matchText.indexOf(candidate);

  if (candidateOffset === -1) {
    return undefined;
  }

  return match.index + candidateOffset;
}

function isSourcePathCandidate(
  owner: string,
  repository: string,
  candidateStart: number,
  githubUrls: readonly PreviewUrlMatch[],
): boolean {
  if (isInsideUrl(candidateStart, githubUrls)) {
    return false;
  }

  const ownerSegment = owner.toLowerCase();

  return (
    PreviewSourcePathOwnerSegments.has(ownerSegment) ||
    (PreviewDiffPathOwnerSegments.has(ownerSegment) &&
      PreviewSourcePathOwnerSegments.has(repository.toLowerCase()))
  );
}

function isInsideUrl(offset: number, urls: readonly PreviewUrlMatch[]): boolean {
  return urls.some((url) => offset >= url.start && offset < url.end);
}

function removeNonGithubUrls(value: string): string {
  let searchableValue = value;

  for (const url of collectUrlMatches(value).toReversed()) {
    if (shouldRemoveUrlFromRepositoryScan(url.value)) {
      const replacement = " ".repeat(url.value.length);
      searchableValue = `${searchableValue.slice(0, url.start)}${replacement}${searchableValue.slice(url.end)}`;
    }
  }

  return searchableValue;
}

function collectUrlMatches(value: string): readonly PreviewUrlMatch[] {
  const urls: PreviewUrlMatch[] = [];

  for (const match of value.matchAll(PreviewUrlExpression)) {
    const url = match[0];

    if (url !== undefined && match.index !== undefined) {
      urls.push({ value: url, start: match.index, end: match.index + url.length });
    }
  }

  return urls;
}

function hasGithubHostname(value: string): boolean {
  const hostname = parseUrlHostname(value);

  return hostname !== undefined && PreviewGitHubHostnames.has(hostname);
}

function shouldRemoveUrlFromRepositoryScan(value: string): boolean {
  const hostname = parseUrlHostname(value);

  return hostname !== undefined && !PreviewGitHubHostnames.has(hostname);
}

function parseUrlHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
