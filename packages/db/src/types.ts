import type { ColumnType, Generated, JSONColumnType } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, never>;
type RequiredTimestamp = ColumnType<Date, Date | string, never>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, never>;
type Int8 = ColumnType<string, string | number, string | number>;
type GeneratedInt8 = ColumnType<string, string | number | undefined, string | number>;
type Hash = ColumnType<Buffer, Buffer, never>;
type NullableHash = ColumnType<Buffer | null, Buffer | null | undefined, never>;
type Json = JSONColumnType<Readonly<Record<string, unknown>>>;
type JsonArray = JSONColumnType<ReadonlyArray<Readonly<Record<string, unknown>>>>;

interface ScopedRow {
  workspace_id: string;
  project_id: string;
}

export interface TenantProbeTable {
  id: string;
  tenant_id: string;
  payload: string;
}

export interface AccountsTable {
  id: Generated<string>;
  created_at: Timestamp;
}

export interface WorkspacesTable {
  id: Generated<string>;
  account_id: string;
  created_at: Timestamp;
}

export interface ProjectsTable {
  id: Generated<string>;
  workspace_id: string;
  created_at: Timestamp;
}

export interface ProjectReviewPolicyVersionsTable extends ScopedRow {
  version: Int8;
  policy: "MANUAL" | "AUTOMATIC";
  effective_at: RequiredTimestamp;
  recorded_at: Timestamp;
  changed_by_account_id: string;
}

export interface SourcesTable extends ScopedRow {
  id: Generated<string>;
  source_kind: string;
  created_at: Timestamp;
}

export interface SourceFrontierUnitsTable extends ScopedRow {
  id: Generated<string>;
  source_id: string;
  scope_key: string;
  ref_key: string;
  created_at: Timestamp;
}

export interface SourceObservationsTable extends ScopedRow {
  id: Generated<string>;
  frontier_unit_id: string;
  observation_sequence: Int8;
  external_revision: string;
  observed_at: RequiredTimestamp;
  effective_at: NullableTimestamp;
  payload_hash: NullableHash;
  metadata: Json;
  created_at: Timestamp;
}

export interface SourceFrontierStatesTable extends ScopedRow {
  frontier_unit_id: string;
  observed_sequence: Int8 | null;
  desired_sequence: Int8 | null;
  ingested_sequence: Int8 | null;
  reconciled_sequence: Int8 | null;
  recorded_at: Timestamp;
}

export interface CandidateFrontierStatesTable extends ScopedRow {
  last_accepted_sequence: GeneratedInt8;
  reconciled_through_sequence: GeneratedInt8;
  recorded_at: Timestamp;
}

export interface CandidateSubmissionsTable extends ScopedRow {
  id: Generated<string>;
  submission_sequence: Int8;
  submitted_at: RequiredTimestamp;
  accepted_at: Timestamp;
  payload_hash: Hash;
  base_context_revision_sequence: Int8 | null;
  source_frontier_basis: JsonArray;
}

export interface CandidateAssertionsTable extends ScopedRow {
  id: Generated<string>;
  candidate_submission_id: string;
  assertion_ordinal: number;
  origin_kind: "USER_AUTHORED" | "AI_INFERRED" | "SOURCE_DERIVED" | "SYSTEM_DERIVED";
  confirmation_kind: "NONE" | "EXPLICIT_USER";
  confirmed_by_account_id: string | null;
  confirmed_at: NullableTimestamp;
  assertion_payload: Json;
  assertion_hash: Hash;
  created_at: Timestamp;
}

export interface CandidateStableDispositionsTable extends ScopedRow {
  submission_sequence: Int8;
  candidate_submission_id: string;
  disposition_key: string;
  stable_at: Timestamp;
}

export interface ContextIdentitiesTable extends ScopedRow {
  id: Generated<string>;
  subject_key: string;
  scope_key: string;
  facet_key: string;
  predicate_key: string;
  created_at: Timestamp;
}

export interface WorkingContextItemsTable extends ScopedRow {
  id: Generated<string>;
  context_identity_id: string | null;
  candidate_assertion_id: string;
  trust_qualification: "PENDING_UNRECONCILED" | "RECONCILED_UNREVIEWED";
  assertion_payload: Json;
  assertion_hash: Hash;
  governing_review_policy_version: Int8 | null;
  recorded_at: Timestamp;
  reconciled_at: NullableTimestamp;
}

