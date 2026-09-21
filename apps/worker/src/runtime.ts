import type { SourceIngestionService } from "@memoid/application/source-ingestion";
import type { PostgresSourceIngestionRuntimeRepository } from "@memoid/adapters/source-ingestion";
import {
  enqueueSourceIngestionSignal,
  scheduleSourceIngestionRecovery,
  startSourceIngestionWorker,
  type JobBoss,
  type SourceIngestionSignal,
} from "@memoid/jobs";

interface RuntimeLogger {
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
}

export interface SourceIngestionRuntimeDependencies {
  readonly boss: JobBoss;
  readonly appId: string;
  readonly repository: PostgresSourceIngestionRuntimeRepository;
  readonly service: SourceIngestionService;
  readonly logger: RuntimeLogger;
}

export async function executeSourceIngestionSignal(
  dependencies: SourceIngestionRuntimeDependencies,
  signal: SourceIngestionSignal,
): Promise<void> {
  if (signal.appId !== dependencies.appId) throw new Error("Ingestion signal App ID mismatch");
  const targets = await dependencies.repository.listTargets({
    appId: signal.appId,
    ...(signal.trigger === "GITHUB_WEBHOOK"
      ? {
          installationId: signal.installationId,
          repositoryId: signal.repositoryId,
          refKey: signal.refKey,
        }
      : {}),
  });
  for (const target of targets) {
    await dependencies.service.observe(target.context, {
      sourceId: target.sourceId,
      refKey: target.refKey,
      correlationId: target.correlationId,
    });
    let followUpRequired = true;
    let passes = 0;
    while (followUpRequired && passes < 10) {
      const result = await dependencies.service.processNext(target.context, {
        sourceId: target.sourceId,
        refKey: target.refKey,
      });
      followUpRequired = result.followUpRequired;
      if (!result.processed) break;
      passes += 1;
    }
    if (followUpRequired) {
      await enqueueSourceIngestionSignal(dependencies.boss, {
        kind: "SOURCE_INGESTION_SIGNAL",
        trigger: "RECOVERY_SCAN",
        appId: dependencies.appId,
      });
    }
    dependencies.logger.info(
      {
        sourceId: target.sourceId,
        refKey: target.refKey,
        trigger: signal.trigger,
        passes,
      },
      "source ingestion signal processed",
    );
  }
}

export async function startProductionSourceIngestionRuntime(
  dependencies: SourceIngestionRuntimeDependencies,
): Promise<string> {
  const workerId = await startSourceIngestionWorker(dependencies.boss, (signal) =>
    executeSourceIngestionSignal(dependencies, signal),
  );
  await scheduleSourceIngestionRecovery(dependencies.boss, dependencies.appId);
  await enqueueSourceIngestionSignal(dependencies.boss, {
    kind: "SOURCE_INGESTION_SIGNAL",
    trigger: "RECOVERY_SCAN",
    appId: dependencies.appId,
  });
  return workerId;
}
