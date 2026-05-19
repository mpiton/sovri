// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApplicationFunctionOptions } from "probot";

const JSON_HEADERS: Readonly<Record<string, string>> = { "content-type": "application/json" };

type NodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | Promise<boolean | void> | void;

export function registerOperationalRoutes(
  addHandler: ApplicationFunctionOptions["addHandler"],
): void {
  addHandler(handleOperationalRoute);
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

  return false;
};

function getPathname(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function sendJson(response: ServerResponse, body: Record<string, string>): void {
  response.writeHead(200, JSON_HEADERS);
  response.end(JSON.stringify(body));
}
