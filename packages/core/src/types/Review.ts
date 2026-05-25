// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "zod";

import { FindingSchema } from "./Finding.js";

const TokensUsedSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

const CommitShaPattern = /^[a-f0-9]{40}$/;
const RepositoryFullNamePattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

export const ReviewSchema = z
  .object({
    id: z.uuid(),
    pr_number: z.number().int().positive(),
    repo_full_name: z.string().regex(RepositoryFullNamePattern),
    commit_sha: z.string().regex(CommitShaPattern),
    started_at: z.date(),
    completed_at: z.date(),
    llm_provider: z.string(),
    llm_model: z.string(),
    tokens_used: TokensUsedSchema,
    token_usage_reported: z.boolean().optional(),
    summary: z.string(),
    findings: z.array(FindingSchema),
    walkthrough_markdown: z.string(),
    status: z.enum(["success", "partial", "failed"]),
    error: z.string().optional(),
  })
  .superRefine((review, context) => {
    if (review.started_at.getTime() > review.completed_at.getTime()) {
      context.addIssue({
        code: "custom",
        path: ["started_at"],
        message: "started_at must be before or equal to completed_at",
      });
    }
  });

export type Review = z.infer<typeof ReviewSchema>;
