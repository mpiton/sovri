// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// The review pipeline as a GitHub-native mermaid fence. GitHub strips CSS in PR comments (ADR-016),
// so the flow is expressed as a ```mermaid block — never a styled diagram. It is optional and off by
// default so existing golden snapshots stay byte-stable; when enabled it sits under the verdict header.
export function renderPipelineFlow(): string[] {
  return ["```mermaid", "flowchart LR", "  diff --> prompt --> LLM --> findings", "```"];
}
