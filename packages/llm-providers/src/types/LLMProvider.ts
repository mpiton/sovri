// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly maxTokens: number;
  generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;
  generateStructuredWithUsage?<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>>;
}

export interface GenerateStructuredParams<T> {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schema: z.ZodType<T>;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
}

export interface StructuredGeneration<T> {
  readonly data: T;
  readonly tokenUsage: TokenUsage;
}
