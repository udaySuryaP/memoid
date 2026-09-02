import {
  actorDisplayLabel,
  actorReference,
  assertOperationTransition,
  idempotencyAction,
  isTerminalOperationState,
  parseActorKind,
  parseUntrustedActorKind,
  providerKey,
  receiptScopeKey,
  sanitizedMetadata,
  sha256Hex,
  traceContext,
} from "../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

describe("Stage 10B domain foundations", () => {
  it("fails closed on Actor kinds and prevents untrusted system/worker impersonation", () => {
    expect(parseActorKind("MEMOID_SYSTEM")).toBe("MEMOID_SYSTEM");
    expect(parseUntrustedActorKind("HUMAN")).toBe("HUMAN");
    expect(() => parseUntrustedActorKind("MEMOID_SYSTEM")).toThrow("cannot claim");
    expect(() => parseUntrustedActorKind("MEMOID_WORKER")).toThrow("cannot claim");
    expect(() => parseActorKind("MODEL_PROVIDER")).toThrow("Unsupported Actor kind");
    expect(actorReference(" Integration:Build-Bot ")).toBe("integration:build-bot");
    expect(actorDisplayLabel(" Build bot ")).toBe("Build bot");
  });

  it("accepts only bounded sanitized audit/result/failure metadata", () => {
    expect(sanitizedMetadata({ STATE_FROM: "PENDING", ATTEMPT: 2, FLAGS: ["SAFE"] })).toEqual({
      STATE_FROM: "PENDING",
      ATTEMPT: 2,
      FLAGS: ["SAFE"],
    });
    expect(() => sanitizedMetadata({ ACCESS_TOKEN: "not-a-real-token" })).toThrow("Unsafe");
    expect(() => sanitizedMetadata({ SAFE: { NESTED: "raw object" } })).toThrow("bounded scalar");
    expect(() => sanitizedMetadata({ SAFE: "x".repeat(513) })).toThrow("bounded scalar");
  });

  it("locks legal Operation transitions and terminal behavior", () => {
    expect(() => assertOperationTransition("PENDING", "RUNNING")).not.toThrow();
    expect(() => assertOperationTransition("RUNNING", "RETRY_WAIT")).not.toThrow();
    expect(() => assertOperationTransition("RUNNING", "CANCELLATION_REQUESTED")).not.toThrow();
    expect(() => assertOperationTransition("CANCELLATION_REQUESTED", "CANCELLED")).not.toThrow();
    expect(() => assertOperationTransition("SUCCEEDED", "RUNNING")).toThrow(
      "Illegal Operation transition",
    );
    expect(() => assertOperationTransition("PENDING", "SUCCEEDED")).toThrow(
      "Illegal Operation transition",
    );
    expect(isTerminalOperationState("FAILED")).toBe(true);
    expect(isTerminalOperationState("RETRY_WAIT")).toBe(false);
  });

  it("validates scoped idempotency and receipt vocabulary without treating it as authority", () => {
    expect(idempotencyAction("CHECKPOINT_SUBMIT")).toBe("CHECKPOINT_SUBMIT");
    expect(() => idempotencyAction("checkpoint.submit")).toThrow("controlled key");
    expect(sha256Hex("ab".repeat(32))).toBe("ab".repeat(32));
    expect(() => sha256Hex("ab".repeat(31))).toThrow("SHA-256");
    expect(providerKey(" github ")).toBe("github");
    expect(receiptScopeKey(" source:primary/main ")).toBe("source:primary/main");
  });

  it("keeps correlation and causation opaque and independent", () => {
    const trace = traceContext(
      "018f4f4e-7b6d-7a10-8a55-010203040506",
      "018f4f4e-7b6d-7a11-8a55-010203040507",
    );
    expect(trace.correlationId).not.toBe(trace.causationId);
    expect(traceContext("018f4f4e-7b6d-7a10-8a55-010203040506").causationId).toBeNull();
    expect(() => traceContext("not-an-id")).toThrow("CorrelationId");
  });
});
