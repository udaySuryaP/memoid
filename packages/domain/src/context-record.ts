import type {
  ContextIdentityId,
  ContextRecordId,
  EvidenceReferenceId,
  SourceAuthorityAssignmentId,
} from "./identifiers.js";
import { contextIdentity, type ContextIdentityComponents } from "./context-identity.js";

export const CONTEXT_ORIGIN_KINDS = ["USER_NATIVE", "SOURCE_EVIDENCE", "MEMOID_OPERATION"] as const;
export type ContextOriginKind = (typeof CONTEXT_ORIGIN_KINDS)[number];

export const CONTEXT_END_REASONS = ["RETIRED", "INVALIDATED", "NO_LONGER_APPLICABLE"] as const;
export type ContextEndReason = (typeof CONTEXT_END_REASONS)[number];

export type ContextLifecycleState = "ACTIVE" | "ENDED";
export type ContextFreshness =
  | "NOT_SOURCE_BACKED"
  | "CURRENT"
  | "SOURCE_NEWER"
  | "SOURCE_UNAVAILABLE"
  | "AUTHORITY_CHANGED"
  | "REVALIDATION_REQUIRED";

export interface ContextRecordView extends ContextIdentityComponents {
  readonly contextIdentityId: ContextIdentityId;
  readonly contextRecordId: ContextRecordId;
  readonly lifecycleState: ContextLifecycleState;
  readonly identityVersion: number;
  readonly recordVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly originKind: ContextOriginKind;
  readonly supersedesContextRecordId: ContextRecordId | null;
  readonly evidenceReferenceId: EvidenceReferenceId | null;
  readonly sourceAuthorityAssignmentId: SourceAuthorityAssignmentId | null;
  readonly freshness: ContextFreshness;
  readonly reviewedAt: string;
}

export function parseContextOriginKind(value: string): ContextOriginKind {
  if (!(CONTEXT_ORIGIN_KINDS as readonly string[]).includes(value))
    throw new Error(`Unsupported Context origin: ${value}`);
  return value as ContextOriginKind;
}

export function parseContextEndReason(value: string): ContextEndReason {
  if (!(CONTEXT_END_REASONS as readonly string[]).includes(value))
    throw new Error(`Unsupported Context ending reason: ${value}`);
  return value as ContextEndReason;
}

export function contextPayload(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Context payload must be an object");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 65_536)
    throw new Error("Context payload must not exceed 65536 bytes");
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

export function contextMutationInput(
  identity: ContextIdentityComponents,
  payload: unknown,
  originKind: ContextOriginKind,
  evidenceReferenceId?: EvidenceReferenceId | null,
  sourceAuthorityAssignmentId?: SourceAuthorityAssignmentId | null,
) {
  const normalizedIdentity = contextIdentity(identity);
  const normalizedPayload = contextPayload(payload);
  const sourceBacked = originKind === "SOURCE_EVIDENCE";
  if (
    sourceBacked !==
    (evidenceReferenceId !== null &&
      evidenceReferenceId !== undefined &&
      sourceAuthorityAssignmentId !== null &&
      sourceAuthorityAssignmentId !== undefined)
  ) {
    throw new Error("Source-evidence Context requires both Evidence and Authority provenance");
  }
  if (originKind === "MEMOID_OPERATION")
    throw new Error("MEMOID_OPERATION creation is reserved for a later trusted worker boundary");
  return {
    identity: normalizedIdentity,
    payload: normalizedPayload,
    originKind,
    evidenceReferenceId: evidenceReferenceId ?? null,
    sourceAuthorityAssignmentId: sourceAuthorityAssignmentId ?? null,
  } as const;
}

export function sourceFreshness(input: {
  readonly sourceBacked: boolean;
  readonly sourceAvailable: boolean;
  readonly authorityCurrent: boolean;
  readonly defaultRefCurrent: boolean;
  readonly coveredObservationSequence: number | null;
  readonly latestIngestedSequence: number | null;
}): ContextFreshness {
  if (!input.sourceBacked) return "NOT_SOURCE_BACKED";
  if (!input.sourceAvailable) return "SOURCE_UNAVAILABLE";
  if (!input.authorityCurrent) return "AUTHORITY_CHANGED";
  if (!input.defaultRefCurrent) return "REVALIDATION_REQUIRED";
  if (
    input.coveredObservationSequence !== null &&
    input.latestIngestedSequence !== null &&
    input.latestIngestedSequence > input.coveredObservationSequence
  )
    return "SOURCE_NEWER";
  return "CURRENT";
}
