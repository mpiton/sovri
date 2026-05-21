// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { setupServer } from "msw/node";

import { handlers } from "./handlers.js";

export type UnhandledRequest = {
  readonly method: string;
  readonly url: string;
};

let unhandledRequests: UnhandledRequest[] = [];

export const server = setupServer(...handlers);

export function failOnUnhandledRequest(request: Request): void {
  unhandledRequests.push({ method: request.method, url: request.url });
  throw new Error(`Unhandled request: ${request.method} ${request.url}`);
}

export function getUnhandledRequests(): readonly UnhandledRequest[] {
  return unhandledRequests;
}

export function resetUnhandledRequests(): void {
  unhandledRequests = [];
}
