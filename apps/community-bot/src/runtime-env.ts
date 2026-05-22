// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createPrivateKey } from "node:crypto";

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
