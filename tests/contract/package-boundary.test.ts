import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
describe("domain boundary", () => {
  it("does not import frameworks or providers", async () => {
    const source = await readFile(
      new URL("../../packages/domain/src/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /fastify|next|kysely|pg-boss|workos|octokit|aws-sdk|modelcontextprotocol/i,
    );
  });
});
