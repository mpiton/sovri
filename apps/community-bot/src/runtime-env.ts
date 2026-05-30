// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createPrivateKey } from "node:crypto";

import { SovriConfigSchema, type SovriConfig } from "@sovri/config";

const DEFAULT_PORT = 3000;
const DECIMAL_INTEGER = /^\d+$/u;
const MAX_PORT = 65535;
const MIN_PORT = 1;

export type RuntimeEnvironment = {
  readonly appId: string;
  readonly port: number;
  readonly privateKey: string;
  readonly webhookSecret: string;
};

export class RuntimeEnvironmentError extends Error {
  public override readonly name = "RuntimeEnvironmentError";
}

export function readRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): RuntimeEnvironment {
  return {
    appId: readAppId(env),
    port: readPort(env.PORT),
    privateKey: readPrivateKey(env),
    webhookSecret: readRequiredEnv(env, "WEBHOOK_SECRET"),
  };
}

export function applyRuntimeEnvironmentDefaults(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  const runtimeEnvironment = readRuntimeEnvironment(env);
  env.PORT = String(runtimeEnvironment.port);
  env.PRIVATE_KEY = runtimeEnvironment.privateKey;
  return runtimeEnvironment;
}

function readPrivateKey(env: NodeJS.ProcessEnv): string {
  const privateKey = readRequiredEnv(env, "PRIVATE_KEY").replaceAll("\\n", "\n");
  try {
    createPrivateKey(privateKey);
  } catch {
    throw new RuntimeEnvironmentError("PRIVATE_KEY must contain valid PEM private key material");
  }
  return privateKey;
}

