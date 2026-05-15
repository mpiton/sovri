// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

// Targets draft 2020-12 — the dialect every modern LLM (Anthropic tools,
// OpenAI / Mistral response_format) parses — and inlines reused subschemas
// (`reused: "inline"`) because several providers fail to resolve `$ref`
// reliably. `cycles: "ref"` and `unrepresentable: "throw"` are pinned
// explicitly so future Zod default changes do not silently relax the
// contract (recursive schemas keep emitting `$ref` rather than looping
// forever; unrepresentable types like `z.function()` throw at build time
// instead of producing `{}` that the LLM would silently honour). Provider-
// specific tweaks (e.g. OpenAI strict mode's recursive
// `additionalProperties: false`) belong to the adapter, not here.
export function zodToProviderJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    reused: "inline",
    cycles: "ref",
    unrepresentable: "throw",
  });
}

export type ProviderJsonSchema = ReturnType<typeof zodToProviderJsonSchema>;
