// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Deterministic backstop (issue #2450) that drops obvious narration the prompt and schema let
// through. A finding survives the schema by carrying a non-empty `recommendation`, yet a model can
// still narrate ("Added X", body restates the diff). This guard catches the residue without LLM help.
//
// Conservative by design: it only drops a finding whose *title* is a bare change-description verb
// phrase carrying no defect signal. Scanning the title alone — not the body — is deliberate. Narration
// bodies routinely contain incidental negations ("ensures these routes are not empty"), so scanning
// the body would rescue the very narration this guard exists to drop. A genuine finding is
// problem-titled under the reframed prompt, so dropping bare change-verb titles loses no real issue.

// Change-description verbs that open a narration title. Present and common past/3rd-person tenses.
const NARRATION_TITLE_PATTERN =
  /^(?:add(?:ed|s)?|updat(?:e|ed|es)|extend(?:ed|s)?|remov(?:e|ed|es)|delet(?:e|ed|es)|introduc(?:e|ed|es)|renam(?:e|ed|es)|mov(?:e|ed|es)|extract(?:ed|s)?|consolidat(?:e|ed|es)|reorganiz(?:e|ed|es)|restructur(?:e|ed|es)|refactor(?:ed|s)?|rework(?:ed|s)?|modif(?:y|ied|ies)|implement(?:ed|s)?|creat(?:e|ed|es))\b/iu;

// Strip leading markdown/punctuation so a decorated title like `` `Added` x `` or `**Added** x` is still
// recognised as opening with a change verb. Letters and digits start the meaningful title.
const LEADING_DECORATION_PATTERN = /^[^\p{L}\p{N}]+/u;

// Defect/risk vocabulary. Its presence in the title overrides the narration verb — "Added unchecked
// cast" stays, "Added helper function" drops.
const PROBLEM_SIGNAL_PATTERN =
  /\b(?:bug|broken|break(?:s|ing)?|crash(?:es|ed)?|fail(?:s|ure|ing|ed)?|incorrect|wrong|invalid|unsafe|unsound|insecure|risk(?:y)?|vulnerab\w*|exploit|bypass|inject\w*|leak(?:s|ed|ing)?|race|deadlock|null|undefined|nan|overflow|underflow|off-by-one|missing|absent|unhandled|unchecked|unvalidated|throw(?:s|n)?|panic|regress\w*|exposure|expose[sd]?|mismatch|inconsistent|deprecat\w*|bottleneck|dos|denial)\b/iu;

export interface ActionableFindingShape {
  readonly title: string;
  readonly recommendation: string;
}

/**
 * Returns false for a finding that only narrates the diff: an empty/whitespace `recommendation`, or a
 * title that opens with a change-description verb and carries no defect signal.
 *
 * `finding.title` is expected from a schema-validated finding (≤200 chars). Both patterns are
 * linear-time (anchored, no ambiguous nesting), and the length bound keeps evaluation trivial.
 *
 * Known limitation: scanning the title alone cannot catch passive-voice narration ("The X function was
 * added"), since the change verb does not open the title. This is deliberate — the reframed prompt
 * titles findings as problems, and the schema/prompt layers are the primary defenses; this guard only
 * drops the clearest residual narration.
 */
export function isActionable(finding: ActionableFindingShape): boolean {
  if (finding.recommendation.trim().length === 0) {
    return false;
  }

  const title = finding.title.trim();
  const undecorated = title.replace(LEADING_DECORATION_PATTERN, "");
  if (!NARRATION_TITLE_PATTERN.test(undecorated)) {
    return true;
  }

  // The full (decorated) title is scanned for a defect signal so a backtick-wrapped keyword still counts.
  return PROBLEM_SIGNAL_PATTERN.test(title);
}

export interface PartitionedFindings<T> {
  readonly kept: readonly T[];
  readonly droppedCount: number;
}

/**
 * Splits findings into the actionable ones and a count of dropped narration, so the orchestrator can
 * log how many it discarded — never a silent truncation.
 */
export function partitionActionableFindings<T extends ActionableFindingShape>(
  findings: readonly T[],
): PartitionedFindings<T> {
  const kept = findings.filter((finding) => isActionable(finding));

  return { kept, droppedCount: findings.length - kept.length };
}
