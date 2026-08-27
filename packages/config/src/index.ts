import { z } from "zod";

const environmentSchema = z.enum(["development", "test", "preview", "staging", "production"]);
const base = z.object({
  MEMOID_ENV: environmentSchema,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});
export const webConfigSchema = base.extend({
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});
export const apiConfigSchema = base.extend({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().startsWith("postgres"),
});
export const workerConfigSchema = base.extend({ DATABASE_URL: z.string().startsWith("postgres") });
export type WebConfig = z.infer<typeof webConfigSchema>;
export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export const parseWebConfig = (env: NodeJS.ProcessEnv): WebConfig => webConfigSchema.parse(env);
export const parseApiConfig = (env: NodeJS.ProcessEnv): ApiConfig => apiConfigSchema.parse(env);
export const parseWorkerConfig = (env: NodeJS.ProcessEnv): WorkerConfig =>
  workerConfigSchema.parse(env);
