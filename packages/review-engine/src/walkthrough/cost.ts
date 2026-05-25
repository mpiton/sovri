// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { TokenUsage } from "@sovri/llm-providers";

export type PricingProvider = "anthropic" | "mistral";

export interface ModelPricing {
  readonly promptUsdPer1k: number;
  readonly completionUsdPer1k: number;
}

const AnthropicSonnetPricing: ModelPricing = {
  promptUsdPer1k: 0.003,
  completionUsdPer1k: 0.015,
};

const MistralLargePricing: ModelPricing = {
  promptUsdPer1k: 0.0005,
  completionUsdPer1k: 0.0015,
};

const CodestralPricing: ModelPricing = {
  promptUsdPer1k: 0.0003,
  completionUsdPer1k: 0.0009,
};

// TODO(v0.3): refresh pricing constants before the next provider docs pass.
export const PROVIDER_PRICING: Readonly<
  Record<PricingProvider, Readonly<Record<string, ModelPricing>>>
> = {
  // Anthropic pricing source:
  // https://docs.anthropic.com/en/docs/about-claude/pricing
  // https://platform.claude.com/docs/en/about-claude/models/overview
  // Claude Sonnet 4.6 pricing checked 2026-05-25: $3 input MTok, $15 output MTok.
  anthropic: {
    "claude-sonnet-4-6": AnthropicSonnetPricing,
  },
  // Mistral pricing sources:
  // https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12
  // https://docs.mistral.ai/models/model-cards/codestral-25-08
  // Mistral Large 3 pricing checked 2026-05-25: $0.5 input MTok, $1.5 output MTok.
  // Codestral pricing checked 2026-05-25: $0.3 input MTok, $0.9 output MTok.
  mistral: {
    "mistral-large-latest": MistralLargePricing,
    "mistral-large-2512": MistralLargePricing,
    "codestral-latest": CodestralPricing,
    "codestral-2508": CodestralPricing,
  },
};

export function estimateCostUsd(usage: TokenUsage, pricing: ModelPricing): number {
  return (
    (usage.prompt * pricing.promptUsdPer1k + usage.completion * pricing.completionUsdPer1k) / 1000
  );
}

export function renderCostFooter(
  usage: TokenUsage | undefined,
  provider: string,
  model: string,
): string {
  if (usage === undefined) {
    return "";
  }

  const pricing = getModelPricing(provider, model);
  const cost =
    pricing === undefined ? "unavailable" : `$${estimateCostUsd(usage, pricing).toFixed(4)}`;

  return `_Tokens: ${String(usage.prompt)} in / ${String(usage.completion)} out · Estimated cost: ${cost} (${provider} ${model})_`;
}

function getModelPricing(provider: string, model: string): ModelPricing | undefined {
  if (!isProvider(provider)) {
    return undefined;
  }

  return PROVIDER_PRICING[provider][model];
}

function isProvider(provider: string): provider is PricingProvider {
  return provider === "anthropic" || provider === "mistral";
}
