// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";

import type { TokenUsage } from "@sovri/llm-providers";
import { describe, expect, it, vi } from "vitest";

import { estimateCostUsd, PROVIDER_PRICING, renderCostFooter, type ModelPricing } from "./cost.js";

const SonnetModel = "claude-sonnet-4-6";

describe("PROVIDER_PRICING", () => {
  it("covers every active provider and v0.2 model", () => {
    expect(PROVIDER_PRICING.anthropic).toHaveProperty(SonnetModel);
    expect(PROVIDER_PRICING.mistral).toHaveProperty("mistral-large-latest");
    expect(PROVIDER_PRICING.mistral).toHaveProperty("codestral-latest");
  });

  it("does not represent active providers with empty or zero-valued pricing", () => {
    expect(Object.keys(PROVIDER_PRICING.anthropic).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(PROVIDER_PRICING.mistral).length).toBeGreaterThanOrEqual(2);

    for (const providerPricing of Object.values(PROVIDER_PRICING)) {
      for (const pricing of Object.values(providerPricing)) {
        expect(pricing.promptUsdPer1k).toBeGreaterThan(0);
        expect(pricing.completionUsdPer1k).toBeGreaterThan(0);
      }
    }
  });

  it("stores published per-million token prices as per-thousand token constants", () => {
    expect(PROVIDER_PRICING.anthropic[SonnetModel]?.promptUsdPer1k).toBe(0.003);
    expect(PROVIDER_PRICING.anthropic[SonnetModel]?.completionUsdPer1k).toBe(0.015);
    expect(PROVIDER_PRICING.mistral["mistral-large-latest"]?.promptUsdPer1k).toBe(0.0005);
    expect(PROVIDER_PRICING.mistral["mistral-large-latest"]?.completionUsdPer1k).toBe(0.0015);
    expect(PROVIDER_PRICING.mistral["codestral-latest"]?.promptUsdPer1k).toBe(0.0003);
    expect(PROVIDER_PRICING.mistral["codestral-latest"]?.completionUsdPer1k).toBe(0.0009);
  });
});

describe("renderCostFooter fallbacks", () => {
  it("returns an empty string without broken placeholders when usage is undefined", () => {
    const markdown = renderCostFooter(undefined, "anthropic", SonnetModel);

    expect(markdown).toBe("");
    expect(markdown).not.toContain("Tokens");
    expect(markdown).not.toContain("Estimated cost");
    expect(markdown).not.toContain("undefined");
  });

  it("skips pricing lookup entirely when usage is undefined", () => {
    expect(renderCostFooter(undefined, "anthropic", "unlisted-preview-model")).toBe("");
  });

  it("renders token counts and unavailable cost when the model is unknown", () => {
    const markdown = renderCostFooter(usage(1234, 567), "mistral", "mistral-preview-2026-05");

    expect(markdown).toBe(
      "_Tokens: 1234 in / 567 out · Estimated cost: unavailable (mistral mistral-preview-2026-05)_",
    );
    expect(markdown).not.toContain("$0.0000");
  });

  it("keeps unknown providers non-breaking", () => {
    const markdown = renderCostFooter(usage(1234, 567), "openai-compatible", "local-qwen-72b");

    expect(markdown).toBe(
      "_Tokens: 1234 in / 567 out · Estimated cost: unavailable (openai-compatible local-qwen-72b)_",
    );
  });
});

describe("renderCostFooter rounding", () => {
  it("renders known model usage as a four-decimal USD footer", () => {
    const markdown = renderCostFooter(usage(1234, 567), "anthropic", SonnetModel);

    expect(markdown).toBe(
      "_Tokens: 1234 in / 567 out · Estimated cost: $0.0122 (anthropic claude-sonnet-4-6)_",
    );
    expect(markdown).not.toContain("$0.01220");
    expect(markdown).not.toContain("$0.012207");
  });

  it.each([
    { prompt: 0, completion: 0, rawCost: 0, formattedCost: "0.0000" },
    { prompt: 1, completion: 0, rawCost: 0.000_003, formattedCost: "0.0000" },
    { prompt: 250_000, completion: 25_000, rawCost: 1.125, formattedCost: "1.1250" },
  ])(
    "keeps four-decimal formatting for $prompt prompt and $completion completion tokens",
    ({ prompt, completion, rawCost, formattedCost }) => {
      const tokenUsage = usage(prompt, completion);
      const estimated = estimateCostUsd(tokenUsage, PROVIDER_PRICING.anthropic[SonnetModel]);
      const markdown = renderCostFooter(tokenUsage, "anthropic", SonnetModel);

      expect(estimated).toBeCloseTo(rawCost, 12);
      expect(markdown).toContain(`Estimated cost: $${formattedCost}`);
    },
  );
});

describe("estimateCostUsd purity", () => {
  it("is deterministic for the same input", () => {
    const tokenUsage = usage(1234, 567);
    const pricing: ModelPricing = { promptUsdPer1k: 0.003, completionUsdPer1k: 0.015 };

    const first = estimateCostUsd(tokenUsage, pricing);
    const second = estimateCostUsd(tokenUsage, pricing);

    expect(first).toBeCloseTo(0.012_207, 12);
    expect(second).toBe(first);
  });

  it("does not mutate caller-owned input objects", () => {
    const tokenUsage = Object.freeze<TokenUsage>(usage(1234, 567));
    const pricing = Object.freeze<ModelPricing>({
      promptUsdPer1k: 0.003,
      completionUsdPer1k: 0.015,
    });

    estimateCostUsd(tokenUsage, pricing);

    expect(tokenUsage).toEqual(usage(1234, 567));
    expect(pricing).toEqual({ promptUsdPer1k: 0.003, completionUsdPer1k: 0.015 });
  });

  it("ignores environment variables and system time", () => {
    const originalOverride = process.env.SOVRI_PRICE_OVERRIDE_USD;
    process.env.SOVRI_PRICE_OVERRIDE_USD = "999";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T10:00:00.000Z"));

    try {
      const markdown = renderCostFooter(usage(1234, 567), "anthropic", SonnetModel);

      expect(markdown).toContain("Estimated cost: $0.0122");
      expect(markdown).not.toContain("999");
    } finally {
      vi.useRealTimers();
      if (originalOverride === undefined) {
        delete process.env.SOVRI_PRICE_OVERRIDE_USD;
      } else {
        process.env.SOVRI_PRICE_OVERRIDE_USD = originalOverride;
      }
    }
  });
});

describe("pricing source traceability", () => {
  it("links pricing constants to official provider price pages", () => {
    const source = readCostSource();

    expect(source).toContain("https://docs.anthropic.com");
    expect(source).toContain("https://docs.mistral.ai");
    expect(source).toContain("pricing");
  });

  it("keeps pricing comments auditable", () => {
    const source = readCostSource();

    expect(source).toMatch(/Anthropic pricing source:[\s\S]+Claude Sonnet/u);
    expect(source).toMatch(/Mistral pricing sources:[\s\S]+Mistral Large[\s\S]+Codestral/u);
    expect(source).toContain("TODO(v0.3)");
    expect(source).toContain("refresh");
  });
});

function usage(prompt: number, completion: number): TokenUsage {
  return { prompt, completion };
}

function readCostSource(): string {
  return readFileSync(new URL("./cost.ts", import.meta.url), "utf8");
}
