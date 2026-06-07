// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerOperationalRoutes } from "./operational-routes.js";

// Acceptance test for the bot /metrics HTTP arm (GitHub issue #2429, metrics-endpoint.feature
// R-01,R-02,R-05,R-07,R-08,R-09,R-10). The route is exercised through the public
// registerOperationalRoutes, which hands handleOperationalRoute to addHandler — the test captures it
// there and drives it with stubbed request/response. "@sovri/observability" is an adapter and is
// mocked so the serialized body (telemetry-on) or "" (telemetry-off) is controlled without any OTel;
// "@sovri/core" is never mocked.

const obs = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    logger,
    collectPrometheusText: vi.fn(async (): Promise<string> => ""),
    getPrometheusExporter: vi.fn((): undefined => undefined),
  };
});

vi.mock("@sovri/observability", () => ({
  createLogger: vi.fn(() => obs.logger),
  collectPrometheusText: obs.collectPrometheusText,
  getPrometheusExporter: obs.getPrometheusExporter,
}));

// handleOperationalRoute's exact runtime shape; addHandler receives this single function.
type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | Promise<boolean | void> | void;

type CapturedResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  writeHead: (status: number, headers?: Record<string, string>) => CapturedResponse;
  end: (body?: string) => void;
};

// Minimal IncomingMessage stand-in: handleOperationalRoute reads only .method and .url. The cast is
// justified — constructing a full Node IncomingMessage in a unit test adds no coverage.
const makeRequest = (method: string, url: string): IncomingMessage =>
  ({ method, url }) as unknown as IncomingMessage;

const makeResponse = (): CapturedResponse => {
  const captured: CapturedResponse = {
    writeHead(status, headers) {
      captured.statusCode = status;
      captured.headers = headers;
      return captured;
    },
    end(body) {
      captured.body = body;
    },
  };
  return captured;
};

// Drive the operational route: capture the handler addHandler is given, then invoke it. The captured
// response is cast at the call boundary (justified — CapturedResponse implements the writeHead/end
// surface the handler uses).
const callRoute = async (
  request: IncomingMessage,
  response: CapturedResponse,
): Promise<boolean | void> => {
  let captured: RouteHandler | undefined;
  registerOperationalRoutes((handler: RouteHandler): void => {
    captured = handler;
  });
  if (captured === undefined) {
    throw new Error("registerOperationalRoutes did not register a handler");
  }
  return captured(request, response as unknown as ServerResponse);
};

beforeEach(() => {
  vi.clearAllMocks();
  obs.collectPrometheusText.mockResolvedValue("");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /metrics serves the Prometheus exposition after metrics have been recorded (R-01)", () => {
  // Given telemetry is initialized and a review has recorded the sovri.* instruments
  // When a Prometheus scraper sends GET /metrics
  // Then the status is 200, the content-type is "text/plain; version=0.0.4", the body is the
  //   serialized exposition, and the handler returns true.
  it("returns 200 text/plain;version=0.0.4 with the serialized body and returns true", async () => {
    obs.collectPrometheusText.mockResolvedValueOnce(
      "# HELP sovri_reviews_total\nsovri_reviews_total 1\n",
    );
    const response = makeResponse();

    const handled = await callRoute(makeRequest("GET", "/metrics"), response);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("text/plain; version=0.0.4");
    expect(response.body).toContain("sovri_reviews_total");
  });
});

describe("a non-GET request to /metrics falls through the method guard (R-02)", () => {
  // Given telemetry is initialized
  // When a client sends <method> /metrics
  // Then the handler returns false at the method guard before any pathname branch.
  it.each(["POST", "PUT", "DELETE"])(
    "a %s to /metrics returns false and serves nothing",
    async (method) => {
      const response = makeResponse();

      const handled = await callRoute(makeRequest(method, "/metrics"), response);

      expect(handled).toBe(false);
      expect(response.statusCode).toBeUndefined();
      expect(obs.collectPrometheusText).not.toHaveBeenCalled();
    },
  );
});

