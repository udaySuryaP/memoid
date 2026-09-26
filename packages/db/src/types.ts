import type { ColumnType, Generated, JSONColumnType } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, never>;
type RequiredTimestamp = ColumnType<Date, Date | string, never>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, never>;
type Int8 = ColumnType<string, string | number, string | number>;
type GeneratedInt8 = ColumnType<string, string | number | undefined, string | number>;
type NullableInt8 = ColumnType<string | null, string | number | null | undefined, never>;
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

export interface AccountIdentityBindingsTable {
  id: Generated<string>;
  account_id: string;
  provider_key: string;
  provider_subject: string;
  normalized_email: string;
  email_verified: boolean;
  state: "ACTIVE" | "DISABLED" | "DELETED";
  created_at: Timestamp;
  updated_at: Timestamp;
  disabled_at: NullableTimestamp;
}

export interface AccountSecurityStatesTable {
  account_id: string;
  security_epoch: Int8;
  disabled_at: NullableTimestamp;
  updated_at: Timestamp;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  account_id: string;
  identity_binding_id: string;
  token_hash: Hash;
  provider_session_id: string;
  security_epoch: Int8;
  created_at: RequiredTimestamp;
  last_activity_at: RequiredTimestamp;
  absolute_expires_at: RequiredTimestamp;
  idle_expires_at: RequiredTimestamp;
  provider_verified_until: RequiredTimestamp;
  provider_expires_at: RequiredTimestamp;
  fresh_authenticated_at: RequiredTimestamp;
  rotated_from_session_id: string | null;
  revoked_at: NullableTimestamp;
  revocation_reason: string | null;
}

export interface AuthStepUpIntentsTable {
  id: Generated<string>;
  account_id: string;
  auth_session_id: string;
  nonce_hash: Hash;
  action_key: string;
  workspace_id: string | null;
  project_id: string | null;
  return_path: string;
  correlation_id: string;
  created_at: Timestamp;
  expires_at: RequiredTimestamp;
  consumed_at: NullableTimestamp;
}

export interface AccountSecurityEventsTable {
  id: Generated<string>;
  account_id: string;
  event_type: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  target_type: string;
  target_key: string;
  correlation_id: string;
  failure_code: string | null;
  metadata: Json;
  occurred_at: RequiredTimestamp;
  recorded_at: Timestamp;
}

export interface WorkspacesTable {
  id: Generated<string>;
  account_id: string;
  created_at: Timestamp;
}

