import { describe, expect, it } from "vitest";
import {
  candidateAssertionBasis,
  candidateFrontier,
  contextIdentity,
  contiguousStableDispositionWatermark,
  parseInstant,
  parseReviewPolicy,
  parseUuidV7,
  positiveSequence,
  positiveVersion,
  sourceFrontier,
  type AccountId,
  type CandidateAssertionBasis,
} from "../../packages/domain/src/index.js";

const ACCOUNT_ID = parseUuidV7("01890f0e-7a5b-7cc3-98c4-dc0c0c07398f", "AccountId") as AccountId;

describe("stable identifiers and semantic values", () => {
  it("accepts canonical UUIDv7 and rejects other UUID versions", () => {
    expect(parseUuidV7(ACCOUNT_ID, "AccountId")).toBe(ACCOUNT_ID);
    expect(() => parseUuidV7("00000000-0000-4000-8000-000000000001", "AccountId")).toThrow(
      "UUIDv7",
    );
  });

  it("defaults a missing review policy to MANUAL and rejects unknown policies", () => {
    expect(parseReviewPolicy(undefined)).toBe("MANUAL");
    expect(parseReviewPolicy(null)).toBe("MANUAL");
    expect(parseReviewPolicy("AUTOMATIC")).toBe("AUTOMATIC");
    expect(() => parseReviewPolicy("MODEL_DECIDES")).toThrow("Unsupported review policy");
  });

  it("enforces positive versions, sequences, and valid instants", () => {
    expect(positiveVersion(1)).toBe(1);
    expect(positiveSequence(9)).toBe(9);
    expect(parseInstant("2026-08-29T01:02:03Z")).toBe("2026-08-29T01:02:03.000Z");
    expect(() => positiveVersion(0)).toThrow();
    expect(() => positiveSequence(1.5)).toThrow();
    expect(() => parseInstant("2026-08-29")).toThrow();
    expect(() => parseInstant("not-a-time")).toThrow();
  });
});

describe("candidate origin and confirmation", () => {
  it("keeps checkpoint-safe AI inference unconfirmed by default", () => {
    expect(candidateAssertionBasis({ origin: "AI_INFERRED", confirmation: "NONE" })).toEqual({
      origin: "AI_INFERRED",
      confirmation: "NONE",
    });
  });

  it("requires attribution for explicit user confirmation", () => {
    const confirmedAt = parseInstant("2026-08-29T01:02:03Z");
    expect(
      candidateAssertionBasis({
        origin: "AI_INFERRED",
        confirmation: "EXPLICIT_USER",
        confirmedAt,
        confirmedByAccountId: ACCOUNT_ID,
      }),
    ).toMatchObject({ confirmation: "EXPLICIT_USER", confirmedByAccountId: ACCOUNT_ID });
    expect(() =>
      candidateAssertionBasis({
        origin: "AI_INFERRED",
        confirmation: "EXPLICIT_USER",
      } as CandidateAssertionBasis),
    ).toThrow("requires Account and timestamp");
  });
});

describe("Context Identity", () => {
  it("normalizes semantic identity independently from assertion values", () => {
    expect(
      contextIdentity({
        subject: " API/Auth ",
        scope: " Project/Root ",
        facet: " Architecture ",
        predicate: " Provider ",
      }),
    ).toEqual({
      subject: "api/auth",
      scope: "project/root",
      facet: "architecture",
      predicate: "provider",
    });
  });

  it("rejects empty, oversized, and unsafe identity keys", () => {
    expect(() =>
      contextIdentity({ subject: "", scope: "root", facet: "state", predicate: "value" }),
    ).toThrow();
    expect(() =>
      contextIdentity({
        subject: "api auth",
        scope: "root",
        facet: "state",
        predicate: "value",
      }),
    ).toThrow();
  });
});

describe("frontier semantics", () => {
  it("enforces Source frontier stage ordering", () => {
    expect(
      sourceFrontier({
        observed: positiveSequence(50),
        desired: positiveSequence(50),
        ingested: positiveSequence(49),
        reconciled: positiveSequence(48),
      }),
    ).toMatchObject({ observed: 50, desired: 50, ingested: 49, reconciled: 48 });
    expect(() =>
      sourceFrontier({
        observed: positiveSequence(49),
        desired: positiveSequence(50),
        ingested: null,
        reconciled: null,
      }),
    ).toThrow("reconciled <= ingested <= desired <= observed");
  });

  it("never moves Candidate reconciliation across a gap", () => {
    expect(contiguousStableDispositionWatermark(50, new Set([1, 2, 3, 5, 50]))).toBe(3);
    expect(contiguousStableDispositionWatermark(3, new Set([1, 2, 3]))).toBe(3);
    expect(candidateFrontier(50, 48)).toEqual({ lastAccepted: 50, reconciledThrough: 48 });
    expect(() => candidateFrontier(49, 50)).toThrow("cannot exceed");
  });
});
