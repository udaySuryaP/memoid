import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { ApiConfig } from "@memoid/config";
import { healthResponseSchema, readinessResponseSchema } from "@memoid/contracts";
import { createCorrelationId, createLogger } from "@memoid/observability";
import {
  PostgresGitHubLifecycleRepository,
  authenticateGitHubLifecycleSignals,
  authenticateGitHubSourceChangeSignal,
} from "@memoid/adapters/github-source";
import type { SourceIngestionSignal } from "@memoid/jobs";

export interface SourceIngestionSignalDispatcher {
  enqueue(signal: SourceIngestionSignal): Promise<string | null>;
}

export function buildServer(
  config: ApiConfig,
  readiness: () => Promise<boolean>,
  ingestionSignals?: SourceIngestionSignalDispatcher,
): FastifyInstance {
  const app = Fastify({
    loggerInstance: createLogger("memoid-api", config.LOG_LEVEL) as FastifyBaseLogger,
    genReqId: createCorrelationId,
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: 1_048_576 },
    (_request, body, done) => done(null, body),
  );
  app.get("/health", async () =>
    healthResponseSchema.parse({ status: "ok", service: "api", version: "0.0.0-foundation" }),
  );
  app.get("/ready", async (_request, reply) => {
    let database: boolean;
    try {
      database = await readiness();
    } catch {
      database = false;
    }
    if (!database) reply.code(503);
    return readinessResponseSchema.parse({
      status: database ? "ready" : "not-ready",
      checks: { database },
    });
  });
  const lifecycleRepository = config.PROVIDER_DATABASE_URL
    ? new PostgresGitHubLifecycleRepository(config.PROVIDER_DATABASE_URL)
    : null;
  app.post("/webhooks/github", async (request, reply) => {
    if (!lifecycleRepository || !config.GITHUB_WEBHOOK_SECRET || !config.GITHUB_APP_ID) {
      reply.code(503);
      return { accepted: false };
    }
    const header = (name: string): string | null => {
      const value = request.headers[name];
      return typeof value === "string" ? value : null;
    };
    try {
      const event = header("x-github-event");
      if (event === "push") {
        if (!ingestionSignals) {
          reply.code(503);
          return { accepted: false };
        }
        const signal = authenticateGitHubSourceChangeSignal({
          payload: request.body as Buffer,
          signature: header("x-hub-signature-256"),
          deliveryId: header("x-github-delivery"),
          event,
          expectedAppId: config.GITHUB_APP_ID,
          secrets: [
            Buffer.from(config.GITHUB_WEBHOOK_SECRET, "utf8"),
            ...(config.GITHUB_WEBHOOK_SECRET_PREVIOUS
              ? [Buffer.from(config.GITHUB_WEBHOOK_SECRET_PREVIOUS, "utf8")]
              : []),
          ],
        });
        const jobId = await ingestionSignals.enqueue({
          kind: "SOURCE_INGESTION_SIGNAL",
          trigger: "GITHUB_WEBHOOK",
          ...signal,
        });
        reply.code(202);
        return { accepted: true, changed: jobId ? 1 : 0 };
      }
      const signals = authenticateGitHubLifecycleSignals({
        payload: request.body as Buffer,
        signature: header("x-hub-signature-256"),
        deliveryId: header("x-github-delivery"),
        event,
        expectedAppId: config.GITHUB_APP_ID,
        secrets: [
          Buffer.from(config.GITHUB_WEBHOOK_SECRET, "utf8"),
          ...(config.GITHUB_WEBHOOK_SECRET_PREVIOUS
            ? [Buffer.from(config.GITHUB_WEBHOOK_SECRET_PREVIOUS, "utf8")]
            : []),
        ],
      });
      let changed = 0;
      for (const signal of signals) changed += await lifecycleRepository.apply(signal);
      reply.code(202);
      return { accepted: true, changed };
    } catch (error) {
      reply.code(error instanceof Error && error.message.includes("GitHub webhook") ? 401 : 503);
      return { accepted: false };
    }
  });
  app.addHook("onClose", async () => lifecycleRepository?.close());
  return app;
}
