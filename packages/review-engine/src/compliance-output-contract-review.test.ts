// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import {
  reviewComplianceOutputContract,
  type ComplianceOutputContractArtifactSet,
  type ComplianceOutputContractSchema,
  type ComplianceOutputTerm,
} from "./index.js";

const VALID_CONTRACT_ARTIFACTS = {
  prompts: [
    "Findings are diff/code issues raised during review.",
    "ComplianceGap output comes from project-level compliance scans, not CWE-backed review Findings.",
    "Use catalog framework references and source URLs; never ask the LLM to author regulatory source references.",
  ],
  schemas: [
    {
      name: "Finding",
      fields: ["cwe", "category", "file", "line_start", "line_end"],
      required: ["category", "file", "line_start", "line_end"],
      categories: ["bug", "security"],
    },
    {
      name: "ComplianceGap",
      fields: ["control_id", "evidence", "status"],
      required: ["control_id"],
    },
    {
      name: "ControlResult",
      fields: ["control_id", "status", "evidence"],
      required: ["status"],
    },
  ],
  docs: [
    "Finding - diff/code issue raised during review",
    "ComplianceGap - project-level compliance output for an unmet control or missing evidence",
    "ControlResult - result of evaluating a control against rules and collected evidence",
  ],
} satisfies ComplianceOutputContractArtifactSet;

const TERM_MEANING_EXAMPLES = [
  ["Finding", "diff/code issue raised during review", "project-level compliance gap"],
  [
    "ComplianceGap",
    "project-level compliance output for an unmet control or missing evidence",
    "CWE-backed review Finding",
  ],
  [
    "ControlResult",
    "result of evaluating a control against rules and collected evidence",
    "rendered code-review category",
  ],
] as const satisfies readonly (readonly [ComplianceOutputTerm, string, string])[];