export interface ContextRevisionsTable extends ScopedRow {
  id: Generated<string>;
  revision_sequence: Int8;
  review_policy_version: Int8;
  decision_mode: "MANUAL" | "AUTOMATIC";
  applied_by_account_id: string | null;
  applied_at: Timestamp;
}

export interface ContextRecordsTable extends ScopedRow {
  id: Generated<string>;
  context_identity_id: string;
  context_revision_id: string;
  assertion_payload: Json;
  assertion_hash: Hash;
  reviewed_at: RequiredTimestamp;
  created_at: Timestamp;
}

export interface ContextIdentityCurrentRecordsTable extends ScopedRow {
  context_identity_id: string;
  context_record_id: string;
  established_by_revision_id: string;
  established_at: Timestamp;
}

export interface ContextRecordCandidateProvenanceTable extends ScopedRow {
  context_record_id: string;
  candidate_assertion_id: string;
  relation_kind: "ORIGINATES" | "SUPPORTS" | "CONTRADICTS";
  created_at: Timestamp;
}

export interface ContextRecordSourceProvenanceTable extends ScopedRow {
  context_record_id: string;
  source_observation_id: string;
  relation_kind: "ORIGINATES" | "SUPPORTS" | "CONTRADICTS";
  created_at: Timestamp;
}

export interface ContextRecordSourceCoverageTable extends ScopedRow {
  context_record_id: string;
  frontier_unit_id: string;
  covered_observation_sequence: Int8;
  recorded_at: Timestamp;
}

export interface ActorsTable {
  id: Generated<string>;
  workspace_id: string;
  actor_kind:
    | "HUMAN"
    | "MEMOID_SYSTEM"
    | "MEMOID_WORKER"
    | "INTEGRATION"
    | "DEVELOPER_CLIENT"
    | "SOURCE_SYSTEM";
  actor_reference: string;
  display_label: string;
  created_at: Timestamp;
}

export interface OperationsTable extends ScopedRow {
  id: Generated<string>;
  initiating_actor_id: string;
  operation_kind: string;
  state:
    | "PENDING"
    | "RUNNING"
    | "RETRY_WAIT"
    | "CANCELLATION_REQUESTED"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";
  correlation_id: Generated<string>;
  causation_id: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: NullableTimestamp;
  lease_token: string | null;
  lease_owner_actor_id: string | null;
  lease_expires_at: NullableTimestamp;
  progress_stage: string | null;
  authorization_basis_hash: NullableHash;
  authorization_checked_at: NullableTimestamp;
  failure_code: string | null;
  failure_metadata: Json;
  created_at: Timestamp;
  started_at: NullableTimestamp;
  state_changed_at: Timestamp;
  terminal_at: NullableTimestamp;
}

export interface OperationAttemptsTable extends ScopedRow {
  id: Generated<string>;
  operation_id: string;
  attempt_number: number;
  worker_actor_id: string;
  lease_token: string;
  acquired_at: Timestamp;
  lease_expires_at: RequiredTimestamp;
  finished_at: NullableTimestamp;
  outcome: "SUCCEEDED" | "RETRY_SCHEDULED" | "FAILED" | "CANCELLED" | "LEASE_EXPIRED" | null;
  failure_code: string | null;
  failure_metadata: Json;
}

export interface IdempotencyRecordsTable extends ScopedRow {
  id: Generated<string>;
  actor_id: string;
  action_key: string;
  idempotency_key_hash: Hash;
  request_fingerprint: Hash;
  correlation_id: Generated<string>;
  causation_id: string | null;
  state: "IN_PROGRESS" | "COMPLETED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
  claim_token: string | null;
  claim_expires_at: NullableTimestamp;
  attempt_count: number;
  next_retry_at: NullableTimestamp;
  result_kind: string | null;
  result_reference: string | null;
  result_operation_id: string | null;
  response_fingerprint: NullableHash;
  result_status_code: number | null;
  result_metadata: Json;
  failure_code: string | null;
  created_at: Timestamp;
  state_changed_at: Timestamp;
  expires_at: RequiredTimestamp;
}

