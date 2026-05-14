// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Re-export Zod so every Sovri workspace member binds to a single instance.
export { z } from "zod";

export {
  CategorySchema,
  FindingSchema,
  SeveritySchema,
  type Category,
  type Finding,
  type Severity,
} from "./types/Finding.js";
