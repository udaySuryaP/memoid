import { parseApiConfig } from "@memoid/config";
import { createPostgresReadinessProbe } from "@memoid/db";
import { createBoss, enqueueSourceIngestionSignal } from "@memoid/jobs";
import { buildServer } from "./server.js";
const config = parseApiConfig(process.env);
const databaseReadiness = createPostgresReadinessProbe(
  config.DATABASE_URL,
  config.DATABASE_READINESS_TIMEOUT_MS,
);
const boss = createBoss(config.DATABASE_URL);
await boss.start();
const app = buildServer(config, databaseReadiness.check, {
  enqueue: (signal) => enqueueSourceIngestionSignal(boss, signal),
});
const close = async () => {
  await app.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await databaseReadiness.close();
  process.exitCode = 0;
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
await app.listen({ host: "0.0.0.0", port: config.API_PORT });
