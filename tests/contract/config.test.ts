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
});
