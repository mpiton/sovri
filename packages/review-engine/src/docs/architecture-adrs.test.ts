// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MAT-82 — Architecture ADRs: Compliance as Code, Git source, air-gap rule engine.
// Docs-acceptance test: the architecture ADRs under docs/adr/ ARE the system under
// test. Nominal scenarios assert the required references and phrases exist in the ADR
// corpus; violation scenarios feed an inline anti-pattern document to the matching
// check and assert it is rejected. Mirrors packages/review-engine/src/docs/
// compliance-pivot-docs.test.ts (MAT-80) — no mocks, the markdown is the SUT.

const adrDocsRoot = findAdrDocsRoot(dirname(fileURLToPath(import.meta.url)));

type AdrFile = {
  readonly name: string;
  readonly text: string;
};

function findAdrDocsRoot(startDir: string): string {
  let currentDir = startDir;

  for (;;) {
    const candidate = join(currentDir, "docs", "adr");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not locate docs/adr from architecture ADR test");
    }
    currentDir = parentDir;
  }
}

function readAdrFiles(): readonly AdrFile[] {
  return readdirSync(adrDocsRoot)
    .filter((fileName) => fileName.endsWith(".md") && fileName !== "README.md")
    .toSorted()
    .map((fileName) => ({
      name: fileName,
      text: readFileSync(join(adrDocsRoot, fileName), "utf8"),
    }));
}

const adrFiles = readAdrFiles();
const adrCorpus = adrFiles.map((adr) => adr.text).join("\n");