export interface ProviderEventReceiptsTable extends ScopedRow {
  id: Generated<string>;
  received_by_actor_id: string;
  provider_key: string;
  receipt_scope_key: string;
  external_delivery_id: string;
  payload_hash: Hash;
  validation_state: "UNVALIDATED" | "AUTHENTICATED" | "REJECTED";
  disposition:
    "PENDING" | "PROCESSING" | "PROCESSED" | "IGNORED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
  provider_occurred_at: NullableTimestamp;
  received_at: RequiredTimestamp;
  first_seen_at: Timestamp;
  correlation_id: Generated<string>;
  causation_id: string | null;
  operation_id: string | null;
  attempt_count: number;
  next_attempt_at: NullableTimestamp;
  metadata: Json;
  failure_code: string | null;
  state_changed_at: Timestamp;
}

export interface ProcessingUnitsTable extends ScopedRow {
  id: Generated<string>;
  unit_kind: string;
  unit_key: string;
  desired_sequence: GeneratedInt8;
  processed_sequence: GeneratedInt8;
  follow_up_required: boolean;
  lease_token: string | null;
  lease_owner_actor_id: string | null;
  lease_target_sequence: Int8 | null;
  lease_expires_at: NullableTimestamp;
  attempt_count: number;
  next_attempt_at: NullableTimestamp;
  correlation_id: Generated<string>;
  causation_id: string | null;
  failure_code: string | null;
  failure_metadata: Json;
  created_at: Timestamp;
  state_changed_at: Timestamp;
}

export interface AuditEventsTable extends ScopedRow {
  id: Generated<string>;
  actor_id: string;
  actor_kind_snapshot: string;
  actor_reference_snapshot: string;
  actor_label_snapshot: string;
  category: "SECURITY" | "DATA_INTEGRITY" | "OPERATION" | "INTEGRATION" | "SYSTEM" | "PRODUCT";
  event_type: string;
  occurred_at: RequiredTimestamp;
  recorded_at: Timestamp;
  target_type: string;
  target_key: string;
  correlation_id: string;
  causation_id: string | null;
  operation_id: string | null;
  provider_event_receipt_id: string | null;
  idempotency_record_id: string | null;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "CANCELLED" | "PARTIAL";
  failure_code: string | null;
  metadata: Json;
}

export interface MemoidDatabase {
  "foundation.tenant_probe": TenantProbeTable;
  "memoid.accounts": AccountsTable;
  "memoid.workspaces": WorkspacesTable;
  "memoid.projects": ProjectsTable;
  "memoid.project_review_policy_versions": ProjectReviewPolicyVersionsTable;
  "memoid.sources": SourcesTable;
  "memoid.source_frontier_units": SourceFrontierUnitsTable;
  "memoid.source_observations": SourceObservationsTable;
  "memoid.source_frontier_states": SourceFrontierStatesTable;
  "memoid.candidate_frontier_states": CandidateFrontierStatesTable;
  "memoid.candidate_submissions": CandidateSubmissionsTable;
  "memoid.candidate_assertions": CandidateAssertionsTable;
  "memoid.candidate_stable_dispositions": CandidateStableDispositionsTable;
  "memoid.context_identities": ContextIdentitiesTable;
  "memoid.working_context_items": WorkingContextItemsTable;
  "memoid.context_revisions": ContextRevisionsTable;
  "memoid.context_records": ContextRecordsTable;
  "memoid.context_identity_current_records": ContextIdentityCurrentRecordsTable;
  "memoid.context_record_candidate_provenance": ContextRecordCandidateProvenanceTable;
  "memoid.context_record_source_provenance": ContextRecordSourceProvenanceTable;
  "memoid.context_record_source_coverage": ContextRecordSourceCoverageTable;
  "memoid.actors": ActorsTable;
  "memoid.operations": OperationsTable;
  "memoid.operation_attempts": OperationAttemptsTable;
  "memoid.idempotency_records": IdempotencyRecordsTable;
  "memoid.provider_event_receipts": ProviderEventReceiptsTable;
  "memoid.processing_units": ProcessingUnitsTable;
  "memoid.audit_events": AuditEventsTable;
}

/** Compatibility alias retained for the pre-product foundation integration tests. */
export type FoundationDatabase = MemoidDatabase;
