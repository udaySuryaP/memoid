import { z } from "zod";

const environmentSchema = z.enum(["development", "test", "preview", "staging", "production"]);
const base = z.object({
  MEMOID_ENV: environmentSchema,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});
export const webConfigSchema = base.extend({
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  GITHUB_APP_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,39}$/)
    .optional(),
  GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().min(20).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().includes("BEGIN RSA PRIVATE KEY").optional(),
  GITHUB_APP_SLUG: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .refine((value) => !value.startsWith("-") && !value.endsWith("-"))
    .optional(),
  GITHUB_CALLBACK_URL: z.url().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(32).optional(),
  GITHUB_WEBHOOK_SECRET_PREVIOUS: z.string().min(32).optional(),
});
export const apiConfigSchema = base.extend({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().startsWith("postgres"),
  DATABASE_READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
  PROVIDER_DATABASE_URL: z.string().startsWith("postgres").optional(),
  GITHUB_APP_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,39}$/)
    .optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(32).optional(),
  GITHUB_WEBHOOK_SECRET_PREVIOUS: z.string().min(32).optional(),
});
export const workerConfigSchema = base.extend({
  DATABASE_URL: z.string().startsWith("postgres"),
  GITHUB_APP_ID: z.string().regex(/^[1-9][0-9]{0,39}$/),
  GITHUB_APP_PRIVATE_KEY: z.string().includes("BEGIN RSA PRIVATE KEY"),
});
export type WebConfig = z.infer<typeof webConfigSchema>;
export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export const parseWebConfig = (env: NodeJS.ProcessEnv): WebConfig => webConfigSchema.parse(env);
export const parseApiConfig = (env: NodeJS.ProcessEnv): ApiConfig => apiConfigSchema.parse(env);
export const parseWorkerConfig = (env: NodeJS.ProcessEnv): WorkerConfig =>
  workerConfigSchema.parse(env);
