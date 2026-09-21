import {
  GitHubSourceIngestionAdapter,
  PostgresSourceIngestionRepository,
  PostgresSourceIngestionRuntimeRepository,
} from "@memoid/adapters/source-ingestion";
import { SourceIngestionService } from "@memoid/application/source-ingestion";
import { parseWorkerConfig } from "@memoid/config";
import { createBoss, startSyntheticWorker } from "@memoid/jobs";
import { createLogger } from "@memoid/observability";
import { startProductionSourceIngestionRuntime } from "./runtime.js";
const config = parseWorkerConfig(process.env);
const logger = createLogger("memoid-worker", config.LOG_LEVEL);
const boss = createBoss(config.DATABASE_URL);
await boss.start();
await startSyntheticWorker(boss, async (payload) => {
  logger.info({ jobKind: payload.kind }, "synthetic foundation job consumed");
});
const ingestionRepository = new PostgresSourceIngestionRepository(config.DATABASE_URL);
const ingestionRuntimeRepository = new PostgresSourceIngestionRuntimeRepository(
  config.DATABASE_URL,
);
const ingestionService = new SourceIngestionService(
  ingestionRepository,
  new GitHubSourceIngestionAdapter({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/gu, "\n"),
  }),
);
await startProductionSourceIngestionRuntime({
  boss,
  appId: config.GITHUB_APP_ID,
  repository: ingestionRuntimeRepository,
  service: ingestionService,
  logger,
});
const close = async () => {
  logger.info("worker shutting down");
  await ingestionRepository.close();
  await ingestionRuntimeRepository.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exitCode = 0;
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
logger.info("worker foundation ready");
