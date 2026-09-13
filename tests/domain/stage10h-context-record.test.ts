import {
  contextMutationInput,
  contextPayload,
  parseContextEndReason,
  sourceFreshness,
} from "../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

describe("Stage 10H Context domain", () => {
  it("normalizes stable semantic identity independently from mutable values", () => {
    const first = contextMutationInput(
      {
        subject: " Project ",
        scope: " Architecture ",
        facet: " Decision ",
        predicate: " Runtime ",
      },
      { value: "PostgreSQL" },
      "USER_NATIVE",
    );
    const revised = contextMutationInput(first.identity, { value: "PostgreSQL 18" }, "USER_NATIVE");
    expect(first.identity).toEqual(revised.identity);
    expect(first.payload).not.toEqual(revised.payload);
  });

  it("requires explicit and correctly shaped provenance", () => {
    expect(() =>
      contextMutationInput(
        { subject: "project", scope: "implementation", facet: "code", predicate: "runtime" },
        { value: "Node" },
        "SOURCE_EVIDENCE",
      ),
    ).toThrow("both Evidence and Authority");
    expect(() =>
      contextMutationInput(
        { subject: "project", scope: "implementation", facet: "code", predicate: "runtime" },
        { value: "Node" },
        "MEMOID_OPERATION",
      ),
    ).toThrow("later trusted worker boundary");
    expect(() => contextPayload([])).toThrow("object");
    expect(parseContextEndReason("RETIRED")).toBe("RETIRED");
  });

  it("qualifies source freshness without overwriting reviewed truth", () => {
    const base = {
      sourceBacked: true,
      sourceAvailable: true,
      authorityCurrent: true,
      defaultRefCurrent: true,
      coveredObservationSequence: 4,
      latestIngestedSequence: 4,
    };
    expect(sourceFreshness(base)).toBe("CURRENT");
    expect(sourceFreshness({ ...base, latestIngestedSequence: 5 })).toBe("SOURCE_NEWER");
    expect(sourceFreshness({ ...base, sourceAvailable: false })).toBe("SOURCE_UNAVAILABLE");
    expect(sourceFreshness({ ...base, authorityCurrent: false })).toBe("AUTHORITY_CHANGED");
    expect(sourceFreshness({ ...base, sourceBacked: false })).toBe("NOT_SOURCE_BACKED");
  });
});
