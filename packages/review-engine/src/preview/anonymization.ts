// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export interface PreviewFixtureAnonymizationViolation {
  readonly fixture: string;
  readonly reason: string;
  readonly value: string;
}

export interface PreviewFixtureAnonymizationValidationResult {
  readonly ok: boolean;
  readonly repositoryNames: readonly string[];
  readonly authorLogins: readonly string[];
  readonly providerKeyValues: readonly string[];
  readonly violations: readonly PreviewFixtureAnonymizationViolation[];
}

interface PreviewFixtureAnonymizationFields {
  readonly repositoryNames: string[];
  readonly authorLogins: string[];
  readonly providerKeyValues: string[];
}

const PreviewPlaceholderRepositoryName = "example/review-target";
const PreviewPlaceholderAuthorLoginPrefix = "test-";
const PreviewPlaceholderProviderKey = "test-key";
const PreviewRepositoryNameKeys = new Set(["repo_full_name", "repoFullName", "repositoryName"]);
const PreviewAuthorLoginKeys = new Set(["author", "author_login", "authorLogin", "login"]);

export function validatePreviewFixtureAnonymization(
  fixtureName: string,
  fixture: unknown,
): PreviewFixtureAnonymizationValidationResult {
  const fields = collectPreviewFixtureAnonymizationFields(fixture);
  const violations = [
    ...fields.repositoryNames
      .filter((value) => value !== PreviewPlaceholderRepositoryName)
      .map((value) => createFixtureAnonymizationViolation(fixtureName, "repository name", value)),
    ...fields.authorLogins
      .filter((value) => !value.startsWith(PreviewPlaceholderAuthorLoginPrefix))
      .map((value) => createFixtureAnonymizationViolation(fixtureName, "author login", value)),
    ...fields.providerKeyValues
      .filter((value) => value !== PreviewPlaceholderProviderKey)
      .map((value) => createFixtureAnonymizationViolation(fixtureName, "provider key", value)),
  ];

  return {
    ok: violations.length === 0,
    repositoryNames: fields.repositoryNames,
    authorLogins: fields.authorLogins,
    providerKeyValues: fields.providerKeyValues,
    violations,
  };
}

function collectPreviewFixtureAnonymizationFields(
  value: unknown,
): PreviewFixtureAnonymizationFields {
  const fields: PreviewFixtureAnonymizationFields = {
    repositoryNames: [],
    authorLogins: [],
    providerKeyValues: [],
  };

  collectPreviewFixtureAnonymizationFieldsInto(value, fields);

  return fields;
}

function collectPreviewFixtureAnonymizationFieldsInto(
  value: unknown,
  fields: PreviewFixtureAnonymizationFields,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPreviewFixtureAnonymizationFieldsInto(item, fields);
    }

    return;
  }

  if (!isJsonRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectPreviewFixtureAnonymizationField(key, child, fields);
    collectPreviewFixtureAnonymizationFieldsInto(child, fields);
  }
}

function collectPreviewFixtureAnonymizationField(
  key: string,
  value: unknown,
  fields: PreviewFixtureAnonymizationFields,
): void {
  if (typeof value !== "string") {
    return;
  }

  if (PreviewRepositoryNameKeys.has(key)) {
    fields.repositoryNames.push(value);
  }

  if (PreviewAuthorLoginKeys.has(key)) {
    fields.authorLogins.push(value);
  }

  if (isProviderKeyName(key)) {
    fields.providerKeyValues.push(value);
  }
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderKeyName(key: string): boolean {
  const normalizedKey = key.replace(/[_-]/gu, "").toLowerCase();

  return (
    normalizedKey === "providerkey" ||
    normalizedKey === "llmproviderkey" ||
    normalizedKey === "apikey"
  );
}

function createFixtureAnonymizationViolation(
  fixture: string,
  reason: string,
  value: string,
): PreviewFixtureAnonymizationViolation {
  return { fixture, reason, value };
}