function readAppId(env: NodeJS.ProcessEnv): string {
  const appId = readRequiredEnv(env, "APP_ID").trim();
  const parsed = Number.parseInt(appId, 10);
  if (!DECIMAL_INTEGER.test(appId) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RuntimeEnvironmentError("APP_ID must be a positive integer");
  }
  return appId;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new RuntimeEnvironmentError(`${name} is required`);
  }
  return value;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_PORT;
  }

  const normalized = value.trim();
  if (!DECIMAL_INTEGER.test(normalized)) {
    throw new RuntimeEnvironmentError(
      `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}`,
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new RuntimeEnvironmentError(
      `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Deployment-level LLM defaults (issue #1959)
//
// `.sovri.yml` is an OPTIONAL repository-level override. When a reviewed
// repository omits it (or ships an empty file), the bot resolves the LLM
// provider from deployment configuration instead of a hard-coded Anthropic
// default, so a self-host operator configures BYOK once and reviews many
// repositories without committing a `.sovri.yml` to each one.
//
// Resolution order (highest precedence first):
//   1. Explicit `SOVRI_DEFAULT_LLM_PROVIDER` (`anthropic` | `mistral`).
//   2. Inference from a present provider key — Anthropic first when both are
//      set (backward-compatible with the previous hard-coded default).
//   3. Otherwise no provider can be chosen → `DeploymentConfigError`.
//
// Every resolved value is validated through `SovriConfigSchema` — the same
// schema as a `.sovri.yml` — so an unsupported provider, an invalid model, or
// a secret-shaped api-key-secret name is rejected before it can be used,
// logged, or echoed into a public PR comment.
// ---------------------------------------------------------------------------

export type DeploymentLlmProvider = "anthropic" | "mistral";

export type DeploymentLlmConfig = {
  readonly apiKeySecret: string;
  readonly model: string;
  readonly provider: DeploymentLlmProvider;
};

export class DeploymentConfigError extends Error {
  public override readonly name = "DeploymentConfigError";
}

type DeploymentConfigLogger = {
  warn(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

const DEPLOYMENT_PROVIDER_DEFAULTS: Record<
  DeploymentLlmProvider,
  { readonly apiKeySecret: string; readonly model: string }
> = {
  anthropic: { apiKeySecret: "ANTHROPIC_API_KEY", model: "claude-3-5-sonnet-latest" },
  mistral: { apiKeySecret: "MISTRAL_API_KEY", model: "mistral-large-latest" },
};

const OFFENDING_ENV_BY_FIELD: Record<string, string> = {
  apiKeySecret: "SOVRI_DEFAULT_LLM_API_KEY_SECRET",
  model: "SOVRI_DEFAULT_LLM_MODEL",
  provider: "SOVRI_DEFAULT_LLM_PROVIDER",
};

export function resolveDeploymentLlmConfig(
  env: NodeJS.ProcessEnv,
  logger?: DeploymentConfigLogger,
): DeploymentLlmConfig {
  return resolveDeploymentConfig(env, logger).llm;
}

export function buildDeploymentDefaultConfig(
  env: NodeJS.ProcessEnv,
  logger?: DeploymentConfigLogger,
): SovriConfig {
  return deepFreeze(resolveDeploymentConfig(env, logger).config);
}

// Resolve the deployment `llm` block and validate it through the SAME schema as
// a `.sovri.yml`, in a single pass. Returns both the narrow `llm` block (for
// callers that only need the provider selection) and the full `SovriConfig`
// with `review` / `limits` / `ignores` schema defaults applied.
function resolveDeploymentConfig(
  env: NodeJS.ProcessEnv,
  logger?: DeploymentConfigLogger,
): { readonly config: SovriConfig; readonly llm: DeploymentLlmConfig } {
  const provider = resolveProvider(env, logger);
  const defaults = DEPLOYMENT_PROVIDER_DEFAULTS[provider];
  const model = readOptionalEnv(env, "SOVRI_DEFAULT_LLM_MODEL") ?? defaults.model;
  const apiKeySecret =
    readOptionalEnv(env, "SOVRI_DEFAULT_LLM_API_KEY_SECRET") ?? defaults.apiKeySecret;

  const result = SovriConfigSchema.safeParse({ llm: { apiKeySecret, model, provider } });
  if (!result.success) {
    throw new DeploymentConfigError(
      `Invalid deployment LLM configuration: ${offendingEnvVar(result.error.issues)} does not satisfy the .sovri.yml schema`,
    );
  }

  return { config: result.data, llm: { apiKeySecret, model, provider } };
}

function resolveProvider(
  env: NodeJS.ProcessEnv,
  logger?: DeploymentConfigLogger,
): DeploymentLlmProvider {
  const explicit = readOptionalEnv(env, "SOVRI_DEFAULT_LLM_PROVIDER");
  if (explicit !== undefined) {
    if (explicit !== "anthropic" && explicit !== "mistral") {
      throw new DeploymentConfigError(
        "Invalid deployment LLM configuration: SOVRI_DEFAULT_LLM_PROVIDER must be 'anthropic' or 'mistral'",
      );
    }
    return explicit;
  }

  const hasAnthropic = readOptionalEnv(env, "ANTHROPIC_API_KEY") !== undefined;
  const hasMistral = readOptionalEnv(env, "MISTRAL_API_KEY") !== undefined;

  if (hasAnthropic && hasMistral) {
    logger?.warn(
      { provider: "anthropic" },
      "Both ANTHROPIC_API_KEY and MISTRAL_API_KEY are set with no SOVRI_DEFAULT_LLM_PROVIDER; " +
        "defaulting to anthropic. Set SOVRI_DEFAULT_LLM_PROVIDER to choose explicitly.",
    );
    return "anthropic";
  }
  if (hasAnthropic) return "anthropic";
  if (hasMistral) return "mistral";

  throw new DeploymentConfigError(
    "No LLM provider is configured for this deployment. Set SOVRI_DEFAULT_LLM_PROVIDER " +
      "(anthropic or mistral) and the matching API key (ANTHROPIC_API_KEY or MISTRAL_API_KEY), " +
      "or add a .sovri.yml to the repository.",
  );
}

function readOptionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function offendingEnvVar(
  issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }>,
): string {
  // Scan for the first `llm.<field>` issue rather than hard-indexing
  // `issues[0].path[1]`, so the operator-facing hint stays accurate if the
  // schema shape under `llm` is ever restructured.
  for (const issue of issues) {
    const [head, field] = issue.path;
    if (head === "llm" && typeof field === "string" && field in OFFENDING_ENV_BY_FIELD) {
      return OFFENDING_ENV_BY_FIELD[field] ?? "a SOVRI_DEFAULT_LLM_* variable";
    }
  }
  return "a SOVRI_DEFAULT_LLM_* variable";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
