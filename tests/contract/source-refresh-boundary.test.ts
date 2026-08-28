import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const guidanceFiles = [
  "../../README.md",
  "../../AGENTS.md",
  "../../docs/architecture/foundation.md",
  "../../docs/integrations/provider-boundaries.md",
] as const;

describe("external Source-refresh boundary", () => {
  it("keeps refresh/sync first-party or system-controlled in V1", async () => {
    const guidance = await Promise.all(
      guidanceFiles.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    expect(guidance.join("\n")).toContain(
      "Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1.",
    );
    expect(guidance.join("\n")).not.toContain("request" + "_source_refresh");
  });
});
