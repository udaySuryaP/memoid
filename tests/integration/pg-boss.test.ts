import { describe, expect, it, vi } from "vitest";
import { createBoss, enqueueSyntheticJob, startSyntheticWorker } from "@memoid/jobs";
const url = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = url ? describe : describe.skip;
suite("pg-boss PostgreSQL 18 compatibility", () => {
  it("starts, consumes a synthetic retry-configured job, and stops", async () => {
    const boss = createBoss(url!);
    const received: Readonly<Record<string, unknown>>[] = [];
    await boss.start();
    try {
      await startSyntheticWorker(boss, async (payload) => {
        received.push(payload);
      });
      const id = await enqueueSyntheticJob(boss, { kind: "foundation-proof" });
      expect(id).toBeTruthy();
      await vi.waitFor(() => expect(received).toContainEqual({ kind: "foundation-proof" }), {
        timeout: 15_000,
      });
    } finally {
      await boss.stop({ graceful: true, timeout: 5_000 });
    }
  });
});
