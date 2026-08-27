import { PgBoss, type Job } from "pg-boss";

export const syntheticFoundationQueue = "foundation.synthetic";
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
