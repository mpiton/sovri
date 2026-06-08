// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import { isActionable, partitionActionableFindings } from "./actionable.js";
import { ProviderFindingSchema } from "./index.js";

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));
}

describe("isActionable", () => {
  it("keeps a finding whose title states a problem", () => {
    expect(
      isActionable({
        title: "Unvalidated session token",
        recommendation: "Verify the token signature before accepting it.",
      }),
    ).toBe(true);
  });

  it("drops a finding whose title only narrates a change", () => {
    expect(
      isActionable({
        title: "Added `generateAuthContent` function",
        recommendation: "No change needed; the function works as written.",
      }),
    ).toBe(false);
  });

  it.each([
    "Added `generateAuthContent` function",
    "Extended `SeoRoute` interface",
    "Updated route iteration to use `PRERENDER_ROUTES`",
    "Renamed `fetchData` to `loadRouteData`",
    "Moved helper into utils.ts",
    "Refactored buildSitemap for clarity",
    "Implemented crawler-friendly fallback content",
  ])("drops the narration title %p", (title) => {
    expect(isActionable({ title, recommendation: "Keep it as written." })).toBe(false);
  });

  it("keeps a change-verb title that names a defect", () => {
    // The change verb opens the title, but "unchecked" is a defect signal, so the finding survives.
    expect(
      isActionable({
        title: "Added unchecked cast that can throw at runtime",
        recommendation: "Validate the value before casting, or handle the failure path.",
      }),
    ).toBe(true);
  });

  it("drops a finding with an empty or whitespace recommendation", () => {
    expect(isActionable({ title: "Missing null guard on payload", recommendation: "" })).toBe(
      false,
    );
    expect(isActionable({ title: "Missing null guard on payload", recommendation: "   " })).toBe(
      false,
    );
  });

  it("keeps a non-narration title regardless of vocabulary", () => {
    expect(
      isActionable({
        title: "Race condition between read and write",
        recommendation: "Take the lock around the read-modify-write sequence.",
      }),
    ).toBe(true);
  });

  it.each(["Extracted helper into utils", "Deleted the legacy import", "Consolidated route lists"])(
    "drops the additional change-verb title %p",
    (title) => {
      expect(isActionable({ title, recommendation: "Keep it as written." })).toBe(false);
    },
  );

  it("drops a narration title decorated with leading markdown", () => {
    // `^` would miss the verb behind a backtick; the guard strips leading decoration first.
    expect(
      isActionable({ title: "`Added` generateAuthContent function", recommendation: "Keep it." }),
    ).toBe(false);
    expect(
      isActionable({ title: "**Updated** the prerender loop", recommendation: "Keep it." }),
    ).toBe(false);
  });

  it("documents the passive-voice limitation: it is not dropped", () => {
    // The change verb does not open the title, so the title-only guard cannot catch it. The prompt and
    // schema are the primary defenses; this asserts the known, deliberate gap rather than a fix.
    expect(
      isActionable({
        title: "The generateAuthContent function was added",
        recommendation: "No change needed.",
      }),
    ).toBe(true);
  });
});

describe("partitionActionableFindings", () => {
  it("splits kept findings from a dropped count", () => {
    const findings = [
      { title: "Missing null guard", recommendation: "Add the guard." },
      { title: "Added helper function", recommendation: "No change needed." },
      { title: "Renamed the variable", recommendation: "Keep the name." },
    ];

    const { kept, droppedCount } = partitionActionableFindings(findings);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.title).toBe("Missing null guard");
    expect(droppedCount).toBe(2);
  });

  it("keeps everything when nothing narrates", () => {
    const findings = [
      { title: "SQL injection in query builder", recommendation: "Use a parameterised query." },
      { title: "Unhandled promise rejection", recommendation: "Await and catch the rejection." },
    ];

    expect(partitionActionableFindings(findings).droppedCount).toBe(0);
  });
});

describe("narration regression — mpiton/fournil#277 (issue #2450)", () => {
  it("the 12 reproduction findings are schema-valid yet all dropped as narration", () => {
    // Each finding satisfies the provider contract (it carries a non-empty recommendation), proving the
    // schema alone cannot stop narration — the deterministic guard is the layer that drops them.
    const findings = z
      .array(ProviderFindingSchema)
      .parse(loadFixture("narration-fournil-277.json"));
    expect(findings).toHaveLength(12);

    const { kept, droppedCount } = partitionActionableFindings(findings);

    expect(droppedCount).toBe(12);
    expect(kept).toHaveLength(0);
  });
});

describe("ProviderFindingSchema requires a recommendation (issue #2450)", () => {
  const base = {
    severity: "major",
    category: "bug",
    file: "src/index.ts",
    line_start: 10,
    line_end: 10,
    title: "Missing null guard on payload",
    body: "`payload` is read before validation and can be undefined.",
    recommendation: "Validate `payload` with the schema before reading its fields.",
  };

  it("accepts a finding that carries a recommendation", () => {
    expect(ProviderFindingSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a finding with no recommendation", () => {
    const { recommendation: _dropped, ...withoutRecommendation } = base;
    expect(ProviderFindingSchema.safeParse(withoutRecommendation).success).toBe(false);
  });

  it("rejects an empty recommendation", () => {
    expect(ProviderFindingSchema.safeParse({ ...base, recommendation: "" }).success).toBe(false);
  });
});
