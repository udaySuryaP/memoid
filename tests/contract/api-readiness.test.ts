import { describe, expect, it, vi } from "vitest";
import { parseApiConfig } from "@memoid/config";
import { buildServer } from "../../apps/api/src/server.js";

const config = parseApiConfig({
  MEMOID_ENV: "test",
  DATABASE_URL: ["postgresql://memoid_app", "synthetic@localhost", "5432/memoid"].join(":"),
});

describe("API liveness and readiness", () => {
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
