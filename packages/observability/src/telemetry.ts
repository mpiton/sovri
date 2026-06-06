// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// RED scaffold (GitHub issue #2401). Signatures only — green-cycle implements the
// OTel NodeSDK init/shutdown lifecycle (ARCHI §10.2.1, docs/adr/019). The bodies are
// intentionally unimplemented so the acceptance test in telemetry.test.ts fails for the
// right reason (no SDK constructed, no drain) rather than a missing-module compile error.

export function initTelemetry(): void {
  // Unimplemented: green-cycle constructs and starts the NodeSDK when an OTLP endpoint is set.
  return;
}

export function shutdownTelemetry(): Promise<void> {
  // Unimplemented: green-cycle drains the started NodeSDK and clears the handle.
  return Promise.resolve();
}
