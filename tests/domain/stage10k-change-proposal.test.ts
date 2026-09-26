import { describe, expect, it } from "vitest";
import type {
  ContextIdentityId,
  ContextRecordId,
  EvidenceReferenceId,
  ProjectId,
} from "../../packages/domain/src/identifiers.js";
import {
  assertProposalItemTransition,
  assertProposalTransition,
  proposalGroupingKey,
  proposalItemSemanticIdentity,
} from "../../packages/domain/src/change-proposal.js";

const project = "01990000-0000-7000-8000-000000000001" as ProjectId;
const context = "01990000-0000-7000-8000-000000000002" as ContextIdentityId;
const current = "01990000-0000-7000-8000-000000000003" as ContextRecordId;
const evidenceA = "01990000-0000-7000-8000-000000000004" as EvidenceReferenceId;
const evidenceB = "01990000-0000-7000-8000-000000000005" as EvidenceReferenceId;

const semantic = {
  projectId: project,
  contextIdentityId: context,
  classification: "CHANGED" as const,
  normalizedAssertion: { b: "two", a: "one" },
  currentContextRecordId: current,
  evidenceReferenceIds: [evidenceB, evidenceA],
  authorityVersion: 1,
  evidenceFrontierVersion: 2,
  integrityVersion: 3,
};

describe("Stage 10K Change Proposal domain", () => {
  it("creates a deterministic versioned grouping key", () => {
    const input = {
      projectId: project,
      submissionId: "submission",
      scopeKey: "project",
      facetKey: "architecture",
    };
    expect(proposalGroupingKey(input)).toBe(proposalGroupingKey(input));
    expect(proposalGroupingKey(input)).toContain("proposal-grouping.v1");
  });

  it("separates grouping across Project, scope, facet, and causal submission", () => {
    const base = {
      projectId: project,
      submissionId: "submission",
      scopeKey: "project",
      facetKey: "architecture",
    };
    const keys = [
      proposalGroupingKey(base),
      proposalGroupingKey({
        ...base,
        projectId: "01990000-0000-7000-8000-000000000099" as ProjectId,
      }),
      proposalGroupingKey({ ...base, submissionId: "other" }),
      proposalGroupingKey({ ...base, scopeKey: "source" }),
      proposalGroupingKey({ ...base, facetKey: "security" }),
    ];
    expect(new Set(keys)).toHaveLength(5);
  });

  it("deduplicates stable object ordering and Evidence ordering", () => {
    expect(proposalItemSemanticIdentity(semantic)).toBe(
      proposalItemSemanticIdentity({
        ...semantic,
        normalizedAssertion: { a: "one", b: "two" },
        evidenceReferenceIds: [evidenceA, evidenceB, evidenceA],
      }),
    );
  });

  it("does not deduplicate different classes, Reviewed bases, or integrity bases", () => {
    const identities = [
      proposalItemSemanticIdentity(semantic),
      proposalItemSemanticIdentity({ ...semantic, classification: "SUPERSEDED" }),
      proposalItemSemanticIdentity({ ...semantic, currentContextRecordId: null }),
      proposalItemSemanticIdentity({ ...semantic, integrityVersion: 4 }),
    ];
    expect(new Set(identities)).toHaveLength(4);
  });

  it("keeps reconciliation SUPERSEDED separate from proposal lifecycle", () => {
    const identity = proposalItemSemanticIdentity({ ...semantic, classification: "SUPERSEDED" });
    expect(identity).toContain('"classification":"SUPERSEDED"');
    expect(() => assertProposalTransition("OPEN", "SUPERSEDED")).not.toThrow();
  });

  it("rejects UNCHANGED review noise", () => {
    expect(() =>
      proposalItemSemanticIdentity({ ...semantic, classification: "UNCHANGED" }),
    ).toThrow("UNCHANGED_RECONCILIATION_IS_NOT_REVIEWABLE");
  });

  it("permits only monotonic Proposal transitions", () => {
    expect(() => assertProposalTransition("OPEN", "STALE")).not.toThrow();
    expect(() => assertProposalTransition("OPEN", "SUPERSEDED")).not.toThrow();
    expect(() => assertProposalTransition("STALE", "OPEN")).toThrow(
      "INVALID_PROPOSAL_LIFECYCLE_TRANSITION",
    );
  });

  it("permits only monotonic Proposal Item transitions", () => {
    expect(() => assertProposalItemTransition("CURRENT", "STALE")).not.toThrow();
    expect(() => assertProposalItemTransition("CURRENT", "SUPERSEDED")).not.toThrow();
    expect(() => assertProposalItemTransition("SUPERSEDED", "CURRENT")).toThrow(
      "INVALID_PROPOSAL_ITEM_LIFECYCLE_TRANSITION",
    );
  });

  it("rejects invalid basis versions", () => {
    expect(() => proposalItemSemanticIdentity({ ...semantic, authorityVersion: -1 })).toThrow(
      "Invalid proposal basis version",
    );
  });
});
