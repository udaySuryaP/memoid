import {
  evaluateReviewPolicy,
  proposalPolicySummary,
  REVIEW_POLICY_ENGINE_VERSION,
} from "../../packages/domain/src/review-policy.js";
import { describe, expect, it } from "vitest";

const cleanAutomatic = {
  projectPolicy: "AUTOMATIC" as const,
  proposalCurrent: true,
  policyCurrent: true,
  conflict: false,
  uncertainty: false,
  destructive: false,
  authoritySensitive: false,
  securitySensitive: false,
  topologySensitive: false,
  insufficientEvidence: false,
  lowConfidence: false,
  branchOnly: false,
};

describe("Stage 10L deterministic review policy", () => {
  it("keeps MANUAL as a hard upper bound", () => {
    expect(evaluateReviewPolicy({ ...cleanAutomatic, projectPolicy: "MANUAL" })).toEqual({
      decision: "MANUAL_REQUIRED",
      reasonCodes: ["PROJECT_POLICY_MANUAL"],
      engineVersion: REVIEW_POLICY_ENGINE_VERSION,
    });
  });

  it("allows only a current, clean AUTOMATIC item", () => {
    expect(evaluateReviewPolicy(cleanAutomatic)).toEqual({
      decision: "AUTOMATIC_ELIGIBLE",
      reasonCodes: ["AUTOMATIC_ELIGIBLE"],
      engineVersion: "review-policy.v1",
    });
  });

  it.each([
    ["conflict", "PROTECTED_CONFLICT"],
    ["uncertainty", "PROTECTED_UNCERTAINTY"],
    ["destructive", "PROTECTED_DESTRUCTIVE"],
    ["authoritySensitive", "PROTECTED_AUTHORITY"],
    ["securitySensitive", "PROTECTED_SECURITY"],
    ["topologySensitive", "PROTECTED_TOPOLOGY"],
    ["insufficientEvidence", "PROTECTED_INSUFFICIENT_EVIDENCE"],
    ["lowConfidence", "PROTECTED_LOW_CONFIDENCE"],
    ["branchOnly", "PROTECTED_BRANCH_ONLY"],
  ] as const)("protects %s", (field, reason) => {
    const result = evaluateReviewPolicy({ ...cleanAutomatic, [field]: true });
    expect(result.decision).toBe("MANUAL_REQUIRED");
    expect(result.reasonCodes).toContain(reason);
  });

  it("fails closed for stale Proposal and policy bases with deterministic ordering", () => {
    expect(
      evaluateReviewPolicy({ ...cleanAutomatic, proposalCurrent: false, policyCurrent: false })
        .reasonCodes,
    ).toEqual(["PROPOSAL_STALE", "POLICY_VERSION_STALE"]);
  });

  it("preserves mixed per-item outcomes in conservative Proposal state", () => {
    expect(proposalPolicySummary(["AUTOMATIC_ELIGIBLE", "MANUAL_REQUIRED"])).toBe(
      "MANUAL_REVIEW_REMAINS",
    );
    expect(proposalPolicySummary(["AUTOMATIC_ELIGIBLE", "AUTOMATIC_ELIGIBLE"])).toBe(
      "FULLY_AUTOMATIC_ELIGIBLE",
    );
    expect(proposalPolicySummary([])).toBe("NO_CURRENT_ITEMS");
  });
});
