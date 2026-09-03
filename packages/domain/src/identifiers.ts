const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OpaqueId<Kind extends string> = string & { readonly __kind: Kind };

export type AccountId = OpaqueId<"AccountId">;
export type WorkspaceId = OpaqueId<"WorkspaceId">;
export type ProjectId = OpaqueId<"ProjectId">;
export type SourceId = OpaqueId<"SourceId">;
export type SourceFrontierUnitId = OpaqueId<"SourceFrontierUnitId">;
export type SourceObservationId = OpaqueId<"SourceObservationId">;
export type CandidateSubmissionId = OpaqueId<"CandidateSubmissionId">;
export type CandidateAssertionId = OpaqueId<"CandidateAssertionId">;
export type WorkingContextItemId = OpaqueId<"WorkingContextItemId">;
export type ContextIdentityId = OpaqueId<"ContextIdentityId">;
export type ContextRecordId = OpaqueId<"ContextRecordId">;
export type ContextRevisionId = OpaqueId<"ContextRevisionId">;
export type ActorId = OpaqueId<"ActorId">;
export type AuditEventId = OpaqueId<"AuditEventId">;
export type IdempotencyRecordId = OpaqueId<"IdempotencyRecordId">;
export type OperationId = OpaqueId<"OperationId">;
export type ProviderEventReceiptId = OpaqueId<"ProviderEventReceiptId">;
export type ProcessingUnitId = OpaqueId<"ProcessingUnitId">;
export type CorrelationId = OpaqueId<"CorrelationId">;
export type CausationId = OpaqueId<"CausationId">;
export type LeaseToken = OpaqueId<"LeaseToken">;
export type IdentityBindingId = OpaqueId<"IdentityBindingId">;
export type AuthSessionId = OpaqueId<"AuthSessionId">;
export type StepUpIntentId = OpaqueId<"StepUpIntentId">;

export function parseUuidV7<Kind extends string>(value: string, kind: Kind): OpaqueId<Kind> {
  const normalized = value.toLowerCase();
  if (!UUID_V7.test(normalized)) throw new Error(`${kind} must be a canonical UUIDv7`);
  return normalized as OpaqueId<Kind>;
}