describe("R-06: Prompt, schema, and docs distinguish Finding from ComplianceGap and ControlResult", () => {
  it.each(TERM_MEANING_EXAMPLES)(
    'describes "%s" as "%s" and not as "%s"',
    (term, meaning, forbiddenMeaning) => {
      // Given the contract artifact set includes prompts, schemas, and docs
      const artifactSet = VALID_CONTRACT_ARTIFACTS;

      // When the contract artifact set is reviewed
      const review = reviewComplianceOutputContract(artifactSet);

      // Then "<term>" is described as "<meaning>"
      expect(review.definitions[term]).toBe(meaning);

      // And "<term>" is not described as "<forbidden_meaning>"
      expect(review.definitions[term]).not.toContain(forbiddenMeaning);
    },
  );

  it("separates CWE Findings from framework/control compliance gaps", () => {
    // Given the schema defines a Finding object with field "cwe"
    const findingSchema = findContractSchema(VALID_CONTRACT_ARTIFACTS, "Finding");
    expect(findingSchema.fields).toContain("cwe");

    // And the schema defines a ComplianceGap object with field "control_id"
    const complianceGapSchema = findContractSchema(VALID_CONTRACT_ARTIFACTS, "ComplianceGap");
    expect(complianceGapSchema.fields).toContain("control_id");

    // And the schema defines a ControlResult object with field "status"
    const controlResultSchema = findContractSchema(VALID_CONTRACT_ARTIFACTS, "ControlResult");
    expect(controlResultSchema.fields).toContain("status");

    // When the schema contract is reviewed
    const review = reviewComplianceOutputContract(VALID_CONTRACT_ARTIFACTS);

    // Then Finding, ComplianceGap, and ControlResult are separate contract types
    expect(review.schema.separate_contract_types).toBe(true);

    // And the ComplianceGap type does not require a CWE
    expect(review.schema.compliance_gap_requires_cwe).toBe(false);

    // And the Finding type is not extended with a source-of-truth "compliance" category
    expect(review.schema.finding_has_compliance_category).toBe(false);
  });

  it("rejects documentation that treats ComplianceGap as a Finding category", () => {
    // Given the docs say "ComplianceGap is a Finding category emitted by PR review"
    const artifactSet = replaceDocs(["ComplianceGap is a Finding category emitted by PR review"]);

    // When the contract artifact set is reviewed
    const review = reviewComplianceOutputContract(artifactSet);

    // Then the contract review fails
    expect(review.passed).toBe(false);

    // And the failure explains that ComplianceGap is project-level compliance output
    expect(review.failures.join("\n")).toContain(
      "ComplianceGap is project-level compliance output",
    );
  });

  it("rejects Markdown-wrapped ComplianceGap Finding-category misuse", () => {
    const artifactSet = replaceDocs(["`ComplianceGap` is a Finding category emitted by PR review"]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(false);
    expect(review.failures.join("\n")).toContain(
      "ComplianceGap is project-level compliance output",
    );
  });

  it("rejects Markdown-wrapped ControlResult Finding-category misuse", () => {
    const artifactSet = appendDocs(["`ControlResult` is a Finding category emitted by PR review"]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(false);
    expect(review.failures).toContain("ControlResult is a control evaluation result");
  });

  it("does not reject documentation that prohibits Finding-category misuse", () => {
    const artifactSet = appendDocs([
      "Never say `ControlResult` is a Finding category emitted by PR review.",
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(true);
  });

  it("rejects missing required term definitions before passing", () => {
    const artifactSet = replaceDocs([
      "Finding - diff/code issue raised during review",
      "ComplianceGap - project-level compliance output for an unmet control or missing evidence",
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(false);
    expect(review.failures).toContain("ControlResult definition is required");
  });

  it("recognises ADR glossary definitions written as Markdown list items", () => {
    const artifactSet = replaceDocs([
      "- **Finding** - diff/code issue raised during review.",
      "- **ComplianceGap** - project-level compliance output for an unmet control or missing evidence.",
      "- **ControlResult** - result of evaluating a control against its rules and collected evidence.",
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.definitions.ComplianceGap).toBe(
      "project-level compliance output for an unmet control or missing evidence.",
    );
    expect(review.failures).not.toContain("ComplianceGap definition is required");
    expect(review.passed).toBe(true);
  });

  it("rejects prompts that ask the LLM to author regulatory source references", () => {
    // Given the prompt says "write the GDPR source URL for each compliance gap"
    const artifactSet = replacePrompts(["write the GDPR source URL for each compliance gap"]);

    // When the contract artifact set is reviewed
    const review = reviewComplianceOutputContract(artifactSet);

    // Then the contract review fails
    expect(review.passed).toBe(false);

    // And the failure explains that framework references and source URLs must come from the catalog
    expect(review.failures.join("\n")).toContain(
      "framework references and source URLs must come from the catalog",
    );
  });

  it.each([
    "provide the GDPR source URL for each compliance gap",
    "generate the DORA source URL for each compliance gap",
    "For each ComplianceGap, provide its GDPR source URL",
    "provide source URLs for compliance gaps",
  ])("rejects equivalent prompt source-reference request: %s", (prompt) => {
    const artifactSet = replacePrompts([prompt]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(false);
    expect(review.failures.join("\n")).toContain(
      "framework references and source URLs must come from the catalog",
    );
  });

  it("does not reject prompts that prohibit LLM-authored source URLs", () => {
    const artifactSet = replacePrompts([
      "Do not provide source URLs for compliance gaps; use the catalog.",
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(true);
  });

  it("does not reject unrelated authoring verbs near catalog source URL guidance", () => {
    const artifactSet = replacePrompts([
      "Write a concise review summary. Use catalog source URLs for compliance gaps.",
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(true);
  });

  it("rejects schema artifacts that omit required distinguishing fields", () => {
    const artifactSet = replaceSchemas([
      {
        name: "Finding",
        fields: ["cwe"],
        required: [],
        categories: ["bug", "security"],
      },
      {
        name: "ComplianceGap",
        fields: ["evidence", "status"],
        required: [],
      },
      {
        name: "ControlResult",
        fields: ["control_id", "evidence"],
        required: [],
      },
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.passed).toBe(false);
    expect(review.failures).toEqual(
      expect.arrayContaining([
        'ComplianceGap schema must define field "control_id"',
        'ControlResult schema must define field "status"',
      ]),
    );
  });

  it("rejects a ComplianceGap schema that declares a CWE field, required or not", () => {
    const artifactSet = replaceSchemas([
      {
        name: "Finding",
        fields: ["cwe", "category", "file", "line_start", "line_end"],
        required: ["category", "file", "line_start", "line_end"],
        categories: ["bug", "security"],
      },
      {
        name: "ComplianceGap",
        fields: ["control_id", "evidence", "status", "cwe"],
        required: ["control_id"],
      },
      {
        name: "ControlResult",
        fields: ["control_id", "status", "evidence"],
        required: ["status"],
      },
    ]);

    const review = reviewComplianceOutputContract(artifactSet);

    expect(review.schema.compliance_gap_requires_cwe).toBe(true);
    expect(review.passed).toBe(false);
    expect(review.failures).toContain("ComplianceGap must not define a CWE field");
  });
});

function findContractSchema(
  artifactSet: ComplianceOutputContractArtifactSet,
  name: ComplianceOutputTerm,
): ComplianceOutputContractSchema {
  const schema = artifactSet.schemas.find((candidate) => candidate.name === name);
  if (schema === undefined) {
    throw new Error(`Missing ${name} schema fixture`);
  }

  return schema;
}

function replaceDocs(docs: readonly string[]): ComplianceOutputContractArtifactSet {
  return { ...VALID_CONTRACT_ARTIFACTS, docs };
}

function appendDocs(docs: readonly string[]): ComplianceOutputContractArtifactSet {
  return { ...VALID_CONTRACT_ARTIFACTS, docs: [...VALID_CONTRACT_ARTIFACTS.docs, ...docs] };
}

function replacePrompts(prompts: readonly string[]): ComplianceOutputContractArtifactSet {
  return { ...VALID_CONTRACT_ARTIFACTS, prompts };
}

function replaceSchemas(
  schemas: readonly ComplianceOutputContractSchema[],
): ComplianceOutputContractArtifactSet {
  return { ...VALID_CONTRACT_ARTIFACTS, schemas };
}