export interface ProjectsTable {
  id: Generated<string>;
  workspace_id: string;
  display_name: string;
  description: string | null;
  lifecycle_state: "ACTIVE" | "ARCHIVED";
  version: GeneratedInt8;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: NullableTimestamp;
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

export interface GitHubConnectionIntentsTable extends ScopedRow {
  id: Generated<string>;
  auth_session_id: string;
  actor_id: string;
  state_hash: Hash;
  phase: "SETUP" | "SELECTION";
  installation_id: string | null;
  correlation_id: string;
  created_at: Timestamp;
  expires_at: RequiredTimestamp;
  consumed_at: NullableTimestamp;
}

export interface GitHubRepositoryCandidatesTable extends ScopedRow {
  intent_id: string;
  repository_id: string;
  app_id: string;
  installation_id: string;
  account_id: string;
  owner_login: string;
  repository_name: string;
  full_name: string;
  html_url: string;
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL";
  default_branch: string;
  verified_at: RequiredTimestamp;
  expires_at: RequiredTimestamp;
}

export interface GitHubSourceConnectionsTable extends ScopedRow {
  source_id: string;
  provider_key: "GITHUB";
  app_id: string;
  installation_id: string;
  account_id: string;
  repository_id: string;
  owner_login: string;
  repository_name: string;
  full_name: string;
  html_url: string;
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL";
  default_branch: string;
  connection_state:
    | "ACTIVE"
    | "VERIFICATION_REQUIRED"
    | "SUSPENDED"
    | "INSTALLATION_DELETED"
    | "REPOSITORY_ACCESS_REMOVED"
    | "REPOSITORY_DELETED";
  verified_at: RequiredTimestamp;
  provider_occurred_at: NullableTimestamp;
  state_changed_at: Timestamp;
  created_at: Timestamp;
}

export interface GitHubProviderLifecycleFencesTable {
  scope_key: string;
  app_id: string;
  installation_id: string;
  repository_id: string | null;
  connection_state: Exclude<GitHubSourceConnectionsTable["connection_state"], "ACTIVE">;
  external_delivery_id: string;
  payload_hash: Hash;
  provider_occurred_at: NullableTimestamp;
  recorded_at: Timestamp;
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

export interface EvidenceReferencesTable extends ScopedRow {
  id: Generated<string>;
  source_id: string;
  frontier_unit_id: string;
  source_observation_id: string;
  observation_sequence: Int8;
  evidence_kind: "FILE" | "RENAMED_FILE" | "DELETION";
  repository_revision: string;
  repository_path: string;
  previous_repository_path: string | null;
  provider_object_id: string | null;
  byte_size: NullableInt8;
  content_sha256: NullableHash;
  structural_locator: string | null;
  created_at: Timestamp;
}

export interface SourceIngestionDispositionsTable extends ScopedRow {
  frontier_unit_id: string;
  observation_sequence: Int8;
  source_observation_id: string;
  disposition: "INGESTED" | "COALESCED" | "REF_DELETED";
  covered_by_observation_id: string | null;
  processed_by_actor_id: string;
  lease_token: string;
  recorded_at: Timestamp;
}

export interface SourceAuthorityScopesTable extends ScopedRow {
  id: Generated<string>;
  authority_category: string;
  authority_facet: string;
  scope_kind: "PROJECT" | "PATH_PREFIX";
  scope_key: string;
  ref_selector: "ANY_REF" | "DEFAULT_BRANCH" | "EXACT_REF";
  ref_key: string | null;
  version: GeneratedInt8;
  current_assignment_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SourceAuthorityAssignmentsTable extends ScopedRow {
  id: Generated<string>;
  authority_scope_id: string;
  assignment_version: Int8;
  source_id: string;
  source_default_ref_snapshot: string | null;
  effective_at: RequiredTimestamp;
  reason_key: string;
  reason_note: string | null;
  created_by_actor_id: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_record_id: string;
  supersedes_assignment_id: string | null;
  created_at: Timestamp;
}

export interface SourceAuthorityAssignmentEndingsTable extends ScopedRow {
  id: Generated<string>;
  authority_scope_id: string;
  ended_assignment_id: string;
  ending_version: Int8;
  ending_kind: "SUPERSEDED" | "REVOKED";
  successor_assignment_id: string | null;
  ended_at: RequiredTimestamp;
  reason_key: string;
  reason_note: string | null;
  ended_by_actor_id: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_record_id: string;
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

export interface IntegrityConflictsTable extends ScopedRow {
  id: Generated<string>;
  context_identity_id: string;
  created_at: Timestamp;
}

export interface ConflictOccurrencesTable extends ScopedRow {
  id: Generated<string>;
  conflict_id: string;
  context_identity_id: string;
  occurrence_version: Int8;
  lifecycle_state: "ACTIVE" | "ENDED";
  classification_key: "MATERIAL_CONTRADICTION";
  participant_set_hash: Hash;
  ending_reason:
    "INPUTS_NO_LONGER_CONFLICT" | "PARTICIPANTS_SUPERSEDED" | "REVIEWED_RESOLUTION" | null;
  resolved_by_context_revision_id: string | null;
  recorded_by_actor_id: string;
  idempotency_record_id: string;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: Timestamp;
}

export interface ConflictParticipantsTable extends ScopedRow {
  conflict_id: string;
  conflict_occurrence_id: string;
  participant_ordinal: number;
  participant_kind: "SOURCE_EVIDENCE" | "WORKING_CONTEXT" | "REVIEWED_CONTEXT";
  evidence_reference_id: string | null;
  working_context_item_id: string | null;
  context_record_id: string | null;
  source_id: string | null;
  effective_authority_assignment_id: string | null;
  source_qualification: string | null;
  claim_fingerprint: Hash;
  recorded_at: Timestamp;
}

export interface ConflictCurrentStatesTable extends ScopedRow {
  conflict_id: string;
  current_occurrence_id: string;
  occurrence_version: Int8;
  lifecycle_state: "ACTIVE" | "ENDED";
  updated_at: Timestamp;
}

export interface IntegrityUncertaintiesTable extends ScopedRow {
  id: Generated<string>;
  context_identity_id: string;
  target_kind: "SEMANTIC_IDENTITY" | "SOURCE_EVIDENCE" | "WORKING_CONTEXT" | "REVIEWED_CONTEXT";
  evidence_reference_id: string | null;
  working_context_item_id: string | null;
  context_record_id: string | null;
  created_at: Timestamp;
}

export interface UncertaintyOccurrencesTable extends ScopedRow {
  id: Generated<string>;
  uncertainty_id: string;
  context_identity_id: string;
  occurrence_version: Int8;
  lifecycle_state: "ACTIVE" | "ENDED";
  reason_key: string | null;
  basis_evidence_reference_id: string | null;
  source_qualification: string | null;
  ending_reason: string | null;
  resolved_by_context_revision_id: string | null;
  recorded_by_actor_id: string;
  idempotency_record_id: string;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: Timestamp;
}

export interface UncertaintyCurrentStatesTable extends ScopedRow {
  uncertainty_id: string;
  current_occurrence_id: string;
  occurrence_version: Int8;
  lifecycle_state: "ACTIVE" | "ENDED";
  updated_at: Timestamp;
}

export interface ReconciliationRecordsTable extends ScopedRow {
  id: Generated<string>;
  candidate_assertion_id: string;
  context_identity_id: string;
  basis_hash: Hash;
  current_context_record_id: string | null;
  current_context_version: Int8;
  working_context_version: Int8;
  authority_version: Int8;
  evidence_frontier_version: Int8;
  integrity_version: Int8;
  engine_contract_version: string;
  schema_version: string;
  prompt_version: string;
  compaction_version: string;
  normalization_version: string;
  decision_path: "DETERMINISTIC" | "MODEL";
  classification:
    "NEW" | "CHANGED" | "SUPERSEDED" | "CONFLICTING" | "OBSOLETE" | "UNCERTAIN" | "UNCHANGED";
  semantic_identity: string;
  normalized_assertion: Json | null;
  evidence_reference_ids: JsonArray;
  conflict_indicated: boolean;
  uncertainty_indicated: boolean;
  reason_codes: JsonArray;
  bounded_justification: string | null;
  working_context_item_id: string | null;
  operation_id: string | null;
  recorded_by_actor_id: string;
  recorded_at: Timestamp;
}

export interface ReconciliationCurrentStatesTable extends ScopedRow {
  candidate_assertion_id: string;
  reconciliation_id: string;
  basis_hash: Hash;
  updated_at: Timestamp;
}

export interface ModelInvocationAttemptsTable extends ScopedRow {
  id: Generated<string>;
  candidate_assertion_id: string;
  basis_hash: Hash;
  provider_id: string;
  model_id: string;
  configuration_version: string;
  pricing_version: string | null;
  attempt_number: number;
  input_units: Int8;
  output_units: Int8;
  total_units: Int8;
  estimated_cost_microunits: Int8 | null;
  latency_ms: number;
  succeeded: boolean;
  failure_code: string | null;
  invoked_at: Timestamp;
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

export interface IdempotencyRecordsTable {
  workspace_id: string;
  project_id: string | null;
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
  "memoid.account_identity_bindings": AccountIdentityBindingsTable;
  "memoid.account_security_states": AccountSecurityStatesTable;
  "memoid.auth_sessions": AuthSessionsTable;
  "memoid.auth_step_up_intents": AuthStepUpIntentsTable;
  "memoid.account_security_events": AccountSecurityEventsTable;
  "memoid.workspaces": WorkspacesTable;
  "memoid.projects": ProjectsTable;
  "memoid.project_review_policy_versions": ProjectReviewPolicyVersionsTable;
  "memoid.sources": SourcesTable;
  "memoid.github_connection_intents": GitHubConnectionIntentsTable;
  "memoid.github_repository_candidates": GitHubRepositoryCandidatesTable;
  "memoid.github_source_connections": GitHubSourceConnectionsTable;
  "memoid.github_provider_lifecycle_fences": GitHubProviderLifecycleFencesTable;
  "memoid.source_frontier_units": SourceFrontierUnitsTable;
  "memoid.source_observations": SourceObservationsTable;
  "memoid.source_frontier_states": SourceFrontierStatesTable;
  "memoid.evidence_references": EvidenceReferencesTable;
  "memoid.source_ingestion_dispositions": SourceIngestionDispositionsTable;
  "memoid.source_authority_scopes": SourceAuthorityScopesTable;
  "memoid.source_authority_assignments": SourceAuthorityAssignmentsTable;
  "memoid.source_authority_assignment_endings": SourceAuthorityAssignmentEndingsTable;
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
  "memoid.integrity_conflicts": IntegrityConflictsTable;
  "memoid.conflict_occurrences": ConflictOccurrencesTable;
  "memoid.conflict_participants": ConflictParticipantsTable;
  "memoid.conflict_current_states": ConflictCurrentStatesTable;
  "memoid.integrity_uncertainties": IntegrityUncertaintiesTable;
  "memoid.uncertainty_occurrences": UncertaintyOccurrencesTable;
  "memoid.uncertainty_current_states": UncertaintyCurrentStatesTable;
  "memoid.reconciliation_records": ReconciliationRecordsTable;
  "memoid.reconciliation_current_states": ReconciliationCurrentStatesTable;
  "memoid.model_invocation_attempts": ModelInvocationAttemptsTable;
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
