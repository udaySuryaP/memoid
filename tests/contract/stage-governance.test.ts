import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("Stage 9B governance continuity", () => {
  it("keeps repository entry points aligned on the active gate", async () => {
    const [readme, agents, governance] = await Promise.all([
      read("../../README.md"),
      read("../../AGENTS.md"),
      read("../../docs/governance/repository.md"),
    ]);

    for (const guidance of [readme, agents, governance]) {
      expect(guidance).toContain("Stage 9B");
      expect(guidance).toContain("Stage 10");
      expect(guidance).toContain("BLOCKED UNTIL STAGE 9B HQ RECONCILIATION");
      expect(guidance).not.toContain("Stage 9A **ACTIVE");
    }
  });

  it("records every ordered Stage 10 vertical and the entry boundary", async () => {
    const map = await read("../../docs/implementation/stage10-entry-map.md");
    const verticals = Array.from(map.matchAll(/^\| 10[A-T] /gm), ([match]) => match);

    expect(verticals).toHaveLength(20);
    expect(new Set(verticals).size).toBe(20);
    expect(map).toContain("Security controls precede the data paths they govern.");
    expect(map).toContain("does not authorize Stage 10");
    expect(map).toContain("MCP protocol-version header enforcement");
  });
});
