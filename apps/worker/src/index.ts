import { parseWorkerConfig } from "@memoid/config";
import { createBoss, startSyntheticWorker } from "@memoid/jobs";
import { createLogger } from "@memoid/observability";
const config = parseWorkerConfig(process.env);
const logger = createLogger("memoid-worker", config.LOG_LEVEL);
const boss = createBoss(config.DATABASE_URL);
await boss.start();
await startSyntheticWorker(boss, async (payload) => {
  logger.info({ jobKind: payload.kind }, "synthetic foundation job consumed");
});
const close = async () => {
  logger.info("worker shutting down");
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exitCode = 0;
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
logger.info("worker foundation ready");