function normalize(text: string): string {
  // Strip Markdown code/emphasis markers so a phrase matches whether or not the ADR
  // wraps a term in backticks or bold, then collapse whitespace (ADR prose wraps lines).
  return text.replace(/[`*]/g, "").replace(/\s+/g, " ").toLowerCase();
}

const normalizedCorpus = normalize(adrCorpus);

function corpusHasPhrase(phrase: string): boolean {
  return normalizedCorpus.includes(normalize(phrase));
}

// True when a single ADR file mentions every phrase — used where a scenario asserts an
// association ("describe <repo> as responsible for <responsibility>"), not just presence
// of the two tokens somewhere in the corpus.
function someAdrMentionsAll(...phrases: readonly string[]): boolean {
  return adrFiles.some((adr) => {
    const normalizedText = normalize(adr.text);
    return phrases.every((phrase) => normalizedText.includes(normalize(phrase)));
  });
}

function normalizedLines(docs: string): readonly string[] {
  return docs
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .filter((line) => line.length > 0);
}

function describesInOrder(docs: string, stages: readonly string[]): boolean {
  const pattern = new RegExp(
    stages.map((stage) => escapeRegExp(normalize(stage))).join("[\\s\\S]*?"),
  );
  return pattern.test(normalize(docs));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// R-01 — Repository responsibilities and integration boundaries
// ---------------------------------------------------------------------------

const REPOSITORY_RESPONSIBILITIES = [
  { repository: "sovri-agent", responsibility: "rule execution and local air-gap operation" },
  {
    repository: "sovri-frameworks",
    responsibility: "the Git source of truth for framework, control, and rule catalogs",
  },
  {
    repository: "sovri-sdk-rust",
    responsibility: "shared types and agent and cloud integration contracts",
  },
] as const;

function repositoryBoundaryFailures(docs: string): string[] {
  const failures: string[] = [];
  const normalizedDocs = normalize(docs);

  for (const { repository, responsibility } of REPOSITORY_RESPONSIBILITIES) {
    if (!normalizedDocs.includes(normalize(responsibility))) {
      failures.push(`${repository} is missing a documented responsibility`);
    }
  }

  for (const line of normalizedLines(docs)) {
    const assignsExecution =
      /\b(assigns?|assigned|runs? in|executes? in|performed in|happens? in)\b/.test(line);
    const mentionsCloudExecution = line.includes("rule execution") && line.includes("sovri-cloud");
    const keepsExecutionInAgent =
      /(must stay|never|not |stays in|air-gapped sovri-agent|reject)/.test(line);

    if (mentionsCloudExecution && assignsExecution && !keepsExecutionInAgent) {
      failures.push("rule execution must stay in the air-gapped sovri-agent");
    }
  }

  return failures;
}

describe("MAT-82 R-01 — ADRs define repository responsibilities and integration boundaries", () => {
  it.each(REPOSITORY_RESPONSIBILITIES)(
    "assigns $repository its documented responsibility",
    ({ repository, responsibility }) => {
      // Then the ADRs describe "<repository>" as responsible for "<responsibility>"
      expect(
        someAdrMentionsAll(repository, responsibility),
        `${repository} must be described as responsible for "${responsibility}"`,
      ).toBe(true);
    },
  );

  it("defines the integration boundary with sovri-cloud and sovri", () => {
    // Then the ADRs describe how "sovri-agent" integrates with "sovri-cloud" and "sovri"
    expect(corpusHasPhrase("sovri-agent integrates with sovri-cloud and sovri")).toBe(true);
    // And the ADRs place the report and PR projection at the "sovri-cloud" and "sovri" boundary
    expect(corpusHasPhrase("report and PR projection at the sovri-cloud and sovri boundary")).toBe(
      true,
    );
  });

  it("keeps the real ADR corpus free of repository boundary violations", () => {
    expect(repositoryBoundaryFailures(adrCorpus)).toEqual([]);
  });

  it("detects a repository with no documented responsibility", () => {
    // Given the documented responsibility for "sovri-frameworks" is absent
    const fixture = [
      "sovri-agent is responsible for rule execution and local air-gap operation.",
      "sovri-sdk-rust provides shared types and agent and cloud integration contracts.",
    ].join("\n");

    const failures = repositoryBoundaryFailures(fixture);

    // Then it fails and names "sovri-frameworks" as missing a documented responsibility
    expect(failures).toContain("sovri-frameworks is missing a documented responsibility");
  });

  it("rejects rule execution assigned to the Cloud", () => {
    // Given an ADR assigns rule execution to "sovri-cloud"
    const fixture = withRepositoryResponsibilities("An ADR assigns rule execution to sovri-cloud.");

    const failures = repositoryBoundaryFailures(fixture);

    // Then it reports that rule execution must stay in the air-gapped "sovri-agent"
    expect(failures).toContain("rule execution must stay in the air-gapped sovri-agent");
  });
});

function withRepositoryResponsibilities(extra: string): string {
  return [
    ...REPOSITORY_RESPONSIBILITIES.map(
      ({ repository, responsibility }) => `${repository}: ${responsibility}.`,
    ),
    extra,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// R-02 — Compliance data flow end to end
// ---------------------------------------------------------------------------

const DATA_FLOW_STAGES = [
  "catalog",
  "rule",
  "evidence",
  "control result",
  "compliance gap",
  "report and PR projection",
] as const;

function dataFlowFailures(docs: string): string[] {
  const failures: string[] = [];
  const normalizedDocs = normalize(docs);

  for (const stage of DATA_FLOW_STAGES) {
    if (!normalizedDocs.includes(normalize(stage))) {
      failures.push(`the data flow is missing the "${stage}" stage`);
    }
  }

  for (const line of normalizedLines(docs)) {
    const derivesGapFromRule =
      line.includes("compliance gap") &&
      /\bfrom (a )?rule\b/.test(line) &&
      !line.includes("control result") &&
      !line.includes("reject");
    if (derivesGapFromRule) {
      failures.push("a compliance gap requires a preceding control result");
    }
  }

  return failures;
}

describe("MAT-82 R-02 — ADRs define the compliance data flow end to end", () => {
  it("states the full ordered data flow", () => {
    // Then the ADRs describe the data flow in order: catalog, then rule, then evidence,
    // then control result, then compliance gap, then report and PR projection
    expect(describesInOrder(adrCorpus, DATA_FLOW_STAGES)).toBe(true);
  });

  it.each(DATA_FLOW_STAGES)("names %s as a stage of the compliance data flow", (stage) => {
    expect(corpusHasPhrase(stage)).toBe(true);
  });

  it("keeps the real ADR corpus free of data flow violations", () => {
    expect(dataFlowFailures(adrCorpus)).toEqual([]);
  });

  it("rejects a data flow that derives a gap without a control result", () => {
    // Given an ADR derives a "compliance gap" directly from a "rule" with no "control result"
    const fixture = "The engine derives a compliance gap directly from a rule.";

    const failures = dataFlowFailures(fixture);

    // Then it reports that a "compliance gap" requires a preceding "control result"
    expect(failures).toContain("a compliance gap requires a preceding control result");
  });

  it("detects a missing data flow stage", () => {
    // Given the "evidence" stage is absent from the documented data flow
    const fixture =
      "Flow: catalog, then rule, then control result, then compliance gap, then report and PR projection.";

    const failures = dataFlowFailures(fixture);

    // Then it names the missing stage "evidence"
    expect(failures).toContain('the data flow is missing the "evidence" stage');
  });
});

// ---------------------------------------------------------------------------
// R-03 — Catalog-backed framework references and source URLs
// ---------------------------------------------------------------------------

function referenceProvenanceFailures(docs: string): string[] {
  const failures: string[] = [];

  for (const line of normalizedLines(docs)) {
    const isCatalogBacked =
      /(catalog-backed|backed by the catalog|from the catalog|never|reject)/.test(line);

    const modelAuthoredReference =
      line.includes("framework reference") &&
      /(from the llm|llm-authored|model-authored|originate from the llm|authored by the llm)/.test(
        line,
      );
    if (modelAuthoredReference && !isCatalogBacked) {
      failures.push("framework references must be catalog-backed");
    }

    const hardcodedUrl =
      line.includes("source url") && /(hardcoded|hard-coded|outside the catalog)/.test(line);
    if (hardcodedUrl && !isCatalogBacked) {
      failures.push("source URLs must be catalog-backed");
    }
  }

  return failures;
}

describe("MAT-82 R-03 — ADRs require framework references and source URLs to be catalog-backed", () => {
  it("states framework references and URLs are catalog-backed", () => {
    // Then the ADRs state that framework references are backed by the catalog
    expect(corpusHasPhrase("framework references are backed by the catalog")).toBe(true);
    // And the ADRs state that source URLs are backed by the catalog
    expect(corpusHasPhrase("source URLs are backed by the catalog")).toBe(true);
  });

  it("keeps the real ADR corpus free of reference provenance violations", () => {
    expect(referenceProvenanceFailures(adrCorpus)).toEqual([]);
  });

  it("rejects a model-authored framework reference", () => {
    // Given an ADR allows a framework reference to originate from the LLM
    const fixture = "An ADR allows a framework reference to originate from the LLM.";

    const failures = referenceProvenanceFailures(fixture);

    // Then it reports that framework references must be catalog-backed
    expect(failures).toContain("framework references must be catalog-backed");
  });

  it("rejects a source URL hardcoded outside the catalog", () => {
    // Given an ADR allows a source URL to be hardcoded outside the catalog
    const fixture = "An ADR allows a source URL to be hardcoded outside the catalog.";

    const failures = referenceProvenanceFailures(fixture);

    // Then it reports that source URLs must be catalog-backed
    expect(failures).toContain("source URLs must be catalog-backed");
  });
});

// ---------------------------------------------------------------------------
// R-04 — Air-gap execution with no external API dependency
// ---------------------------------------------------------------------------

function airGapFailures(docs: string): string[] {
  const failures: string[] = [];

  for (const line of normalizedLines(docs)) {
    const requiresExternalApi =
      line.includes("external api") &&
      /(required during execution|requires an external api|call during execution)/.test(line);
    const isForbidden = /(no external api|never|not required|without|may be required|reject)/.test(
      line,
    );

    if (requiresExternalApi && !isForbidden) {
      failures.push("no external API may be required during execution");
    }
  }

  return failures;
}

describe("MAT-82 R-04 — ADRs state air-gap execution with no external API dependency", () => {
  it("states the air-gap execution constraint", () => {
    // Then the ADRs state that rule execution runs air-gapped
    expect(corpusHasPhrase("rule execution runs air-gapped")).toBe(true);
    // And the ADRs state that no external API is required during execution
    expect(corpusHasPhrase("no external API is required during execution")).toBe(true);
  });

  it("requires offline verification of execution", () => {
    // Then the ADRs state that execution can be verified offline with no network access
    expect(corpusHasPhrase("execution can be verified offline with no network access")).toBe(true);
  });

  it("keeps the real ADR corpus free of air-gap violations", () => {
    expect(airGapFailures(adrCorpus)).toEqual([]);
  });

  it("rejects a required external API call during execution", () => {
    // Given an ADR requires an external API call during execution
    const fixture =
      "An ADR requires an external API call during execution to fetch framework text.";

    const failures = airGapFailures(fixture);

    // Then it reports that no external API may be required during execution
    expect(failures).toContain("no external API may be required during execution");
  });
});

// ---------------------------------------------------------------------------
// R-05 — MAT-113 is the product model
// ---------------------------------------------------------------------------

function productModelFailures(docs: string): string[] {
  const failures: string[] = [];
  const normalizedDocs = normalize(docs);

  if (!normalizedDocs.includes("mat-113")) {
    failures.push("the ADRs must reference MAT-113");
  }

  for (const line of normalizedLines(docs)) {
    const presentsMat77AsCurrent =
      line.includes("mat-77") &&
      /(current product model|is the current|as the current|active product model)/.test(line) &&
      !/(superseded|no longer|not the current|reject)/.test(line);
    if (presentsMat77AsCurrent) {
      failures.push("MAT-77 is superseded by MAT-113");
    }
  }

  return failures;
}

describe("MAT-82 R-05 — ADRs reference MAT-113 as the product model", () => {
  it("references MAT-113 as the product model", () => {
    // Then the ADRs reference "MAT-113"
    expect(corpusHasPhrase("MAT-113")).toBe(true);
    // And the ADRs describe "MAT-113" as the product model for project-level compliance
    expect(corpusHasPhrase("MAT-113 is the product model for project-level compliance")).toBe(true);
  });

  it("keeps the real ADR corpus free of product model violations", () => {
    expect(productModelFailures(adrCorpus)).toEqual([]);
  });

  it("detects a missing MAT-113 reference", () => {
    // Given the reference to "MAT-113" is absent
    const fixture =
      "The ADRs describe an air-gapped rule engine without a product-model reference.";

    const failures = productModelFailures(fixture);

    // Then it reports that the ADRs must reference "MAT-113"
    expect(failures).toContain("the ADRs must reference MAT-113");
  });

  it("rejects presenting the superseded MAT-77 model as current", () => {
    // Given an ADR presents "MAT-77" as the current product model
    const fixture = "An ADR presents MAT-77 as the current product model for compliance.";

    const failures = productModelFailures(fixture);

    // Then it reports that "MAT-77" is superseded by "MAT-113"
    expect(failures).toContain("MAT-77 is superseded by MAT-113");
  });
});

// ---------------------------------------------------------------------------
// R-06 — LLM limited to interpretation and ranking
// ---------------------------------------------------------------------------

function llmRoleFailures(docs: string): string[] {
  const failures: string[] = [];

  for (const line of normalizedLines(docs)) {
    if (!/\bllm\b/.test(line)) {
      continue;
    }
    const isNegated = /(\bnot\b|\bnever\b|must not|\bonly\b|catalog-backed|reject)/.test(line);

    const officialCitationSource =
      /(official citation source|official source of regulatory citations|source of regulatory citations)/.test(
        line,
      );
    if (officialCitationSource && !isNegated) {
      failures.push("the LLM must not be an official citation source");
    }

    const authorsClaim =
      /(author|authors|authoring|writes|generates?)\b/.test(line) &&
      /(regulatory claim|regulatory claims|framework text|regulatory citation)/.test(line);
    if (authorsClaim && !isNegated) {
      failures.push("regulatory claims must be catalog-backed, not LLM-authored");
    }
  }

  return failures;
}

describe("MAT-82 R-06 — ADRs limit the LLM to interpretation and ranking", () => {
  it("scopes the LLM to interpretation and ranking", () => {
    // Then the ADRs state that the LLM role is interpretation and ranking only
    expect(corpusHasPhrase("the LLM role is interpretation and ranking only")).toBe(true);
    // And the ADRs state that the LLM is not an official citation source
    expect(corpusHasPhrase("the LLM is not an official citation source")).toBe(true);
  });

  it("keeps the real ADR corpus free of LLM role violations", () => {
    expect(llmRoleFailures(adrCorpus)).toEqual([]);
  });

  it("rejects making the LLM an official citation source", () => {
    // Given an ADR states the LLM is the official source of regulatory citations
    const fixture = "An ADR states the LLM is the official source of regulatory citations.";

    const failures = llmRoleFailures(fixture);

    // Then it reports that the LLM must not be an official citation source
    expect(failures).toContain("the LLM must not be an official citation source");
  });

  it("rejects letting the LLM author regulatory claims", () => {
    // Given an ADR lets the LLM author a regulatory claim
    const fixture = "An ADR lets the LLM author a regulatory claim about GDPR.";

    const failures = llmRoleFailures(fixture);

    // Then it reports that regulatory claims must be catalog-backed, not LLM-authored
    expect(failures).toContain("regulatory claims must be catalog-backed, not LLM-authored");
  });
});

// ---------------------------------------------------------------------------
// R-07 — ComplianceGap and ControlResult distinct from the PR Finding
// ---------------------------------------------------------------------------

const COMPLIANCE_TYPES = ["ComplianceGap", "ControlResult"] as const;

function complianceTypeFailures(docs: string): string[] {
  const failures: string[] = [];

  for (const type of COMPLIANCE_TYPES) {
    const normalizedType = normalize(type);
    for (const line of normalizedLines(docs)) {
      if (!line.includes(normalizedType)) {
        continue;
      }
      // Identity conflation only ("X is/treated as a kind of Finding"). ADR-022's
      // "Rejected alternatives" deliberately names "Treat ComplianceGap as a Finding
      // category" — the established compliance-pivot regex also matches "is a", not
      // "as a", so naming a rejected anti-pattern must not register as a violation.
      const conflatesWithFinding =
        /(kind of (a )?finding|subtype of (the )?finding|finding subtype|is itself a finding)/.test(
          line,
        );
      const isDistinct = /(distinct|not a|must not|never|separate from|rejected|reject)/.test(line);

      if (conflatesWithFinding && !isDistinct) {
        failures.push(`${type} must be distinct from the PR Finding`);
      }
    }
  }

  return failures;
}

describe("MAT-82 R-07 — ADRs keep ComplianceGap and ControlResult distinct from the PR Finding", () => {
  it.each(COMPLIANCE_TYPES)("defines %s as distinct from the PR Finding", (type) => {
    // Then the ADRs describe "<type>" as distinct from the pull request "Finding"
    expect(someAdrMentionsAll(type, "distinct from the pull-request Finding")).toBe(true);
  });

  it("keeps the real ADR corpus free of compliance type violations", () => {
    expect(complianceTypeFailures(adrCorpus)).toEqual([]);
  });

  it("rejects treating ComplianceGap as a kind of Finding", () => {
    // Given an ADR treats "ComplianceGap" as a kind of "Finding"
    const fixture = "An ADR treats ComplianceGap as a kind of Finding raised on a diff hunk.";

    const failures = complianceTypeFailures(fixture);

    // Then it reports that "ComplianceGap" must be distinct from the PR "Finding"
    expect(failures).toContain("ComplianceGap must be distinct from the PR Finding");
  });

  it("rejects treating ControlResult as a kind of Finding", () => {
    // Given an ADR treats "ControlResult" as a kind of "Finding"
    const fixture = "An ADR treats ControlResult as a kind of Finding raised on a diff hunk.";

    const failures = complianceTypeFailures(fixture);

    // Then it reports that "ControlResult" must be distinct from the PR "Finding"
    expect(failures).toContain("ControlResult must be distinct from the PR Finding");
  });
});
