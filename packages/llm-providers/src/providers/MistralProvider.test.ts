// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server.js";
import {
  DEFAULT_MISTRAL_MAX_TOKENS,
  DEFAULT_MISTRAL_MODEL,
  MistralProvider,
  MistralProviderError,
} from "./MistralProvider.js";
import {
  clientFromComplete,
  fakeClient,
  generateParams,
  mistralCompletion,
  mistralHttpResponse,
  TestApiKey,
  TestMaxTokens,
  TestModel,
  validStructuredResponse,
  type MistralComplete,
} from "./MistralProvider.test-helpers.js";

const CustomBaseUrl = "https://mistral.internal.example";
const MistralChatUrl = `${CustomBaseUrl}/v1/chat/completions`;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});

afterAll(() => server.close());

describe("MistralProvider", () => {
  it("uses Mistral defaults when no model or max token override is provided", () => {
    // Given a MistralProvider is constructed with apiKey "test-key"
    const provider = new MistralProvider({ apiKey: TestApiKey, client: fakeClient() });

    // When the provider metadata is inspected
    // Then name equals "mistral"
    // And model equals "mistral-large-latest"
    // And maxTokens is greater than 0
    expect(provider.name).toBe("mistral");
    expect(provider.model).toBe(DEFAULT_MISTRAL_MODEL);
    expect(provider.maxTokens).toBe(DEFAULT_MISTRAL_MAX_TOKENS);
    expect(provider.maxTokens).toBeGreaterThan(0);
  });

  it.each(["mistral-large-latest", "codestral-latest"])(
    "preserves configured model %s",
    (model) => {
      // Given a MistralProvider is constructed with apiKey "test-key" and model "<model>"
      const provider = new MistralProvider({ apiKey: TestApiKey, client: fakeClient(), model });

      // When the provider metadata is inspected
      // Then name equals "mistral"
      // And model equals "<model>"
      expect(provider.name).toBe("mistral");
      expect(provider.model).toBe(model);
    },
  );

  it("rejects an empty model before the SDK call", () => {
    // Given a MistralProvider is constructed with apiKey "test-key" and model ""
    // When construction validates provider options
    // Then construction fails with a typed Mistral provider error
    expect(
      () => new MistralProvider({ apiKey: TestApiKey, client: fakeClient(), model: "" }),
    ).toThrow(MistralProviderError);
  });

  it("posts a Mistral json_schema request and returns Zod-validated data", async () => {
    // Given a MistralProvider is constructed with apiKey "test-key"
    // And baseUrl "https://mistral.internal.example"
    let capturedAuthorization: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(MistralChatUrl, async ({ request }) => {
        capturedAuthorization = request.headers.get("authorization");
        capturedBody = await request.json();

        return mistralHttpResponse(validStructuredResponse);
      }),
    );
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      baseUrl: CustomBaseUrl,
      model: TestModel,
    });

    // When generateStructured sends a chat completion request
    const result = await provider.generateStructured(generateParams);

    // Then the Mistral client uses base URL "https://mistral.internal.example"
    // And chat.complete receives response_format type "json_schema"
    // And the response_format json_schema is derived from the supplied schema
    expect(result).toEqual(validStructuredResponse);
    expect(capturedAuthorization).toBe(`Bearer ${TestApiKey}`);
    expect(capturedBody).toMatchObject({
      model: TestModel,
      max_tokens: TestMaxTokens,
      messages: [
        { role: "system", content: generateParams.systemPrompt },
        { role: "user", content: generateParams.userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sovri_structured_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              findings: { type: "array" },
              walkthrough_markdown: { type: "string" },
            },
          },
        },
      },
    });
  });

  it("returns provider token usage and hides it from generateStructured", async () => {
    // Given the Mistral SDK usage payload has prompt_tokens 123 and completion_tokens 45
    const complete = vi.fn<MistralComplete>(async () =>
      mistralCompletion(validStructuredResponse, { promptTokens: 123, completionTokens: 45 }),
    );
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructuredWithUsage is called
    const withUsage = await provider.generateStructuredWithUsage(generateParams);
    const dataOnly = await provider.generateStructured(generateParams);

    // Then tokenUsage.prompt equals 123
    // And tokenUsage.completion equals 45
    // And generateStructured returns only the structured data
    expect(withUsage.data.summary).toBe("The diff looks safe.");
    expect(withUsage.tokenUsage).toEqual({ prompt: 123, completion: 45 });
    expect(dataOnly).toEqual(validStructuredResponse);
  });

  it("throws a typed provider error when usage is missing", async () => {
    // Given the Mistral SDK response omits usage
    const complete = vi.fn<MistralComplete>(async () => ({
      ...mistralCompletion(validStructuredResponse),
      usage: undefined,
    }));
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructuredWithUsage is called
    // Then MistralProviderError is thrown
    await expect(provider.generateStructuredWithUsage(generateParams)).rejects.toMatchObject({
      name: "MistralProviderError",
      message: expect.stringContaining("usage"),
    });
  });

  it("fails unsupported schema conversion before sending a request", async () => {
    // Given the requested response schema contains z.function()
    const complete = vi.fn<MistralComplete>();
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructured is called
    // Then a typed Mistral provider error is thrown
    await expect(
      provider.generateStructured({
        ...generateParams,
        schema: z.function({ input: [], output: z.string() }),
      }),
    ).rejects.toThrow(MistralProviderError);
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects schemas whose JSON Schema root is not an object", async () => {
    // Given the requested response schema is z.string() (scalar root)
    const complete = vi.fn<MistralComplete>();
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructured is called
    // Then construction fails before any SDK call
    await expect(
      provider.generateStructured({ ...generateParams, schema: z.string() }),
    ).rejects.toMatchObject({
      name: "MistralProviderError",
      message: expect.stringContaining("object schema"),
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("normalizes whitespace-padded models", () => {
    // Given the model option has surrounding whitespace
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: fakeClient(),
      model: "  mistral-large-latest  ",
    });

    // Then the stored model is trimmed
    expect(provider.model).toBe("mistral-large-latest");
  });
});
