import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { ApiConfig } from "@memoid/config";
import { healthResponseSchema, readinessResponseSchema } from "@memoid/contracts";
import { createCorrelationId, createLogger } from "@memoid/observability";
import {
  PostgresGitHubLifecycleRepository,
  authenticateGitHubLifecycleSignals,
} from "@memoid/adapters/github-source";
export function buildServer(config: ApiConfig, readiness: () => Promise<boolean>): FastifyInstance {
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
    let signals: ReturnType<typeof authenticateGitHubLifecycleSignals>;
    try {
      const header = (name: string): string | null => {
        const value = request.headers[name];
        return typeof value === "string" ? value : null;
      };
      signals = authenticateGitHubLifecycleSignals({
        payload: request.body as Buffer,
        signature: header("x-hub-signature-256"),
        deliveryId: header("x-github-delivery"),
        event: header("x-github-event"),
        expectedAppId: config.GITHUB_APP_ID,
        secrets: [
          Buffer.from(config.GITHUB_WEBHOOK_SECRET, "utf8"),
          ...(config.GITHUB_WEBHOOK_SECRET_PREVIOUS
            ? [Buffer.from(config.GITHUB_WEBHOOK_SECRET_PREVIOUS, "utf8")]
            : []),
        ],
      });
    } catch {
      reply.code(401);
      return { accepted: false };
    }
    try {
      let changed = 0;
      for (const signal of signals) changed += await lifecycleRepository.apply(signal);
      reply.code(202);
      return { accepted: true, changed };
    } catch {
      reply.code(503);
      return { accepted: false };
    }
  });
  app.addHook("onClose", async () => lifecycleRepository?.close());
  return app;
}
