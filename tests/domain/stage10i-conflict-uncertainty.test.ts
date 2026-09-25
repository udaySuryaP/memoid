import {
  assertIntegrityTransition,
  conflictParticipants,
  integrityPlane,
  parseConflictClassification,
  parseUncertaintyReason,
  resolutionLink,
} from "../../packages/domain/src/conflict-uncertainty.js";
import type {
  ContextIdentityId,
  ContextRecordId,
  ContextRevisionId,
  EvidenceReferenceId,
  WorkingContextItemId,
} from "../../packages/domain/src/identifiers.js";
import { describe, expect, it } from "vitest";

const evidence = "018f5e77-3b10-7abc-8def-123456789abc" as EvidenceReferenceId;
const working = "018f5e77-3b10-7abc-8def-123456789abd" as WorkingContextItemId;
const reviewed = "018f5e77-3b10-7abc-8def-123456789abe" as ContextRecordId;
const identity = "018f5e77-3b10-7abc-8def-123456789abf" as ContextIdentityId;
const revision = "018f5e77-3b10-7abc-8def-123456789ac0" as ContextRevisionId;

describe("Stage 10I Conflict and Uncertainty domain", () => {
  it("keeps Conflict, Uncertainty, and plane qualification independent", () => {
    expect(parseConflictClassification("MATERIAL_CONTRADICTION")).toBe("MATERIAL_CONTRADICTION");
    expect(parseUncertaintyReason("INCOMPLETE_EVIDENCE")).toBe("INCOMPLETE_EVIDENCE");
    expect(integrityPlane({ kind: "SOURCE_EVIDENCE", evidenceReferenceId: evidence })).toBe(
      "SOURCE",
    );
    expect(integrityPlane({ kind: "WORKING_CONTEXT", workingContextItemId: working })).toBe(
      "WORKING",
    );
    expect(integrityPlane({ kind: "SEMANTIC_IDENTITY", contextIdentityId: identity })).toBe(
      "REVIEWED",
    );
  });

  it("normalizes a deterministic multi-party participant set without hard-coding pairs", () => {
    expect(
      conflictParticipants([
        { kind: "WORKING_CONTEXT", workingContextItemId: working },
        { kind: "REVIEWED_CONTEXT", contextRecordId: reviewed },
        { kind: "SOURCE_EVIDENCE", evidenceReferenceId: evidence },
      ]),
    ).toEqual([
      { kind: "REVIEWED_CONTEXT", contextRecordId: reviewed },
      { kind: "SOURCE_EVIDENCE", evidenceReferenceId: evidence },
      { kind: "WORKING_CONTEXT", workingContextItemId: working },
    ]);
  });

  it("rejects missing, duplicate, and oversized Conflict participant sets", () => {
    expect(() =>
      conflictParticipants([{ kind: "SOURCE_EVIDENCE", evidenceReferenceId: evidence }]),
    ).toThrow("between 2 and 16");
    expect(() =>
      conflictParticipants([
        { kind: "SOURCE_EVIDENCE", evidenceReferenceId: evidence },
        { kind: "SOURCE_EVIDENCE", evidenceReferenceId: evidence },
      ]),
    ).toThrow("unique");
    expect(() =>
      conflictParticipants(
        Array.from({ length: 17 }, (_, index) => ({
          kind: "REVIEWED_CONTEXT" as const,
          contextRecordId:
            `${reviewed.slice(0, -2)}${String(index).padStart(2, "0")}` as ContextRecordId,
        })),
      ),
    ).toThrow("between 2 and 16");
  });

  it("permits changed active occurrences and recurrence while blocking invalid endings", () => {
    expect(() => assertIntegrityTransition(null, "ACTIVE")).not.toThrow();
    expect(() => assertIntegrityTransition("ACTIVE", "ACTIVE")).not.toThrow();
    expect(() => assertIntegrityTransition("ACTIVE", "ENDED")).not.toThrow();
    expect(() => assertIntegrityTransition("ENDED", "ACTIVE")).not.toThrow();
    expect(() => assertIntegrityTransition(null, "ENDED")).toThrow("begin ACTIVE");
    expect(() => assertIntegrityTransition("ENDED", "ENDED")).toThrow("cannot be ended again");
  });

  it("requires a Context Revision only for reviewed resolution", () => {
    expect(resolutionLink("REVIEWED_RESOLUTION", revision)).toBe(revision);
    expect(resolutionLink("INPUTS_NO_LONGER_CONFLICT")).toBeNull();
    expect(() => resolutionLink("REVIEWED_RESOLUTION")).toThrow("Context Revision");
    expect(() => resolutionLink("EVIDENCE_STRENGTHENED", revision)).toThrow("Context Revision");
  });

  it("rejects unknown classifications and uncertainty reasons", () => {
    expect(() => parseConflictClassification("UNCERTAIN")).toThrow("Unsupported Conflict");
    expect(() => parseUncertaintyReason("MODEL_CONFIDENCE_LOW")).toThrow("Unsupported Uncertainty");
  });
});
