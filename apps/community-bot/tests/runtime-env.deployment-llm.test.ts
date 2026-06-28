// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "@sovri/config";

import {
  buildDeploymentDefaultConfig,
  DeploymentConfigError,
  resolveDeploymentLlmConfig,
} from "../src/runtime-env.js";

describe("resolveDeploymentLlmConfig — explicit provider", () => {
  it("uses an explicit Mistral provider with the conventional key and default model", () => {
    const llm = resolveDeploymentLlmConfig({
      MISTRAL_API_KEY: "mst-test",
      SOVRI_DEFAULT_LLM_PROVIDER: "mistral",
    });

    expect(llm).toEqual({
      apiKeySecret: "MISTRAL_API_KEY",
      model: "mistral-large-latest",
      provider: "mistral",
    });
  });

  it("uses an explicit Anthropic provider with the conventional key and default model", () => {
    const llm = resolveDeploymentLlmConfig({
      ANTHROPIC_API_KEY: "ant-test",
      SOVRI_DEFAULT_LLM_PROVIDER: "anthropic",
    });

    expect(llm).toEqual({
      apiKeySecret: "ANTHROPIC_API_KEY",
      model: "claude-3-5-sonnet-latest",
      provider: "anthropic",
    });
  });

  it("honors a custom model and api key secret override", () => {
    const llm = resolveDeploymentLlmConfig({
      SOVRI_DEFAULT_LLM_API_KEY_SECRET: "ACME_MISTRAL_KEY",
      SOVRI_DEFAULT_LLM_MODEL: "mistral-medium-latest",
      SOVRI_DEFAULT_LLM_PROVIDER: "mistral",
    });

    expect(llm).toEqual({
      apiKeySecret: "ACME_MISTRAL_KEY",
      model: "mistral-medium-latest",
      provider: "mistral",
    });
  });
});

describe("resolveDeploymentLlmConfig — inference from available keys", () => {
  it("infers Mistral when only MISTRAL_API_KEY is present", () => {
    expect(resolveDeploymentLlmConfig({ MISTRAL_API_KEY: "mst" }).provider).toBe("mistral");
  });

  it("infers Anthropic when only ANTHROPIC_API_KEY is present", () => {
    expect(resolveDeploymentLlmConfig({ ANTHROPIC_API_KEY: "ant" }).provider).toBe("anthropic");
  });

  it("prefers Anthropic when both keys are present (backward-compatible precedence)", () => {
    expect(
      resolveDeploymentLlmConfig({ ANTHROPIC_API_KEY: "ant", MISTRAL_API_KEY: "mst" }).provider,
    ).toBe("anthropic");
  });

  it("warns and recommends an explicit provider when both keys are present", () => {
    const warnings: string[] = [];
    const logger = {
      warn: (_bindings: Readonly<Record<string, unknown>>, message: string) => {
        warnings.push(message);
      },
    };

    resolveDeploymentLlmConfig({ ANTHROPIC_API_KEY: "ant", MISTRAL_API_KEY: "mst" }, logger);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SOVRI_DEFAULT_LLM_PROVIDER");
  });

  it("throws DeploymentConfigError when no provider can be determined", () => {
    expect(() => resolveDeploymentLlmConfig({})).toThrow(DeploymentConfigError);
  });

  it("explains how to configure a provider when none can be determined", () => {
    expect(() => resolveDeploymentLlmConfig({})).toThrow(/SOVRI_DEFAULT_LLM_PROVIDER/u);
  });
});

describe("resolveDeploymentLlmConfig — malformed input", () => {
  it("rejects an unsupported explicit provider and names SOVRI_DEFAULT_LLM_PROVIDER", () => {
    try {
      resolveDeploymentLlmConfig({ SOVRI_DEFAULT_LLM_PROVIDER: "openai" });
      expect.unreachable("expected DeploymentConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigError);
      if (error instanceof DeploymentConfigError) {
        expect(error.message).toContain("SOVRI_DEFAULT_LLM_PROVIDER");
      }
    }
  });

  it("rejects an invalid model identifier and names SOVRI_DEFAULT_LLM_MODEL", () => {
    try {
      resolveDeploymentLlmConfig({
        SOVRI_DEFAULT_LLM_MODEL: "bad model",
        SOVRI_DEFAULT_LLM_PROVIDER: "mistral",
      });
      expect.unreachable("expected DeploymentConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigError);
      if (error instanceof DeploymentConfigError) {
        expect(error.message).toContain("SOVRI_DEFAULT_LLM_MODEL");
      }
    }
  });

  it("rejects a secret name that is not an environment variable identifier and names SOVRI_DEFAULT_LLM_API_KEY_SECRET", () => {
    try {
      resolveDeploymentLlmConfig({
        SOVRI_DEFAULT_LLM_API_KEY_SECRET: "sk-live-abc123secret",
        SOVRI_DEFAULT_LLM_PROVIDER: "mistral",
      });
      expect.unreachable("expected DeploymentConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigError);
      if (error instanceof DeploymentConfigError) {
        expect(error.message).toContain("SOVRI_DEFAULT_LLM_API_KEY_SECRET");
      }
    }
  });

  it("never echoes a secret-like value into the error message", () => {
    try {
      resolveDeploymentLlmConfig({
        SOVRI_DEFAULT_LLM_API_KEY_SECRET: "sk-live-abc123secret",
        SOVRI_DEFAULT_LLM_PROVIDER: "mistral",
      });
      expect.unreachable("expected DeploymentConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigError);
      if (error instanceof DeploymentConfigError) {
        expect(error.message).not.toContain("sk-live-abc123secret");
      }
    }
  });
});

describe("buildDeploymentDefaultConfig", () => {
  it("returns a full SovriConfig with schema defaults for the non-llm blocks", () => {
    const config = buildDeploymentDefaultConfig({ MISTRAL_API_KEY: "mst" });

    expect(config.llm.provider).toBe("mistral");
    expect(config.review.mode).toBe("compliance");
    expect(config.limits.maxFilesPerReview).toBe(50);
    expect(config.ignores).toEqual([]);
    expect(() => SovriConfigSchema.parse(config)).not.toThrow();
  });

  it("returns a fresh frozen config per call rather than a shared mutable singleton", () => {
    const mistral = buildDeploymentDefaultConfig({ MISTRAL_API_KEY: "mst" });
    const anthropic = buildDeploymentDefaultConfig({ ANTHROPIC_API_KEY: "ant" });

    expect(Object.isFrozen(mistral)).toBe(true);
    expect(mistral).not.toBe(anthropic);
    expect(mistral.llm.provider).toBe("mistral");
    expect(anthropic.llm.provider).toBe("anthropic");
  });

  it("propagates the no-provider failure as a DeploymentConfigError", () => {
    expect(() => buildDeploymentDefaultConfig({})).toThrow(DeploymentConfigError);
  });
});
