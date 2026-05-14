// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createRequire } from "node:module";
import { pino } from "pino";
import type { Logger as PinoLogger, LoggerOptions } from "pino";

const VALID_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
type LogLevel = (typeof VALID_LEVELS)[number];

const PRETTY_TRUTHY = new Set(["true", "1", "yes", "on"]);

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (VALID_LEVELS as readonly string[]).includes(value);
}

// Treat empty-string env vars as unset. Common in docker-compose and Helm
// where an unset variable expands to "" rather than being absent.
function envOrDefault(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

const localRequire = createRequire(import.meta.url);

// `pino-pretty` is a devDependency (#22 AC8). In a production-pruned install it
// will be absent. Probe before enabling the transport so a misconfigured
// `LOG_PRETTY=true` falls back to JSON instead of crashing the worker.
function isPinoPrettyAvailable(): boolean {
  try {
    localRequire.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the Pino options object from an environment snapshot.
 * Exported for direct unit testing of the option-building logic
 * (transport gating, level validation, base bindings). Not re-exported
 * from the package barrel — the public surface stays `createLogger` only.
 *
 * @internal
 */
export function buildLoggerOptions(env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  const rawLevel = env.LOG_LEVEL?.toLowerCase();
  const level: LogLevel = isLogLevel(rawLevel) ? rawLevel : "info";

  const rawPretty = env.LOG_PRETTY?.toLowerCase() ?? "";
  const nodeEnvRaw = envOrDefault(env.NODE_ENV, "development");
  const isProduction = nodeEnvRaw.toLowerCase() === "production";
  const isPretty = PRETTY_TRUTHY.has(rawPretty) && !isProduction && isPinoPrettyAvailable();

  return {
    level,
    base: {
      service: envOrDefault(env.SERVICE_NAME, "sovri-community-bot"),
      version: envOrDefault(env.SERVICE_VERSION, "0.0.0"),
      env: nodeEnvRaw,
    },
    ...(isPretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  };
}

// TODO(#23): wire pino-redact for secret paths before any handler emits webhook payloads.
const rootLogger = pino(buildLoggerOptions());

export type Logger = PinoLogger;

export function createLogger(name: string): Logger {
  return rootLogger.child({ component: name });
}
