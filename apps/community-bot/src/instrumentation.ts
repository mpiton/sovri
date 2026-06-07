// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { initTelemetry } from "@sovri/observability";

// Import-side-effect-only bootstrap. Starting the OpenTelemetry SDK before any other module loads is
// the entire job of this file (ARCHI §5.3): server.ts imports it as its first statement so the SDK is
// live before the instrumented HTTP/Octokit/framework stack is evaluated. initTelemetry() reads only
// the OTEL_* env vars and is a complete no-op when no OTLP endpoint is configured, so importing this
// module is always safe. It is idempotent — reaching it twice (the explicit import plus node --require)
// starts at most one SDK.
initTelemetry();
