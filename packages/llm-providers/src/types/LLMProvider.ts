// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

export interface LLMProvider {
  readonly name: string;
  readonly maxTokens: number;
  generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;
}

export interface GenerateStructuredParams<T> {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schema: z.ZodType<T>;
  readonly temperature?: number;
  readonly maxTokens?: number;
}
