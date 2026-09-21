import { PgBoss, type Job } from "pg-boss";

export type JobBoss = PgBoss;

export const syntheticFoundationQueue = "foundation.synthetic";
export const sourceIngestionQueue = "source.ingestion";

export type SourceIngestionSignal =
  | {
      readonly kind: "SOURCE_INGESTION_SIGNAL";
      readonly trigger: "GITHUB_WEBHOOK";
      readonly appId: string;
      readonly installationId: string;
      readonly repositoryId: string;
      readonly refKey: string;
      readonly deliveryId: string;
    }
  | {
      readonly kind: "SOURCE_INGESTION_SIGNAL";
      readonly trigger: "RECOVERY_SCAN";
      readonly appId: string;
    };

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString, schema: "pgboss" });
}
export async function startSyntheticWorker(
  boss: PgBoss,
  onPayload: (payload: Readonly<Record<string, unknown>>) => Promise<void>,
): Promise<string> {
  await boss.createQueue(syntheticFoundationQueue, { retryLimit: 2, retryDelay: 1 });
  return boss.work<Record<string, unknown>>(
    syntheticFoundationQueue,
    async (jobs: Job<Record<string, unknown>>[]) => {
      for (const job of jobs) await onPayload(job.data as Readonly<Record<string, unknown>>);
    },
  );
}
export async function enqueueSyntheticJob(
  boss: PgBoss,
  payload: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  return boss.send(syntheticFoundationQueue, payload, { retryLimit: 2, retryDelay: 1 });
}

function sourceIngestionSignal(value: Readonly<Record<string, unknown>>): SourceIngestionSignal {
  if (value.kind !== "SOURCE_INGESTION_SIGNAL") throw new Error("Invalid ingestion job kind");
  if (value.trigger === "RECOVERY_SCAN" && typeof value.appId === "string") {
    return { kind: value.kind, trigger: value.trigger, appId: value.appId };
  }
  if (
    value.trigger === "GITHUB_WEBHOOK" &&
    typeof value.appId === "string" &&
    typeof value.installationId === "string" &&
    typeof value.repositoryId === "string" &&
    typeof value.refKey === "string" &&
    typeof value.deliveryId === "string"
  ) {
    return {
      kind: value.kind,
      trigger: value.trigger,
      appId: value.appId,
      installationId: value.installationId,
      repositoryId: value.repositoryId,
      refKey: value.refKey,
      deliveryId: value.deliveryId,
    };
  }
  throw new Error("Invalid ingestion signal payload");
}

export async function startSourceIngestionWorker(
  boss: PgBoss,
  onSignal: (signal: SourceIngestionSignal) => Promise<void>,
): Promise<string> {
  await boss.createQueue(sourceIngestionQueue, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
  });
  return boss.work<Record<string, unknown>>(
    sourceIngestionQueue,
    async (jobs: Job<Record<string, unknown>>[]) => {
      for (const job of jobs) await onSignal(sourceIngestionSignal(job.data));
    },
  );
}

export async function enqueueSourceIngestionSignal(
  boss: PgBoss,
  signal: SourceIngestionSignal,
): Promise<string | null> {
  const singletonKey =
    signal.trigger === "GITHUB_WEBHOOK"
      ? `github:${signal.deliveryId}`
      : `recovery:${signal.appId}`;
  return boss.send(sourceIngestionQueue, signal, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    singletonKey,
    singletonSeconds: signal.trigger === "GITHUB_WEBHOOK" ? 86_400 : 60,
  });
}

export async function scheduleSourceIngestionRecovery(boss: PgBoss, appId: string): Promise<void> {
  await boss.schedule(
    sourceIngestionQueue,
    "*/5 * * * *",
    { kind: "SOURCE_INGESTION_SIGNAL", trigger: "RECOVERY_SCAN", appId },
    { tz: "UTC", key: `source-ingestion-recovery/${appId}` },
  );
}
