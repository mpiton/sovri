// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";

import { createLogger } from "@sovri/observability";
import { createNodeMiddleware, Probot } from "probot";
import { afterEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { readRepoFile } from "../scaffold/helpers.js";

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
