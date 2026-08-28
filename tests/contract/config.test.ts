import { describe, expect, it } from "vitest";
import { parseApiConfig, parseWebConfig } from "@memoid/config";

describe("typed startup configuration", () => {
  it("coerces ports and applies safe defaults", () => {
    expect(parseWebConfig({ MEMOID_ENV: "test", WEB_PORT: "3100" })).toMatchObject({
      MEMOID_ENV: "test",
      WEB_PORT: 3100,
      LOG_LEVEL: "info",
    });
  });

  it("fails closed when required server configuration is absent", () => {
    expect(() => parseApiConfig({ MEMOID_ENV: "production" })).toThrow();
  });

  it("bounds the PostgreSQL readiness timeout", () => {
    const database = ["postgresql://memoid_app", "synthetic@localhost", "5432/memoid"].join(":");
    expect(parseApiConfig({ MEMOID_ENV: "test", DATABASE_URL: database })).toMatchObject({
      DATABASE_READINESS_TIMEOUT_MS: 2_000,
    });
    expect(() =>
      parseApiConfig({
        MEMOID_ENV: "test",
        DATABASE_URL: database,
        DATABASE_READINESS_TIMEOUT_MS: "10001",
      }),
    ).toThrow();
  });
});
