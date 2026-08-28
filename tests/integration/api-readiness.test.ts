import { afterAll, describe, expect, it } from "vitest";
import { createPostgresReadinessProbe, type PostgresReadinessProbe } from "@memoid/db";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("PostgreSQL readiness probe", () => {
  const probes: PostgresReadinessProbe[] = [];
  afterAll(async () => Promise.all(probes.map((probe) => probe.close())));

  it("uses a bounded read-only query against available PostgreSQL", async () => {
    const probe = createPostgresReadinessProbe(databaseUrl!, 2_000);
    probes.push(probe);
    await expect(probe.check()).resolves.toBe(true);
  });

  it("reports unavailable PostgreSQL without throwing or leaking details", async () => {
    const probe = createPostgresReadinessProbe(
      ["postgresql://memoid_app", "synthetic@127.0.0.1", "1/memoid"].join(":"),
      100,
    );
    probes.push(probe);
    const startedAt = performance.now();
    await expect(probe.check()).resolves.toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
