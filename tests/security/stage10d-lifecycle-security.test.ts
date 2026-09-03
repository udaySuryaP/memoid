import { fingerprintLifecycleRequest, hashIdempotencyKey } from "@memoid/security";
import { describe, expect, it } from "vitest";

describe("Stage 10D lifecycle request evidence", () => {
  it("hashes an opaque idempotency key without retaining it", () => {
    const key = "00000000000000000000000000000000";
    const digest = hashIdempotencyKey(key);
    expect(digest).toHaveLength(32);
    expect(digest.toString("utf8")).not.toContain(key);
    expect(hashIdempotencyKey(key)).toEqual(digest);
  });

  it("binds idempotency to the normalized lifecycle request", () => {
    const first = fingerprintLifecycleRequest({
      displayName: "One",
      description: null,
      reviewPolicy: "MANUAL",
    });
    const replay = fingerprintLifecycleRequest({
      displayName: "One",
      description: null,
      reviewPolicy: "MANUAL",
    });
    const conflict = fingerprintLifecycleRequest({
      displayName: "Two",
      description: null,
      reviewPolicy: "MANUAL",
    });
    expect(replay).toEqual(first);
    expect(conflict).not.toEqual(first);
  });

  it("rejects weak or oversized idempotency credentials", () => {
    expect(() => hashIdempotencyKey("short")).toThrow();
    expect(() => hashIdempotencyKey("x".repeat(257))).toThrow();
  });
});
