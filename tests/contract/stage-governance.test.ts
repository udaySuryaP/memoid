import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("durable repository governance continuity", () => {
  it("keeps repository contract baseline separate from live execution authorization", async () => {
    const [readme, agents, governance, map] = await Promise.all([
      read("../../README.md"),
      read("../../AGENTS.md"),
      read("../../docs/governance/repository.md"),
      read("../../docs/implementation/stage10-entry-map.md"),
    ]);

    for (const guidance of [readme, agents, governance, map]) {
      expect(guidance).toContain("HQ-reconciled Stage 9C");
      expect(guidance).toContain("does not independently authorize");
      expect(guidance).toContain("HQ");
      expect(guidance).not.toContain("Stage 9D **ACTIVE");
      expect(guidance).not.toContain("BLOCKED UNTIL STAGE 9D");
      expect(guidance).not.toContain("Stage 9B **ACTIVE");
    }
  });

  it("keeps branch/PR/HQ governance durable across stage transitions", async () => {
    const [readme, governance] = await Promise.all([
      read("../../README.md"),
      read("../../docs/governance/repository.md"),
    ]);

    for (const guidance of [readme, governance]) {
      expect(guidance).toContain("feature branch → CI/security → pull request → HQ review → merge");
      expect(guidance).toContain("Direct pushes to `main` are prohibited");
    }

    expect(readme).toContain("Stage 2 concluded **DO NOT BUILD / KILL**");
  });

  it("records every ordered Stage 10 vertical while defining gates rather than live authorization", async () => {
    const map = await read("../../docs/implementation/stage10-entry-map.md");
    const verticals = Array.from(map.matchAll(/^\| 10[A-T] /gm), ([match]) => match);

    expect(verticals).toHaveLength(20);
    expect(new Set(verticals).size).toBe(20);
    expect(map).toContain("Security controls precede the data paths they govern.");
    expect(map).toContain("defines gates, prerequisites, and proof ownership");
    expect(map).toContain("does not independently authorize");
    expect(map).toContain("PROOF-GATED / B");
    expect(map).toContain("docs/implementation/stage9c-failure-race-contract.json");
  });
});
