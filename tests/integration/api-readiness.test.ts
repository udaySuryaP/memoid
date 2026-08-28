import { afterAll, describe, expect, it } from "vitest";
import { parseApiConfig } from "@memoid/config";
import { createPostgresReadinessProbe, type PostgresReadinessProbe } from "@memoid/db";
import { buildServer } from "../../apps/api/src/server.js";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("PostgreSQL readiness probe", () => {
  const probes: PostgresReadinessProbe[] = [];
  afterAll(async () => Promise.all(probes.map((probe) => probe.close())));

  it("uses a bounded read-only query against available PostgreSQL", async () => {
    const probe = createPostgresReadinessProbe(databaseUrl!, 2_000);
    probes.push(probe);
    await expect(probe.check()).resolves.toBe(true);

    const app = buildServer(
      parseApiConfig({ MEMOID_ENV: "test", DATABASE_URL: databaseUrl }),
      probe.check,
    );
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready", checks: { database: true } });
    } finally {
      await app.close();
    }
  });

  it("reports unavailable PostgreSQL without throwing or leaking details", async () => {
    const unavailableUrl = ["postgresql://memoid_app", "synthetic@127.0.0.1", "1/memoid"].join(":");
    const probe = createPostgresReadinessProbe(unavailableUrl, 100);
    probes.push(probe);
    const startedAt = performance.now();
    await expect(probe.check()).resolves.toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(2_000);

    const app = buildServer(
      parseApiConfig({ MEMOID_ENV: "test", DATABASE_URL: unavailableUrl }),
      probe.check,
    );
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "not-ready", checks: { database: false } });
      expect(response.body).not.toContain("synthetic");
      expect(response.body).not.toContain("127.0.0.1");
      expect(response.body).not.toContain("memoid");
    } finally {
      await app.close();
    }
  });
});
