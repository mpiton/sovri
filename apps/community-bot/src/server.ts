// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { run } from "probot";

import { createLogger } from "@sovri/observability";

import { app } from "./app.js";
import { applyRuntimeEnvironmentDefaults } from "./runtime-env.js";

const logger = createLogger("community-bot.server");

logger.info("Sovri community-bot starting");
applyRuntimeEnvironmentDefaults();

run(app);
