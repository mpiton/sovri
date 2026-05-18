// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AnthropicAuthError,
  AnthropicResponseError,
  AnthropicRetryError,
  AnthropicTimeoutError,
} from "../errors.js";
import {
  AnthropicProvider,
  MAX_ANTHROPIC_MAX_TOKENS,
  MAX_ANTHROPIC_TIMEOUT_MS,
} from "./AnthropicProvider.js";

const AnthropicMessagesUrl = "https://api.anthropic.com/v1/messages";
const TestApiKey = "test-key";
const TestModel = "claude-sonnet-4-test";

const ReviewResultSchema = z.strictObject({
  summary: z.string(),
  findings: z.array(z.string()),
  walkthrough_markdown: z.string(),
});

const generateParams = {
  systemPrompt: "Review this pull request and answer with JSON only.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: ReviewResultSchema,
  maxTokens: 512,
  temperature: 0,
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});

afterAll(() => server.close());

describe("AnthropicProvider error handling", () => {
  it("preserves literal error names for discriminated narrowing", () => {
    const authName: "AnthropicAuthError" = new AnthropicAuthError("test auth").name;
    const responseName: "AnthropicResponseError" = new AnthropicResponseError("test response").name;
    const retryName: "AnthropicRetryError" = new AnthropicRetryError("test retry").name;
    const timeoutName: "AnthropicTimeoutError" = new AnthropicTimeoutError("test timeout").name;

    expect([authName, responseName, retryName, timeoutName]).toEqual([
      "AnthropicAuthError",
      "AnthropicResponseError",
      "AnthropicRetryError",
      "AnthropicTimeoutError",
    ]);
  });

  it("throws a typed auth error when the API key is missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(() => new AnthropicProvider({ model: TestModel })).toThrow(AnthropicAuthError);
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_ANTHROPIC_MAX_TOKENS + 1])(
    "rejects invalid constructor maxTokens: %s",
    (maxTokens) => {
      expect(
        () =>
          new AnthropicProvider({
            env: { ANTHROPIC_API_KEY: TestApiKey },
            maxTokens,
            model: TestModel,
          }),
      ).toThrow(AnthropicResponseError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, MAX_ANTHROPIC_TIMEOUT_MS + 1])(
    "rejects invalid constructor timeoutMs: %s",
    (timeoutMs) => {
      expect(
        () =>
          new AnthropicProvider({
            env: { ANTHROPIC_API_KEY: TestApiKey },
            model: TestModel,
            timeoutMs,
          }),
      ).toThrow(AnthropicResponseError);
    },
  );

  it("rejects invalid per-call maxTokens before sending a request", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", TestApiKey);
    let requestSent = false;
    server.use(
      http.post(AnthropicMessagesUrl, () => {
        requestSent = true;
        return anthropicMessageWithText("{}");
      }),
    );

    const provider = new AnthropicProvider({ model: TestModel });

    await expect(
      provider.generateStructured({
        ...generateParams,
        maxTokens: MAX_ANTHROPIC_MAX_TOKENS + 1,
      }),
    ).rejects.toThrow(AnthropicResponseError);
    expect(requestSent).toBe(false);
  });

  it("throws a typed auth error when Anthropic rejects the API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", TestApiKey);
    server.use(
      http.post(AnthropicMessagesUrl, () =>
        HttpResponse.json(
          {
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          },
          { status: 401 },
        ),
      ),
    );

    const provider = new AnthropicProvider({ model: TestModel });

    await expect(provider.generateStructured(generateParams)).rejects.toMatchObject({
      name: "AnthropicAuthError",
      status: 401,
    });
  });

  it("throws a typed response error when Anthropic returns malformed JSON", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", TestApiKey);
    server.use(http.post(AnthropicMessagesUrl, () => anthropicMessageWithText("{not valid json")));

    const provider = new AnthropicProvider({ model: TestModel });

    await expect(provider.generateStructured(generateParams)).rejects.toThrow(
      AnthropicResponseError,
    );
  });

  it("throws a typed response error when Anthropic JSON violates the supplied schema", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", TestApiKey);
    server.use(
      http.post(AnthropicMessagesUrl, () =>
        anthropicMessageWithText(
          JSON.stringify({
            summary: 42,
            findings: ["No blocking issue found."],
            walkthrough_markdown: "Reviewed the auth handler changes.",
          }),
        ),
      ),
    );

    const provider = new AnthropicProvider({ model: TestModel });

    await expect(provider.generateStructured(generateParams)).rejects.toMatchObject({
      name: "AnthropicResponseError",
      retryableWithCorrectivePrompt: true,
      tokenUsage: { prompt: 42, completion: 24 },
    });
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
