import { z } from "zod";

// One source of truth for the page and the function.

export const ENVIRONMENTS = [
  "auto",
  "linux",
  "macos",
  "windows",
  "python",
  "node",
  "docker",
  "git",
  "wordpress",
  "other",
] as const;

import { LIMITS } from "./limits.ts";
export { LIMITS };

export const ModeSchema = z.enum(["explain", "digest"]);
export type Mode = z.infer<typeof ModeSchema>;

export const RequestSchema = z.object({
  mode: ModeSchema,
  input: z.string().trim().min(1, "input is empty"),
  environment: z.enum(ENVIRONMENTS).default("auto"),
  context: z.string().max(LIMITS.context, `context must be ${LIMITS.context} characters or fewer`).optional(),
});
export type AnalyseRequest = z.infer<typeof RequestSchema>;

const Confidence = z.enum(["high", "medium", "low"]);

// Response schemas are kept free of length limits so they can double as the
// model's structured-output schema; the prompts carry the size rules.
export const ExplainResponseSchema = z.object({
  summary: z.string(),
  meaning: z.string(),
  causes: z.array(z.string()),
  fix_steps: z.array(
    z.object({
      step: z.string(),
      command: z.string().nullable(),
      dangerous: z.boolean(),
    }),
  ),
  verify: z.string(),
  confidence: Confidence,
  detected_environment: z.string(),
});
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

export const DigestResponseSchema = z.object({
  verdict: z.enum(["healthy", "warnings", "errors"]),
  overview: z.string(),
  issues: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      count: z.number().int(),
      first_seen: z.string().nullable(),
      sample: z.string(),
    }),
  ),
  root_cause: z.string(),
  next_steps: z.array(z.string()),
  confidence: Confidence,
});
export type DigestResponse = z.infer<typeof DigestResponseSchema>;

export const ResponseSchemas = {
  explain: ExplainResponseSchema,
  digest: DigestResponseSchema,
} as const;

export type ErrorBody =
  | { error: "invalid_request"; message: string }
  | { error: "too_large"; limit: number }
  | { error: "upstream_failed" }
  | { error: "timeout" };
