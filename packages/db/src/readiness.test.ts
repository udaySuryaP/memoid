import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPoolHandle = {
  emit: (event: string, error: Error) => boolean;
  listenerCount: (event: string) => number;
};

const { pools } = vi.hoisted(() => ({ pools: [] as MockPoolHandle[] }));

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");

  class MockPool extends EventEmitter {
    public constructor() {
      super();
      pools.push(this);
    }

    public async query(): Promise<{ rows: { ready: number }[] }> {
      return { rows: [{ ready: 1 }] };
    }

    public async end(): Promise<void> {}
  }

  return { Pool: MockPool };
});

import { createPostgresReadinessProbe } from "./index.js";

describe("PostgreSQL readiness pool errors", () => {
  beforeEach(() => pools.splice(0));

  it("handles an idle-client/backend error event on the dedicated readiness pool", async () => {
    const probe = createPostgresReadinessProbe("postgresql://synthetic", 100);
    const pool = pools[0];

    expect(pool).toBeDefined();
    expect(pool!.listenerCount("error")).toBe(1);
    expect(() => pool!.emit("error", new Error("backend connection lost"))).not.toThrow();
    await expect(probe.check()).resolves.toBe(true);
    await expect(probe.close()).resolves.toBeUndefined();
  });
});
