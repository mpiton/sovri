// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import "./instrumentation.js";

import { run } from "probot";

import { createLogger } from "@sovri/observability";

import { app } from "./app.js";
import { applyRuntimeEnvironmentDefaults } from "./runtime-env.js";
import { registerTelemetryShutdown } from "./shutdown.js";

const logger = createLogger("community-bot.server");

logger.info("Sovri community-bot starting");
applyRuntimeEnvironmentDefaults();
registerTelemetryShutdown();

run(app);
