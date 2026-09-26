import type {
  ContextIdentityId,
  ContextRecordId,
  ContextRevisionId,
  EvidenceReferenceId,
  WorkingContextItemId,
} from "./identifiers.js";

export const INTEGRITY_LIFECYCLE_STATES = ["ACTIVE", "ENDED"] as const;
export type IntegrityLifecycleState = (typeof INTEGRITY_LIFECYCLE_STATES)[number];

export const CONFLICT_CLASSIFICATIONS = ["MATERIAL_CONTRADICTION"] as const;
export type ConflictClassification = (typeof CONFLICT_CLASSIFICATIONS)[number];

export const CONFLICT_END_REASONS = [
  "INPUTS_NO_LONGER_CONFLICT",
  "PARTICIPANTS_SUPERSEDED",
  "REVIEWED_RESOLUTION",
] as const;
export type ConflictEndReason = (typeof CONFLICT_END_REASONS)[number];

export const UNCERTAINTY_REASONS = [
  "INCOMPLETE_EVIDENCE",
  "AMBIGUOUS_INTERPRETATION",
  "WEAK_SUPPORT",
  "UNRESOLVED_SOURCE_QUALIFICATION",
  "WORKING_CONTEXT_AMBIGUITY",
] as const;
export type UncertaintyReason = (typeof UNCERTAINTY_REASONS)[number];

export const UNCERTAINTY_END_REASONS = [
  "EVIDENCE_STRENGTHENED",
  "INTERPRETATION_CLARIFIED",
  "TARGET_SUPERSEDED",
  "REVIEWED_RESOLUTION",
] as const;
export type UncertaintyEndReason = (typeof UNCERTAINTY_END_REASONS)[number];

export type IntegrityPlane = "SOURCE" | "WORKING" | "REVIEWED";

export type ConflictParticipantReference =
  | { readonly kind: "SOURCE_EVIDENCE"; readonly evidenceReferenceId: EvidenceReferenceId }
  | { readonly kind: "WORKING_CONTEXT"; readonly workingContextItemId: WorkingContextItemId }
  | { readonly kind: "REVIEWED_CONTEXT"; readonly contextRecordId: ContextRecordId };

export type UncertaintyTargetReference =
  | { readonly kind: "SEMANTIC_IDENTITY"; readonly contextIdentityId: ContextIdentityId }
  | { readonly kind: "SOURCE_EVIDENCE"; readonly evidenceReferenceId: EvidenceReferenceId }
  | { readonly kind: "WORKING_CONTEXT"; readonly workingContextItemId: WorkingContextItemId }
  | { readonly kind: "REVIEWED_CONTEXT"; readonly contextRecordId: ContextRecordId };

export interface EndIntegrityStateInput {
  readonly reason: ConflictEndReason | UncertaintyEndReason;
  readonly resolvedByContextRevisionId?: ContextRevisionId | null;
}

const referenceKey = (participant: ConflictParticipantReference): string => {
  switch (participant.kind) {
    case "SOURCE_EVIDENCE":
      return `${participant.kind}:${participant.evidenceReferenceId}`;
    case "WORKING_CONTEXT":
      return `${participant.kind}:${participant.workingContextItemId}`;
    case "REVIEWED_CONTEXT":
      return `${participant.kind}:${participant.contextRecordId}`;
  }
};

export function conflictParticipants(
  input: readonly ConflictParticipantReference[],
): readonly ConflictParticipantReference[] {
  if (input.length < 2 || input.length > 16)
    throw new Error("Conflict requires between 2 and 16 participants");
  const normalized = [...input].sort((left, right) =>
    referenceKey(left).localeCompare(referenceKey(right)),
  );
  if (new Set(normalized.map(referenceKey)).size !== normalized.length)
    throw new Error("Conflict participants must be unique");
  return Object.freeze(normalized.map((participant) => Object.freeze({ ...participant })));
}

export function parseConflictClassification(value: string): ConflictClassification {
  if (!(CONFLICT_CLASSIFICATIONS as readonly string[]).includes(value))
    throw new Error(`Unsupported Conflict classification: ${value}`);
  return value as ConflictClassification;
}

export function parseConflictEndReason(value: string): ConflictEndReason {
  if (!(CONFLICT_END_REASONS as readonly string[]).includes(value))
    throw new Error(`Unsupported Conflict ending reason: ${value}`);
  return value as ConflictEndReason;
}

export function parseUncertaintyReason(value: string): UncertaintyReason {
  if (!(UNCERTAINTY_REASONS as readonly string[]).includes(value))
    throw new Error(`Unsupported Uncertainty reason: ${value}`);
  return value as UncertaintyReason;
}

export function parseUncertaintyEndReason(value: string): UncertaintyEndReason {
  if (!(UNCERTAINTY_END_REASONS as readonly string[]).includes(value))
    throw new Error(`Unsupported Uncertainty ending reason: ${value}`);
  return value as UncertaintyEndReason;
}

export function assertIntegrityTransition(
  current: IntegrityLifecycleState | null,
  next: IntegrityLifecycleState,
): void {
  if (current === null && next !== "ACTIVE") throw new Error("Integrity history must begin ACTIVE");
  if (current === "ENDED" && next === "ENDED")
    throw new Error("Ended integrity state cannot be ended again");
}

export function resolutionLink(
  reason: ConflictEndReason | UncertaintyEndReason,
  revisionId?: ContextRevisionId | null,
): ContextRevisionId | null {
  const resolved = revisionId ?? null;
  if (reason === "REVIEWED_RESOLUTION")
    throw new Error("Reviewed resolution is reserved for the Stage 10M causal operation");
  if (resolved !== null)
    throw new Error("Non-reviewed endings cannot carry a Context Revision linkage");
  return resolved;
}

export function integrityPlane(
  reference: ConflictParticipantReference | UncertaintyTargetReference,
): IntegrityPlane | null {
  if (reference.kind === "SOURCE_EVIDENCE") return "SOURCE";
  if (reference.kind === "WORKING_CONTEXT") return "WORKING";
  if (reference.kind === "REVIEWED_CONTEXT") return "REVIEWED";
  return null;
}
