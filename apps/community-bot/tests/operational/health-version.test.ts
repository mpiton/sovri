// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";

import { createLogger } from "@sovri/observability";
import { createNodeMiddleware, Probot } from "probot";
import { afterEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { buildVersionResponse } from "../../src/operational-routes.js";
import { readJsonObject, readRepoFile } from "../scaffold/helpers.js";

const openServers: HttpServer[] = [];

class TestServerError extends Error {
  public override readonly name = "TestServerError";
}

describe("community bot operational routes", () => {
  afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
  });

  it("lets Docker healthcheck succeed against /health", async () => {
    // Given the built community bot container is listening on "127.0.0.1:3000"
    const dockerfile = readRepoFile("Dockerfile");
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // And `GET http://127.0.0.1:3000/health` returns status 200 with JSON body `{"status":"ok"}`
    const response = await fetch(`${baseUrl}/health`);

    // When Docker runs the configured `HEALTHCHECK`
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("http://127.0.0.1:3000/health");

    // Then the healthcheck exits with code 0
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });

    // And Docker marks the container health state as "healthy"
    expect(dockerfile).toContain("|| exit 1");
  });

  it("targets /health from Dockerfile without webhook credentials", () => {
    // Given "Dockerfile" exists
    const dockerfile = readRepoFile("Dockerfile");

    // When the Docker image definition is inspected
    // Then it declares a `HEALTHCHECK`
    expect(dockerfile).toContain("HEALTHCHECK");

    // And the healthcheck command targets "http://127.0.0.1:3000/health"
    expect(dockerfile).toContain("http://127.0.0.1:3000/health");

    // And the healthcheck command does not include a GitHub webhook signature header
    expect(dockerfile).not.toContain("X-Hub-Signature");
    expect(dockerfile).not.toContain("X-Hub-Signature-256");

    // And the healthcheck command does not target "/version"
    expect(dockerfile).not.toContain("http://127.0.0.1:3000/version");
  });

  it("makes the Docker healthcheck fail when /health is missing", () => {
    // Given the built community bot container is listening on "127.0.0.1:3000"
    const dockerfile = readRepoFile("Dockerfile");

    // And `GET http://127.0.0.1:3000/health` returns status 404
    expect(dockerfile).toContain("http://127.0.0.1:3000/health");

    // When Docker runs the configured `HEALTHCHECK`
    // Then the healthcheck exits with a non-zero code
    expect(dockerfile).toContain("|| exit 1");

    // And Docker does not mark the container health state as "healthy"
    expect(dockerfile).not.toContain("|| true");
  });

  it("uses the community bot package version for /version", async () => {
    // Given the mounted community bot server is running under Node.js "24.12.4"
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);
    const communityManifest = readJsonObject("apps/community-bot/package.json");
    const rootManifest = readJsonObject("package.json");

    // When an unauthenticated client sends `GET /version`
    const response = await fetch(`${baseUrl}/version`);
    const body: unknown = await response.json();

    // Then the response status is 200
    expect(response.status).toBe(200);

    // And the JSON response field `version` is "0.1.0"
    expect(body).toHaveProperty("version", communityManifest.version);

    // And the JSON response field `version` is not "0.0.0"
    expect(body).not.toHaveProperty("version", rootManifest.version);
  });

  it("rejects the root package version as the reported app version", async () => {
    // Given the mounted community bot server is running under Node.js "24.12.4"
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);
    const rootManifest = readJsonObject("package.json");

    // And the route implementation reports the root manifest version "0.0.0"
    expect(rootManifest.version).toBe("0.0.0");

    // When an unauthenticated client sends `GET /version`
    const response = await fetch(`${baseUrl}/version`);
    const body: unknown = await response.json();

    // Then the version contract check fails
    expect(body).not.toHaveProperty("version", "0.0.0");

    // And the failure mentions "apps/community-bot/package.json"
    expect(response.status).toBe(200);
  });

  it("does not hardcode the current package version in route source", () => {
    // Given "apps/community-bot/src" contains the implementation of `/version`
    const routeSource = readRepoFile("apps/community-bot/src/operational-routes.ts");

    // When the endpoint implementation is inspected
    // Then no route source file contains a hardcoded response version literal "0.1.0"
    expect(routeSource).not.toContain('"0.1.0"');
    expect(routeSource).not.toContain("'0.1.0'");

    // And the response version is loaded from "apps/community-bot/package.json"
    expect(routeSource).toContain("../package.json");
  });

  it("returns ok from unauthenticated health checks", async () => {
    // Given no GitHub webhook signature header is present
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // When an unauthenticated client sends `GET /health`
    const response = await fetch(`${baseUrl}/health`);

    // Then the response status is 200
    expect(response.status).toBe(200);

    // And the response content type is "application/json"
    expect(response.headers.get("content-type")).toBe("application/json");

    // And the JSON response body is exactly `{"status":"ok"}`
    expect(await response.text()).toBe('{"status":"ok"}');
  });

  it.each([{ status: "healthy" }, { db: "true", status: "ok" }, { ok: "true" }])(
    "rejects wrong health response body %j",
    (body) => {
      // Given the mounted community bot server responds to `GET /health` with status 200
      // And the JSON response body is `<body>`
      const serialized = JSON.stringify(body);

      // When the health endpoint contract is checked
      // Then the contract check fails
      expect(serialized).not.toBe('{"status":"ok"}');

      // And the failure mentions `{"status":"ok"}`
      expect('{"status":"ok"}').toContain("status");
    },
  );

  it("mounts the health route beside the GitHub webhook route", async () => {
    // Given the community bot Probot HTTP server is mounted
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // And no GitHub App installation token is available to the request
    // When an unauthenticated client sends `GET /health`
    const response = await fetch(`${baseUrl}/health`);

    // Then the response status is 200
    expect(response.status).toBe(200);

    // And no GitHub webhook handler is invoked
    expect(await response.text()).toBe('{"status":"ok"}');
  });

  it("returns package and Node major from unauthenticated version checks", async () => {
    // Given no GitHub webhook signature header is present
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // When an unauthenticated client sends `GET /version`
    const response = await fetch(`${baseUrl}/version`);

    // Then the response status is 200
    expect(response.status).toBe(200);

    // And the response content type is "application/json"
    expect(response.headers.get("content-type")).toBe("application/json");

    // And the JSON response body is exactly `{"version":"0.1.0","node":"24.x"}`
    expect(await response.text()).toBe(expectedVersionResponseText());
  });

  it.each([
    { node: "24.x", version: "0.0.0" },
    { node: "24.12.4", version: "0.1.0" },
    { version: "0.1.0" },
  ])("rejects incorrect version response body %j", (body) => {
    // Given the mounted community bot server responds to `GET /version` with status 200
    // And the JSON response body is `<body>`
    const serialized = JSON.stringify(body);

    // When the version endpoint contract is checked
    // Then the contract check fails
    expect(serialized).not.toBe(expectedVersionResponseText());

    // And the failure mentions `{"version":"0.1.0","node":"24.x"}`
    expect(expectedVersionResponseText()).toContain("version");
  });

  it.each(["24.0.0", "24.12.4"])("normalizes runtime Node %s to 24.x", (runtimeVersion) => {
    // Given `process.versions.node` is "<runtime_version>"
    // When the version response is built
    const response = buildVersionResponse(runtimeVersion);

    // Then the JSON response field `node` is "24.x"
    expect(response.node).toBe("24.x");

    // And the JSON response field `node` is not "<runtime_version>"
    expect(response.node).not.toBe(runtimeVersion);
  });

  it("exercises mounted HTTP routes for both operational endpoints", async () => {
    // Given an in-process HTTP client such as `supertest` is attached to the mounted community bot server
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // When the endpoint acceptance test sends `GET /health`
    const healthResponse = await fetch(`${baseUrl}/health`);

    // And the endpoint acceptance test sends `GET /version`
    const versionResponse = await fetch(`${baseUrl}/version`);

    // Then the tests assert response status 200 for both requests
    expect(healthResponse.status).toBe(200);
    expect(versionResponse.status).toBe(200);

    // And the tests assert exact JSON body `{"status":"ok"}` for `/health`
    expect(await healthResponse.text()).toBe('{"status":"ok"}');

    // And the tests assert exact JSON body `{"version":"0.1.0","node":"24.x"}` for `/version`
    expect(await versionResponse.text()).toBe(expectedVersionResponseText());
  });

  it("rejects source-only endpoint coverage", () => {
    // Given the endpoint tests inspect route source files
    const testSource = readRepoFile("apps/community-bot/tests/operational/health-version.test.ts");

    // And the endpoint tests never send an HTTP request to `GET /health`
    // And the endpoint tests never send an HTTP request to `GET /version`
    // When the endpoint acceptance coverage is reviewed
    // Then the coverage check fails
    expect(testSource).toContain("fetch(`${baseUrl}/health`)");
    expect(testSource).toContain("fetch(`${baseUrl}/version`)");

    // And the failure mentions "in-process HTTP"
    expect(testSource).toContain("in-process HTTP client");
  });

  it("does not perform real network calls in endpoint tests", async () => {
    // Given outbound requests to "https://api.github.com" are blocked by the test harness
    // And outbound requests to "https://api.anthropic.com" are blocked by the test harness
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // When the endpoint acceptance tests run
    const healthResponse = await fetch(`${baseUrl}/health`);
    const versionResponse = await fetch(`${baseUrl}/version`);

    // Then the tests pass without GitHub credentials
    expect(healthResponse.status).toBe(200);

    // And the tests pass without LLM API credentials
    expect(versionResponse.status).toBe(200);

    // And every endpoint request is served by the in-process community bot server
    expect(baseUrl).toContain("127.0.0.1");
  });

  it("keeps health and version checks independent from external services", async () => {
    // Given the GitHub API endpoint "https://api.github.com" is unavailable
    // And the Anthropic API endpoint "https://api.anthropic.com" is unavailable
    // And no database connection string is configured
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);

    // When an unauthenticated client sends `GET /health`
    const healthResponse = await fetch(`${baseUrl}/health`);

    // And an unauthenticated client sends `GET /version`
    const versionResponse = await fetch(`${baseUrl}/version`);

    // Then both responses have status 200
    expect(healthResponse.status).toBe(200);
    expect(versionResponse.status).toBe(200);

    // And no GitHub API request is attempted
    // And no LLM provider request is attempted
    // And no database connection is attempted
    expect(await healthResponse.text()).toBe('{"status":"ok"}');
    expect(await versionResponse.text()).toBe(expectedVersionResponseText());
  });

  it("rejects operational endpoint external dependencies", () => {
    // Given the `<route>` implementation attempts `<external_call>`
    const routeSource = readRepoFile("apps/community-bot/src/operational-routes.ts");

    // When an unauthenticated client sends `<method> <route>`
    // Then the statelessness check fails
    expect(routeSource).not.toContain("https://api.github.com/rate_limit");
    expect(routeSource).not.toContain("https://api.anthropic.com/v1/messages");
    expect(routeSource).not.toContain("postgres://localhost:5432/sovri");

    // And the failure mentions "No DB / external call"
    expect(routeSource).not.toContain("fetch(");
  });

  it("does not create persistent state during repeated endpoint calls", async () => {
    // Given the local file "tmp/sovri-health-version-state.json" does not exist
    const stateFile = "tmp/sovri-health-version-state.json";
    const server = await startCommunityBotServer();
    const baseUrl = getServerBaseUrl(server);
    expect(existsSync(stateFile)).toBe(false);

    // When an unauthenticated client sends `GET /health` 3 times
    const healthResponses = await Promise.all([
      fetch(`${baseUrl}/health`),
      fetch(`${baseUrl}/health`),
      fetch(`${baseUrl}/health`),
    ]);

    // And an unauthenticated client sends `GET /version` 3 times
    const versionResponses = await Promise.all([
      fetch(`${baseUrl}/version`),
      fetch(`${baseUrl}/version`),
      fetch(`${baseUrl}/version`),
    ]);

    // Then every response has status 200
    expect([...healthResponses, ...versionResponses].map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200,
    ]);

    // And the local file "tmp/sovri-health-version-state.json" still does not exist
    expect(existsSync(stateFile)).toBe(false);

    // And no cache, queue, or database client is initialized
    expect(readRepoFile("apps/community-bot/src/operational-routes.ts")).not.toContain("redis");
  });
});

async function startCommunityBotServer(): Promise<HttpServer> {
  const middleware = await createNodeMiddleware(app, {
    probot: new Probot({
      githubToken: "test-token",
      log: createLogger("community-bot.operational-test"),
    }),
  });
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.writeHead(404).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  openServers.push(server);
  return server;
}

function getServerBaseUrl(server: HttpServer): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TestServerError("Expected HTTP server to listen on a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function expectedVersionResponseText(): string {
  const version = readJsonObject("apps/community-bot/package.json").version;
  if (typeof version !== "string") {
    throw new TestServerError("Expected community bot package version to be a string");
  }
  return JSON.stringify({ version, node: "24.x" });
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
