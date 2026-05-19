// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  RuntimeEnvironmentError,
  applyRuntimeEnvironmentDefaults,
  readRuntimeEnvironment,
} from "../../src/runtime-env.js";
import { readRepoFile } from "./helpers.js";

describe("community bot Probot bootstrap", () => {
  it("passes the named app registration function to Probot run", () => {
    // Given "apps/community-bot/src/server.ts" imports `run` from "probot"
    const serverSource = readRepoFile("apps/community-bot/src/server.ts");
    expect(serverSource).toContain('import { run } from "probot";');
    // And "apps/community-bot/src/server.ts" imports `app` from "./app.js"
    expect(serverSource).toContain('import { app } from "./app.js";');
    // When the server entry point is inspected
    // Then `run` is called once
    expect(serverSource.match(/\brun\(/gu)).toHaveLength(1);
    // And the only application argument passed to `run` is `app`
    expect(serverSource).toContain("run(app);");
  });

  it("keeps the server entry point as a thin ESM bootstrap", () => {
    // Given "apps/community-bot/src/server.ts" imports the application module with the "./app.js" extension
    const serverSource = readRepoFile("apps/community-bot/src/server.ts");
    expect(serverSource).toContain('"./app.js"');
    // When the server entry point is inspected
    // Then the entry point contains no CommonJS `require`
    expect(serverSource).not.toContain("require(");
    // And the entry point contains no webhook handler registration logic
    expect(serverSource).not.toContain("app.on(");
    // And the entry point contains no GitHub API calls
    expect(serverSource).not.toContain("octokit");
  });

  it("exports the named app registration function", () => {
    // Given "apps/community-bot/src/app.ts" imports the Probot application types from "probot"
    const appSource = readRepoFile("apps/community-bot/src/app.ts");
    expect(appSource).toContain(
      'import type { ApplicationFunctionOptions, Probot } from "probot";',
    );
    // And "apps/community-bot/src/app.ts" exports a function named `app`
    // And `app` accepts Probot plus its application function options
    expect(appSource).toContain(
      "export function app(probot: Probot, options: ApplicationFunctionOptions): void",
    );
    // When the application module is inspected
    // Then `app` returns `void`
    expect(appSource).toContain("): void");
    // And `app` can be passed directly to `run`
    expect(readRepoFile("apps/community-bot/src/server.ts")).toContain("run(app);");
    expect(appSource).not.toContain("export default");
  });

  it("delegates registration to the existing registrar modules", () => {
    // Given "apps/community-bot/src/commands/index.ts" exports `registerCommandHandlers`
    const appSource = readRepoFile("apps/community-bot/src/app.ts");
    expect(readRepoFile("apps/community-bot/src/commands/index.ts")).toContain(
      "export function registerCommandHandlers",
    );
    // And "apps/community-bot/src/github/index.ts" exports `registerGitHubAdapters`
    expect(readRepoFile("apps/community-bot/src/github/index.ts")).toContain(
      "export function registerGitHubAdapters",
    );
    // And "apps/community-bot/src/handlers/index.ts" exports `registerWebhookHandlers`
    expect(readRepoFile("apps/community-bot/src/handlers/index.ts")).toContain(
      "export function registerWebhookHandlers",
    );
    // And "apps/community-bot/src/operational-routes.ts" exports `registerOperationalRoutes`
    expect(readRepoFile("apps/community-bot/src/operational-routes.ts")).toContain(
      "export function registerOperationalRoutes",
    );
    // When the application module is inspected
    // Then `app` calls `registerOperationalRoutes`
    expect(appSource).toContain("registerOperationalRoutes(options.addHandler);");
    // Then `app` calls `registerGitHubAdapters`
    expect(appSource).toContain("registerGitHubAdapters(probot);");
    // And `app` calls `registerCommandHandlers`
    expect(appSource).toContain("registerCommandHandlers(probot);");
    // And `app` calls `registerWebhookHandlers`
    expect(appSource).toContain("registerWebhookHandlers(probot);");
    // And the application module contains no review business logic
    expect(appSource).not.toContain("@sovri/review-engine");
  });

  it.each([1024, 3101, 65535])("reads valid port %i from the environment", (port) => {
    // Given the community bot has been built
    // And `PORT` is "<port>"
    const env = createRuntimeEnv({ PORT: String(port) });
    // When the operator starts the community bot
    const runtimeEnvironment = readRuntimeEnvironment(env);
    // Then Probot receives app id 123456
    expect(runtimeEnvironment.appId).toBe("123456");
    // And Probot receives webhook secret "sovri-dev-webhook-secret"
    expect(runtimeEnvironment.webhookSecret).toBe("sovri-dev-webhook-secret");
    // And the bot listens on port <port>
    expect(runtimeEnvironment.port).toBe(port);
  });

  it("falls back to port 3000 when PORT is omitted", () => {
    // Given the community bot has been built
    const env = createRuntimeEnv();
    // And the configured environment omits "PORT"
    delete env.PORT;
    // When the operator starts the community bot
    const runtimeEnvironment = applyRuntimeEnvironmentDefaults(env);
    // Then Probot receives app id 123456
    expect(runtimeEnvironment.appId).toBe("123456");
    // And Probot receives webhook secret "sovri-dev-webhook-secret"
    expect(runtimeEnvironment.webhookSecret).toBe("sovri-dev-webhook-secret");
    // And the bot listens on port 3000
    expect(runtimeEnvironment.port).toBe(3000);
    expect(env.PORT).toBe("3000");
  });

  it.each(["APP_ID", "PRIVATE_KEY", "WEBHOOK_SECRET"])(
    "rejects missing required GitHub App environment variable %s",
    (variable) => {
      // Given the configured environment omits "<variable>"
      const env = createRuntimeEnv();
      delete env[variable];
      // When the operator starts the community bot
      // Then startup fails before accepting webhook traffic
      expect(() => readRuntimeEnvironment(env)).toThrow(RuntimeEnvironmentError);
      // And the failure mentions "<variable>"
      expect(() => readRuntimeEnvironment(env)).toThrow(variable);
    },
  );

  it("rejects invalid dummy private key material", () => {
    // Given the development environment variable "PRIVATE_KEY" is "not-a-private-key"
    const env = createRuntimeEnv({ PRIVATE_KEY: "not-a-private-key" });
    // When the operator starts the community bot in development mode
    // Then startup fails
    expect(() => readRuntimeEnvironment(env)).toThrow(RuntimeEnvironmentError);
    // And the bot does not accept webhook traffic
    // And the failure mentions "PRIVATE_KEY"
    expect(() => readRuntimeEnvironment(env)).toThrow("PRIVATE_KEY");
  });

  it("accepts escaped private key newlines from environment storage", () => {
    // Given `PRIVATE_KEY` is stored as a single environment value with literal "\n" line breaks
    const privateKey = createPrivateKey();
    const env = createRuntimeEnv({ PRIVATE_KEY: privateKey.replaceAll("\n", "\\n"), PORT: "3101" });
    // And `APP_ID` is "123456"
    // And `WEBHOOK_SECRET` is "sovri-dev-webhook-secret"
    // And `PORT` is "3101"
    // When the operator starts the community bot
    const runtimeEnvironment = applyRuntimeEnvironmentDefaults(env);
    // Then the private key is accepted by Probot
    expect(runtimeEnvironment.privateKey).toBe(privateKey);
    expect(env.PRIVATE_KEY).toBe(privateKey);
    // And the bot listens on port 3101
    expect(runtimeEnvironment.port).toBe(3101);
  });

  it.each(["not-a-port", "-1", "65536"])("rejects invalid port value %s", (port) => {
    // Given `PORT` is "<port>"
    const env = createRuntimeEnv({ PORT: port });
    // When the operator starts the community bot
    // Then startup fails before accepting webhook traffic
    expect(() => readRuntimeEnvironment(env)).toThrow(RuntimeEnvironmentError);
    // And the failure mentions "PORT"
    expect(() => readRuntimeEnvironment(env)).toThrow("PORT");
  });

  it("logs startup through Sovri observability before Probot run", () => {
    // Given the community bot starts with valid development environment values
    const serverSource = readRepoFile("apps/community-bot/src/server.ts");
    // When the server entry point boots
    // Then the first structured log record contains "Sovri community-bot starting"
    expect(serverSource).toContain('logger.info("Sovri community-bot starting");');
    // And the log record is emitted through `@sovri/observability`
    expect(serverSource).toContain('import { createLogger } from "@sovri/observability";');
    // And the log record is emitted before `run(app)` is invoked
    expect(serverSource.indexOf('logger.info("Sovri community-bot starting");')).toBeLessThan(
      serverSource.indexOf("run(app);"),
    );
  });

  it("does not log sensitive environment values during boot", () => {
    // Given the development environment variable "WEBHOOK_SECRET" is "sovri-dev-webhook-secret"
    // And the development environment variable "PRIVATE_KEY" is a disposable RSA private key generated by the test run
    const serverSource = readRepoFile("apps/community-bot/src/server.ts");
    // When the server entry point boots
    // Then no log record contains "sovri-dev-webhook-secret"
    expect(serverSource).not.toContain("sovri-dev-webhook-secret");
    // And no log record contains private key material
    expect(serverSource).not.toContain("PRIVATE_KEY");
  });
});

function createRuntimeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ID: "123456",
    PRIVATE_KEY: createPrivateKey(),
    WEBHOOK_SECRET: "sovri-dev-webhook-secret",
    ...overrides,
  };
}

function createPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ format: "pem", type: "pkcs1" }).toString();
}
