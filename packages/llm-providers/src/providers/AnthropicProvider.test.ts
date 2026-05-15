// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LLMResponseSchema, type LLMResponse } from "../schemas/LLMResponseSchema.js";
import {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_MODEL,
  MAX_ANTHROPIC_MAX_TOKENS,
} from "./AnthropicProvider.js";

const AnthropicMessagesUrl = "https://api.anthropic.com/v1/messages";
const TestApiKey = "test-key";
const TestModel = "claude-sonnet-4-test";
const TestMaxTokens = 512;

const AnthropicMessageRequestSchema = z.strictObject({
  role: z.string(),
  content: z.string(),
});
const AnthropicJsonSchemaFormatSchema = z
  .strictObject({ type: z.literal("json_schema"), schema: z.unknown() })
  .passthrough();
const AnthropicRequestSchema = z
  .strictObject({
    model: z.string(),
    max_tokens: z.number().int().positive().max(MAX_ANTHROPIC_MAX_TOKENS),
    messages: z.array(AnthropicMessageRequestSchema),
    system: z.string(),
    output_config: z.strictObject({ format: AnthropicJsonSchemaFormatSchema }).passthrough(),
  })
  .passthrough();
type AnthropicRequest = z.infer<typeof AnthropicRequestSchema>;

const validStructuredResponse: LLMResponse = {
  summary: "The diff looks safe.",
  findings: [],
  walkthrough_markdown: "Reviewed the auth handler changes.",
};

const generateParams = {
  systemPrompt: "Review this pull request and answer with JSON only.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: LLMResponseSchema,
  maxTokens: TestMaxTokens,
  temperature: 0,
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});

afterAll(() => server.close());

describe("AnthropicProvider", () => {
  it("uses Claude Sonnet defaults when no model or max token override is provided", () => {
    const provider = new AnthropicProvider({ env: { ANTHROPIC_API_KEY: TestApiKey } });

    expect(provider.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(provider.model).toMatch(/^claude-sonnet-4-/);
    expect(provider.maxTokens).toBe(DEFAULT_ANTHROPIC_MAX_TOKENS);
  });

  it("does not require ANTHROPIC_API_KEY when an explicit client is injected", () => {
    const client = { messages: { create: vi.fn() } } as never;

    expect(
      () => new AnthropicProvider({ client, env: { ANTHROPIC_API_KEY: undefined } }),
    ).not.toThrow();
  });

  it("posts a structured-output request and returns a Zod-validated response", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", TestApiKey);

    let capturedRequest: AnthropicRequest | undefined;
    let capturedApiKey: string | null = null;
    let capturedBetaHeader: string | null = null;

    server.use(
      http.post(AnthropicMessagesUrl, async ({ request }) => {
        capturedApiKey = request.headers.get("x-api-key");
        capturedBetaHeader = request.headers.get("anthropic-beta");
        capturedRequest = AnthropicRequestSchema.parse(await request.json());

        return anthropicMessageWithText(JSON.stringify(validStructuredResponse));
      }),
    );

    const provider = new AnthropicProvider({ model: TestModel });

    const result = await provider.generateStructured(generateParams);

    expect(result).toEqual(validStructuredResponse);
    expect(capturedApiKey).toBe(TestApiKey);
    expect(capturedBetaHeader).toBe("structured-outputs-2025-11-13");

    const body = AnthropicRequestSchema.parse(capturedRequest);
    expect(body.model).toBe(TestModel);
    expect(body.max_tokens).toBe(TestMaxTokens);
    expect(body.system).toBe(generateParams.systemPrompt);
    expect(body.messages).toEqual([{ role: "user", content: generateParams.userPrompt }]);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        findings: { type: "array" },
        walkthrough_markdown: { type: "string" },
      },
    });
    const schema = parseJsonObject(body.output_config.format.schema);
    const properties = parseJsonObject(schema.properties);
    const summarySchema = parseJsonObject(properties.summary);
    const findingsSchema = parseJsonObject(properties.findings);

    expect(schema).not.toHaveProperty("$schema");
    expect(summarySchema).not.toHaveProperty("maxLength");
    expect(z.string().parse(summarySchema.description)).toContain("maxLength");
    expect(findingsSchema).not.toHaveProperty("maxItems");
    expect(z.string().parse(findingsSchema.description)).toContain("maxItems");
  });
});

function anthropicMessageWithText(text: string) {
  return HttpResponse.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: TestModel,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 42, output_tokens: 24 },
  });
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}
