import type { ReviewPolicy } from "./values.js";

export const REVIEW_POLICY_ENGINE_VERSION = "review-policy.v1" as const;
export const REVIEW_POLICY_DECISIONS = ["MANUAL_REQUIRED", "AUTOMATIC_ELIGIBLE"] as const;
export type ReviewPolicyDecision = (typeof REVIEW_POLICY_DECISIONS)[number];

export const REVIEW_POLICY_REASON_CODES = [
  "PROJECT_POLICY_MANUAL",
  "PROPOSAL_STALE",
  "POLICY_VERSION_STALE",
  "PROTECTED_CONFLICT",
  "PROTECTED_UNCERTAINTY",
  "PROTECTED_DESTRUCTIVE",
  "PROTECTED_AUTHORITY",
  "PROTECTED_SECURITY",
  "PROTECTED_TOPOLOGY",
  "PROTECTED_INSUFFICIENT_EVIDENCE",
  "PROTECTED_LOW_CONFIDENCE",
  "PROTECTED_BRANCH_ONLY",
  "AUTOMATIC_ELIGIBLE",
] as const;
export type ReviewPolicyReasonCode = (typeof REVIEW_POLICY_REASON_CODES)[number];

export interface ReviewPolicyFacts {
  readonly projectPolicy: ReviewPolicy;
  readonly proposalCurrent: boolean;
  readonly policyCurrent: boolean;
  readonly conflict: boolean;
  readonly uncertainty: boolean;
  readonly destructive: boolean;
  readonly authoritySensitive: boolean;
  readonly securitySensitive: boolean;
  readonly topologySensitive: boolean;
  readonly insufficientEvidence: boolean;
  readonly lowConfidence: boolean;
  readonly branchOnly: boolean;
}

export interface ReviewPolicyResult {
  readonly decision: ReviewPolicyDecision;
  readonly reasonCodes: readonly ReviewPolicyReasonCode[];
  readonly engineVersion: typeof REVIEW_POLICY_ENGINE_VERSION;
}

export function evaluateReviewPolicy(facts: ReviewPolicyFacts): ReviewPolicyResult {
  const reasons: ReviewPolicyReasonCode[] = [];
  if (facts.projectPolicy === "MANUAL") reasons.push("PROJECT_POLICY_MANUAL");
  if (!facts.proposalCurrent) reasons.push("PROPOSAL_STALE");
  if (!facts.policyCurrent) reasons.push("POLICY_VERSION_STALE");
  if (facts.conflict) reasons.push("PROTECTED_CONFLICT");
  if (facts.uncertainty) reasons.push("PROTECTED_UNCERTAINTY");
  if (facts.destructive) reasons.push("PROTECTED_DESTRUCTIVE");
  if (facts.authoritySensitive) reasons.push("PROTECTED_AUTHORITY");
  if (facts.securitySensitive) reasons.push("PROTECTED_SECURITY");
  if (facts.topologySensitive) reasons.push("PROTECTED_TOPOLOGY");
  if (facts.insufficientEvidence) reasons.push("PROTECTED_INSUFFICIENT_EVIDENCE");
  if (facts.lowConfidence) reasons.push("PROTECTED_LOW_CONFIDENCE");
  if (facts.branchOnly) reasons.push("PROTECTED_BRANCH_ONLY");
  return reasons.length > 0
    ? {
        decision: "MANUAL_REQUIRED",
        reasonCodes: reasons,
        engineVersion: REVIEW_POLICY_ENGINE_VERSION,
      }
    : {
        decision: "AUTOMATIC_ELIGIBLE",
        reasonCodes: ["AUTOMATIC_ELIGIBLE"],
        engineVersion: REVIEW_POLICY_ENGINE_VERSION,
      };
}

export function proposalPolicySummary(
  decisions: readonly ReviewPolicyDecision[],
): "NO_CURRENT_ITEMS" | "FULLY_AUTOMATIC_ELIGIBLE" | "MANUAL_REVIEW_REMAINS" {
  if (decisions.length === 0) return "NO_CURRENT_ITEMS";
  return decisions.every((decision) => decision === "AUTOMATIC_ELIGIBLE")
    ? "FULLY_AUTOMATIC_ELIGIBLE"
    : "MANUAL_REVIEW_REMAINS";
}
