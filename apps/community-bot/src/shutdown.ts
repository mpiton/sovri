// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createLogger, shutdownTelemetry } from "@sovri/observability";

// Graceful-shutdown wiring for the entry path. On SIGTERM/SIGINT the process drains telemetry (so spans
// flush) before exiting. The bot stays a thin adapter: the only telemetry call here is
// shutdownTelemetry() from @sovri/observability — no SDK, exporter, span, or metric is constructed.
// Every collaborator is injectable so the behavior is testable without emitting a real process signal.

type ShutdownTarget = {
  once(signal: NodeJS.Signals, handler: () => void | Promise<void>): unknown;
  exit(code?: number): void;
};

type ShutdownLogger = {
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

export type TelemetryShutdownOptions = {
  readonly target?: ShutdownTarget;
  readonly shutdown?: () => Promise<void>;
  readonly logger?: ShutdownLogger;
};

// The bot drains telemetry on the two POSIX termination signals an orchestrator sends; the set is fixed
// (R-03), not configurable.
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

/**
 * Register a one-shot graceful shutdown on SIGTERM/SIGINT. The first signal drains telemetry and then
 * exits 0; a flush failure is logged and still exits 1 (never hangs the container); any later signal is
 * ignored so a second SIGTERM/SIGINT can not start a second drain. No secret is read or logged here —
 * only the signal name reaches the log line.
 */
export function registerTelemetryShutdown(options: TelemetryShutdownOptions = {}): void {
  const target = options.target ?? process;
  const drain = options.shutdown ?? shutdownTelemetry;
  const logger = options.logger ?? createLogger("community-bot.shutdown");

  let draining = false;
  const handle = async (signal: NodeJS.Signals): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    try {
      await drain();
      logger.info({ signal }, "Telemetry flushed, community-bot shutting down");
      target.exit(0);
    } catch (error) {
      logger.error({ signal, error: errorMessage(error) }, "Telemetry shutdown failed");
      target.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    target.once(signal, () => handle(signal));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
