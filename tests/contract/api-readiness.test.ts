import { describe, expect, it, vi } from "vitest";
import { parseApiConfig } from "@memoid/config";
import { buildServer } from "../../apps/api/src/server.js";
import { createHmac } from "node:crypto";

const config = parseApiConfig({
  MEMOID_ENV: "test",
  DATABASE_URL: ["postgresql://memoid_app", "synthetic@localhost", "5432/memoid"].join(":"),
});

describe("API liveness and readiness", () => {
  it("dispatches an authenticated GitHub push as a server-controlled ingestion signal", async () => {
    const secret = "synthetic-github-webhook-secret-32-bytes";
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "f".repeat(40),
      installation: { id: 456, app_id: 123 },
      repository: { id: 789 },
    });
    const dispatched: unknown[] = [];
    const app = buildServer(
      parseApiConfig({
        MEMOID_ENV: "test",
        DATABASE_URL: ["postgresql://memoid_app", "synthetic@localhost", "5432/memoid"].join(":"),
        PROVIDER_DATABASE_URL: [
          "postgresql://memoid_provider",
          "synthetic@localhost",
          "5432/memoid",
        ].join(":"),
        GITHUB_APP_ID: "123",
        GITHUB_WEBHOOK_SECRET: secret,
      }),
      async () => true,
      {
        enqueue: async (signal) => {
          dispatched.push(signal);
          return "job-1";
        },
      },
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
        },
        payload,
      });
      expect(response.statusCode).toBe(202);
      expect(dispatched).toEqual([
        {
          kind: "SOURCE_INGESTION_SIGNAL",
          trigger: "GITHUB_WEBHOOK",
          appId: "123",
          installationId: "456",
          repositoryId: "789",
          refKey: "refs/heads/main",
          deliveryId: "delivery-1",
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it("keeps /health liveness-only when PostgreSQL is unavailable", async () => {
    const readiness = vi.fn(async () => {
      throw new Error("connection details must not escape");
    });
    const app = buildServer(config, readiness);
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: "ok", service: "api" });
      expect(readiness).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns ready only after a successful PostgreSQL probe", async () => {
    const app = buildServer(config, async () => true);
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready", checks: { database: true } });
    } finally {
      await app.close();
    }
  });

  it("catches a throwing readiness callback, returns a sanitized 503, and stays live", async () => {
    const app = buildServer(config, async () => {
      throw new Error(["postgresql://user", "secret@private-host", "5432/memoid"].join(":"));
    });
    try {
      const response = await app.inject({ method: "GET", url: "/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "not-ready", checks: { database: false } });
      expect(response.body).not.toContain("secret");
      expect(response.body).not.toContain("private-host");

      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: "ok", service: "api" });
    } finally {
      await app.close();
    }
  });
});
