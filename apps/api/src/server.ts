import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { ApiConfig } from "@memoid/config";
import { healthResponseSchema, readinessResponseSchema } from "@memoid/contracts";
import { createCorrelationId, createLogger } from "@memoid/observability";
export function buildServer(
  config: ApiConfig,
  readiness: () => Promise<boolean> = async () => true,
): FastifyInstance {
  const app = Fastify({
    loggerInstance: createLogger("memoid-api", config.LOG_LEVEL) as FastifyBaseLogger,
    genReqId: createCorrelationId,
  });
  app.get("/health", async () =>
    healthResponseSchema.parse({ status: "ok", service: "api", version: "0.0.0-foundation" }),
  );
  app.get("/ready", async (_request, reply) => {
    const database = await readiness();
    if (!database) reply.code(503);
    return readinessResponseSchema.parse({
      status: database ? "ready" : "not-ready",
      checks: { database },
    });
  });
  return app;
}
