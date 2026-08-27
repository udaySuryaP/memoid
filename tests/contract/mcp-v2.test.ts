import { McpServer } from "@modelcontextprotocol/server";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { describe, expect, it } from "vitest";
const createIsolatedServer = () =>
  new McpServer({ name: "memoid-foundation-compatibility", version: "0.0.0" });
describe("MCP v2 split SDK compatibility", () => {
  it("resolves stable split packages and creates isolated servers", async () => {
    const a = createIsolatedServer();
    const b = createIsolatedServer();
    expect(a).not.toBe(b);
    const app = createMcpFastifyApp();
    app.get("/synthetic", async () => ({ ok: true }));
    await expect(
      app.inject({ method: "GET", url: "/synthetic", headers: { host: "evil.example" } }),
    ).resolves.toMatchObject({ statusCode: 403 });
    await expect(
      app.inject({ method: "GET", url: "/synthetic", headers: { host: "127.0.0.1" } }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await app.close();
    await a.close();
    await b.close();
  });
});