describe("with telemetry off GET /metrics returns 200 with an empty-but-valid body, never 503 (R-05)", () => {
  // Given OTEL_EXPORTER_OTLP_ENDPOINT is unset so no exporter is registered (serializer yields "")
  // When a Prometheus scraper sends GET /metrics
  // Then the status is 200 (never 503), the content-type is "text/plain; version=0.0.4", and the body
  //   is empty-but-valid.
  it("returns 200 with an empty body and the prometheus content-type", async () => {
    obs.collectPrometheusText.mockResolvedValueOnce("");
    const response = makeResponse();

    const handled = await callRoute(makeRequest("GET", "/metrics"), response);

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.statusCode).not.toBe(503);
    expect(response.headers?.["content-type"]).toBe("text/plain; version=0.0.4");
    expect(response.body).toBe("");
  });
});

describe("adding /metrics leaves /health and /version unchanged and preserves the boolean contract (R-07)", () => {
  // When GET /health, GET /version, and an unknown path GET /nope are each handled
  // Then /health returns 200 { status: "ok" }, /version returns 200 { version, node }, and the unknown
  //   path makes the handler return false (it falls through).
  it("serves /health and /version and falls through on an unknown path", async () => {
    const health = makeResponse();
    expect(await callRoute(makeRequest("GET", "/health"), health)).toBe(true);
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body ?? "{}")).toEqual({ status: "ok" });

    const version = makeResponse();
    expect(await callRoute(makeRequest("GET", "/version"), version)).toBe(true);
    expect(version.statusCode).toBe(200);
    const versionBody: unknown = JSON.parse(version.body ?? "{}");
    expect(versionBody).toHaveProperty("version");
    expect(versionBody).toHaveProperty("node");

    const unknown = makeResponse();
    expect(await callRoute(makeRequest("GET", "/nope"), unknown)).toBe(false);
  });
});

describe("the endpoint logs only metadata, never the body or a secret (R-09)", () => {
  // Given the route obtains its logger via createLogger from "@sovri/observability"
  // When the /metrics scrape is served and the endpoint logs the scrape
  // Then no log line carries the serialized body, a token, or an LLM key (metadata only).
  it("never logs the serialized exposition body or a secret substring", async () => {
    const bodyWithSecret = 'sovri_reviews_total{token="ghs_LEAK_9Z"} 1';
    obs.collectPrometheusText.mockResolvedValueOnce(bodyWithSecret);
    const response = makeResponse();

    await callRoute(makeRequest("GET", "/metrics"), response);

    const logged = JSON.stringify([
      obs.logger.info.mock.calls,
      obs.logger.warn.mock.calls,
      obs.logger.error.mock.calls,
      obs.logger.debug.mock.calls,
    ]);
    expect(logged.includes(bodyWithSecret)).toBe(false);
    expect(logged.includes("ghs_LEAK_9Z")).toBe(false);
  });
});

describe("the bot holds only a thin HTTP adapter — all aggregation lives in observability (R-08, R-10)", () => {
  const routeSource = readFileSync(
    fileURLToPath(new URL("./operational-routes.ts", import.meta.url)),
    "utf8",
  );

  // Then the meter provider, exporter, and serialization live in "@sovri/observability"; the bot only
  //   adds the /metrics branch and a sendText helper and aggregates/stores nothing.
  it("imports serialization from @sovri/observability and constructs no meter, exporter, or instrument", () => {
    expect(routeSource).toMatch(/from\s+["']@sovri\/observability["']/u);
    expect(routeSource).toMatch(/collectPrometheusText/u);
    expect(routeSource).toMatch(/sendText/u);
    expect(routeSource).not.toMatch(/new\s+MeterProvider/u);
    expect(routeSource).not.toMatch(/PrometheusExporter/u);
    expect(routeSource).not.toMatch(/createCounter|createHistogram/u);
  });

  // And the source carries the two-line SPDX header and no escape hatches (R-10).
  it("carries the SPDX header and contains no @ts-ignore / @ts-expect-error / oxlint-disable", () => {
    expect(
      routeSource.startsWith("// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sovri SAS"),
    ).toBe(true);
    for (const forbidden of ["@ts-ignore", "@ts-expect-error", "oxlint-disable"]) {
      expect(routeSource.includes(forbidden), `must not contain ${forbidden}`).toBe(false);
    }
  });
});
