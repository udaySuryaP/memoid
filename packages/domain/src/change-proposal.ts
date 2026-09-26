import type {
  ChangeProposalId,
  ChangeProposalItemId,
  ContextIdentityId,
  ContextRecordId,
  EvidenceReferenceId,
  ProjectId,
  ReconciliationId,
  WorkingContextItemId,
} from "./identifiers.js";
import type { ReconciliationClass } from "./reconciliation.js";

export const PROPOSAL_GROUPING_VERSION = "proposal-grouping.v1" as const;
export const PROPOSAL_IDENTITY_VERSION = "proposal-item-identity.v1" as const;

export type ProposalLifecycleState = "OPEN" | "STALE" | "SUPERSEDED";
export type ProposalItemLifecycleState = "CURRENT" | "STALE" | "SUPERSEDED";

export interface ProposalGroupingInput {
  readonly projectId: ProjectId;
  readonly submissionId: string;
  readonly scopeKey: string;
  readonly facetKey: string;
}

export interface ProposalSemanticIdentityInput {
  readonly projectId: ProjectId;
  readonly contextIdentityId: ContextIdentityId;
  readonly classification: ReconciliationClass;
  readonly normalizedAssertion: Readonly<Record<string, unknown>>;
  readonly currentContextRecordId: ContextRecordId | null;
  readonly evidenceReferenceIds: readonly EvidenceReferenceId[];
  readonly authorityVersion: number;
  readonly evidenceFrontierVersion: number;
  readonly integrityVersion: number;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  return value;
}

function boundedPart(value: string, label: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 1 || normalized.length > 512)
    throw new Error(`Invalid ${label} for proposal identity`);
  return normalized;
}

export function proposalGroupingKey(input: ProposalGroupingInput): string {
  return [
    PROPOSAL_GROUPING_VERSION,
    input.projectId,
    boundedPart(input.submissionId, "submission"),
    boundedPart(input.scopeKey, "scope"),
    boundedPart(input.facetKey, "facet"),
  ].join("|");
}

export function proposalItemSemanticIdentity(input: ProposalSemanticIdentityInput): string {
  if (input.classification === "UNCHANGED")
    throw new Error("UNCHANGED_RECONCILIATION_IS_NOT_REVIEWABLE");
  for (const version of [
    input.authorityVersion,
    input.evidenceFrontierVersion,
    input.integrityVersion,
  ])
    if (!Number.isSafeInteger(version) || version < 0)
      throw new Error("Invalid proposal basis version");
  return JSON.stringify(
    stableValue({
      version: PROPOSAL_IDENTITY_VERSION,
      projectId: input.projectId,
      contextIdentityId: input.contextIdentityId,
      classification: input.classification,
      normalizedAssertion: input.normalizedAssertion,
      currentContextRecordId: input.currentContextRecordId,
      evidenceReferenceIds: [...new Set(input.evidenceReferenceIds)].sort(),
      authorityVersion: input.authorityVersion,
      evidenceFrontierVersion: input.evidenceFrontierVersion,
      integrityVersion: input.integrityVersion,
    }),
  );
}

export function assertProposalTransition(
  from: ProposalLifecycleState,
  to: ProposalLifecycleState,
): void {
  if (from !== "OPEN" || (to !== "STALE" && to !== "SUPERSEDED"))
    throw new Error("INVALID_PROPOSAL_LIFECYCLE_TRANSITION");
}

export function assertProposalItemTransition(
  from: ProposalItemLifecycleState,
  to: ProposalItemLifecycleState,
): void {
  if (from !== "CURRENT" || (to !== "STALE" && to !== "SUPERSEDED"))
    throw new Error("INVALID_PROPOSAL_ITEM_LIFECYCLE_TRANSITION");
}

export interface ProposalItemSnapshot {
  readonly proposalItemId: ChangeProposalItemId;
  readonly proposalId: ChangeProposalId;
  readonly projectId: ProjectId;
  readonly reconciliationId: ReconciliationId;
  readonly contextIdentityId: ContextIdentityId;
  readonly classification: ReconciliationClass;
  readonly normalizedAssertion: Readonly<Record<string, unknown>>;
  readonly currentContextRecordId: ContextRecordId | null;
  readonly workingContextItemId: WorkingContextItemId;
  readonly evidenceReferenceIds: readonly EvidenceReferenceId[];
  readonly conflictQualified: boolean;
  readonly uncertaintyQualified: boolean;
  readonly destructive: boolean;
  readonly lifecycleState: ProposalItemLifecycleState;
  readonly successorItemId: ChangeProposalItemId | null;
}
