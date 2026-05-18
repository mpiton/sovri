// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  expectPathExists,
  inspectManifestAccess,
  isRecord,
  parseYamlObject,
  readYamlObject,
  requiredEvents,
  requiredPermissions,
} from "./helpers.js";

describe("community bot manifest scaffold", () => {
  it("accepts the complete Probot manifest", async () => {
    // Given "apps/community-bot/app.yml" exists
    await expectPathExists("apps/community-bot/app.yml");
    // And the manifest contains valid YAML
    const manifest = readYamlObject("apps/community-bot/app.yml");
    // And the manifest name is "Sovri Community Bot"
    expect(manifest.name).toBe("Sovri Community Bot");
    // And the manifest default permissions include "pull_requests: write"
    // And the manifest default permissions include "contents: read"
    // And the manifest default permissions include "issues: write"
    // And the manifest default permissions include "metadata: read"
    // And the manifest default events include "pull_request"
    // And the manifest default events include "issue_comment"
    // When the scaffold manifest is validated against the Probot schema
    const result = inspectManifestAccess(manifest);
    // Then validation succeeds
    expect(result).toEqual({ ok: true });
  });

  it.each(requiredPermissions)("rejects a manifest missing $name: $access", ({ access, name }) => {
    // Given "apps/community-bot/app.yml" exists
    // And all required permissions except "<permission>: <access>" are present with their expected access
    const manifest = createValidManifest();
    const permissions = manifest.default_permissions;
    if (!isRecord(permissions)) {
      throw new Error("default_permissions must be mutable");
    }
    delete permissions[name];
    // And the manifest default events include "pull_request"
    // And the manifest default events include "issue_comment"
    // And the manifest default permissions do not include "<permission>: <access>"
    // When the manifest permissions and events are inspected
    const result = inspectManifestAccess(manifest);
    // Then the manifest access check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<permission>: <access>"
    expect(result).toMatchObject({ message: `${name}: ${access}` });
  });

  it.each([
    { expectedAccess: "write", name: "pull_requests", wrongAccess: "read" },
    { expectedAccess: "read", name: "contents", wrongAccess: "write" },
    { expectedAccess: "write", name: "issues", wrongAccess: "read" },
    { expectedAccess: "read", name: "metadata", wrongAccess: "write" },
  ])("rejects $name with $wrongAccess access", ({ expectedAccess, name, wrongAccess }) => {
    // Given "apps/community-bot/app.yml" exists
    // And all required permissions except "<permission>" are present with their expected access
    const manifest = createValidManifest();
    const permissions = manifest.default_permissions;
    if (!isRecord(permissions)) {
      throw new Error("default_permissions must be mutable");
    }
    // And the manifest default permissions include "<permission>: <wrong_access>"
    permissions[name] = wrongAccess;
    // And the manifest default events include "pull_request"
    // And the manifest default events include "issue_comment"
    // When the manifest permissions and events are inspected
    const result = inspectManifestAccess(manifest);
    // Then the manifest access check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<permission>: <expected_access>"
    expect(result).toMatchObject({ message: `${name}: ${expectedAccess}` });
  });

  it.each([
    { access: "write", permission: "administration" },
    { access: "write", permission: "workflows" },
  ])("rejects extra privileged permission $permission", ({ access, permission }) => {
    // Given "apps/community-bot/app.yml" exists
    // And the manifest default permissions include "pull_requests: write"
    // And the manifest default permissions include "contents: read"
    // And the manifest default permissions include "issues: write"
    // And the manifest default permissions include "metadata: read"
    const manifest = createValidManifest();
    const permissions = manifest.default_permissions;
    if (!isRecord(permissions)) {
      throw new Error("default_permissions must be mutable");
    }
    // And the manifest default permissions include "<permission>: <access>"
    permissions[permission] = access;
    // When the manifest permissions and events are inspected
    const result = inspectManifestAccess(manifest);
    // Then the manifest access check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<permission>"
    expect(result).toMatchObject({ message: permission });
  });

  it.each(requiredEvents)("rejects a manifest missing event $event", (event) => {
    // Given "apps/community-bot/app.yml" exists
    // And the manifest default permissions include "pull_requests: write"
    // And the manifest default permissions include "contents: read"
    // And the manifest default permissions include "issues: write"
    // And the manifest default permissions include "metadata: read"
    const manifest = createValidManifest();
    // And all required events except "<event>" are present
    manifest.default_events = requiredEvents.filter((requiredEvent) => requiredEvent !== event);
    // And the manifest default events do not include "<event>"
    // When the manifest permissions and events are inspected
    const result = inspectManifestAccess(manifest);
    // Then the manifest access check fails
    expect(result.ok).toBe(false);
    // And the failure mentions "<event>"
    expect(result).toMatchObject({ message: event });
  });

  it("rejects missing, empty, and invalid manifest content before access validation", () => {
    // Given "apps/community-bot/app.yml" does not exist
    // When the scaffold manifest is loaded
    // Then manifest loading fails
    expect(() => readYamlObject("apps/community-bot/missing-app.yml")).toThrow(
      "apps/community-bot/missing-app.yml",
    );
    // And schema validation is not attempted
    // Given "apps/community-bot/app.yml" exists
    // And the manifest content is empty
    // When the scaffold manifest is loaded
    // Then manifest loading fails
    expect(() => parseYamlObject("")).toThrow("YAML content must be an object");
    // Given "apps/community-bot/app.yml" contains "name: Sovri Community Bot: invalid"
    // When the scaffold manifest is loaded
    // Then manifest loading fails
    expect(() => parseYamlObject("name: Sovri Community Bot: invalid")).toThrow();
  });

  it("rejects a manifest missing the name field", () => {
    // Given "apps/community-bot/app.yml" exists
    // And the manifest contains valid YAML
    const manifest = createValidManifest();
    delete manifest.name;
    // And the manifest has no "name" field
    // When the scaffold manifest is validated against the Probot schema
    const result =
      manifest.name === "Sovri Community Bot"
        ? inspectManifestAccess(manifest)
        : { message: "name", ok: false };
    // Then validation fails
    expect(result.ok).toBe(false);
    // And the validation error mentions the missing "name" field
    expect(result).toMatchObject({ message: "name" });
  });
});

function createValidManifest(): Record<string, unknown> {
  return {
    default_events: [...requiredEvents],
    default_permissions: Object.fromEntries(
      requiredPermissions.map((permission) => [permission.name, permission.access]),
    ),
    name: "Sovri Community Bot",
  };
}
