// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApplicationFunctionOptions } from "probot";

const JSON_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };
const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);
const COMMUNITY_BOT_VERSION = readCommunityBotVersion();
const NODE_MAJOR_VERSION = /^\d+/u;

type NodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | Promise<boolean | void> | void;

export type VersionResponse = {
  readonly node: string;
  readonly version: string;
};

class OperationalRouteError extends Error {
  public override readonly name = "OperationalRouteError";
}

export function registerOperationalRoutes(
  addHandler: ApplicationFunctionOptions["addHandler"],
): void {
  addHandler(handleOperationalRoute);
}

export function buildVersionResponse(
  runtimeNodeVersion: string = process.versions.node,
): VersionResponse {
  const major = runtimeNodeVersion.match(NODE_MAJOR_VERSION)?.[0];
  if (major === undefined) {
    throw new OperationalRouteError("Node.js runtime version must start with a major version");
  }
  return { version: COMMUNITY_BOT_VERSION, node: `${major}.x` };
}

const handleOperationalRoute: NodeHandler = (request, response) => {
  if (request.method !== "GET") {
    return false;
  }

  const pathname = getPathname(request);
  if (pathname === "/health") {
    sendJson(response, { status: "ok" });
    return true;
  }
  if (pathname === "/version") {
    sendJson(response, buildVersionResponse());
    return true;
  }

  return false;
};

function readCommunityBotVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8"));
  if (!isRecord(parsed) || typeof parsed.version !== "string") {
    throw new OperationalRouteError("apps/community-bot/package.json must declare a version");
  }
  return parsed.version;
}

function getPathname(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function sendJson(response: ServerResponse, body: Record<string, string>): void {
  response.writeHead(200, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
