import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not-ready"]),
  checks: z.record(z.string(), z.boolean()),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
