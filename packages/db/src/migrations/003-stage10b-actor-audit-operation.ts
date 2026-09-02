import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

async function createSanitizedMetadataContract(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.is_sanitized_metadata(input_metadata jsonb) returns boolean
    language plpgsql immutable strict parallel safe
    as $$
    declare
      entry record;
      array_item jsonb;
      key_count integer := 0;
    begin
      if jsonb_typeof(input_metadata) <> 'object' or octet_length(input_metadata::text) > 8192 then return false; end if;
      for entry in select metadata_entry.key, metadata_entry.value
        from jsonb_each(input_metadata) as metadata_entry(key, value) loop
        key_count := key_count + 1;
        if key_count > 32
          or entry.key !~ '^[A-Z][A-Z0-9_]{0,63}$'
          or entry.key ~* '(AUTHORIZATION|COOKIE|PASSWORD|PASSCODE|TOKEN|SECRET|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|REFRESH|SESSION|CREDENTIAL|RAW_?PAYLOAD|PROMPT|TRANSCRIPT|REPOSITORY_?BLOB|EXCEPTION|STACK)'
        then return false; end if;
        if jsonb_typeof(entry.value) = 'string' then
          if length(entry.value #>> '{}') > 512 then return false; end if;
        elsif jsonb_typeof(entry.value) = 'array' then
          if jsonb_array_length(entry.value) > 16 then return false; end if;
          for array_item in select item from jsonb_array_elements(entry.value) as items(item) loop
            if jsonb_typeof(array_item) not in ('string', 'number', 'boolean', 'null') then return false; end if;
            if jsonb_typeof(array_item) = 'string' and length(array_item #>> '{}') > 512 then return false; end if;
          end loop;
        elsif jsonb_typeof(entry.value) not in ('number', 'boolean', 'null') then
          return false;
        end if;
      end loop;
      return true;
    end;
    $$`.execute(db);
}

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.actors (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null references memoid.workspaces(id),
    actor_kind varchar(32) not null,
    actor_reference varchar(256) not null,
    display_label varchar(256) not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint actors_id_v7 check (memoid.is_uuid_v7(id)),
    constraint actors_kind check (actor_kind in ('HUMAN', 'MEMOID_SYSTEM', 'MEMOID_WORKER', 'INTEGRATION', 'DEVELOPER_CLIENT', 'SOURCE_SYSTEM')),
    constraint actors_reference check (actor_reference ~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'),
    constraint actors_display_label check (length(btrim(display_label)) between 1 and 256),
    constraint actors_workspace_id_unique unique (workspace_id, id),
    constraint actors_workspace_identity_unique unique (workspace_id, actor_kind, actor_reference)
  )`.execute(db);

  await sql`create table memoid.operations (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    initiating_actor_id uuid not null,
    operation_kind varchar(64) not null,
    state varchar(32) not null default 'PENDING',
    correlation_id uuid not null default uuidv7(),
    causation_id uuid,
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    next_attempt_at timestamptz,
    lease_token uuid,
    lease_owner_actor_id uuid,
    lease_expires_at timestamptz,
    progress_stage varchar(64),
    authorization_basis_hash bytea,
    authorization_checked_at timestamptz,
    failure_code varchar(64),
    failure_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default clock_timestamp(),
    started_at timestamptz,
    state_changed_at timestamptz not null default clock_timestamp(),
    terminal_at timestamptz,
    constraint operations_id_v7 check (memoid.is_uuid_v7(id)),
    constraint operations_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint operations_initiator_fk foreign key (workspace_id, initiating_actor_id)
      references memoid.actors(workspace_id, id),
    constraint operations_lease_owner_fk foreign key (workspace_id, lease_owner_actor_id)
      references memoid.actors(workspace_id, id),
    constraint operations_kind check (operation_kind ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint operations_state check (state in ('PENDING', 'RUNNING', 'RETRY_WAIT', 'CANCELLATION_REQUESTED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    constraint operations_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint operations_causation_v7 check (causation_id is null or memoid.is_uuid_v7(causation_id)),
    constraint operations_attempts check (attempt_count >= 0 and max_attempts between 1 and 100 and attempt_count <= max_attempts),
    constraint operations_retry_time check ((state = 'RETRY_WAIT') = (next_attempt_at is not null)),
    constraint operations_lease_shape check (
      (state in ('RUNNING', 'CANCELLATION_REQUESTED')) =
      (lease_token is not null and lease_owner_actor_id is not null and lease_expires_at is not null)
    ),
    constraint operations_lease_token_v7 check (lease_token is null or memoid.is_uuid_v7(lease_token)),
    constraint operations_progress check (progress_stage is null or progress_stage ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint operations_authorization_hash check (authorization_basis_hash is null or octet_length(authorization_basis_hash) = 32),
    constraint operations_failure_code check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint operations_failure_metadata check (memoid.is_sanitized_metadata(failure_metadata)),
    constraint operations_terminal_time check ((state in ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (terminal_at is not null)),
    constraint operations_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.operation_attempts (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    operation_id uuid not null,
    attempt_number integer not null,
    worker_actor_id uuid not null,
    lease_token uuid not null,
    acquired_at timestamptz not null default clock_timestamp(),
    lease_expires_at timestamptz not null,
    finished_at timestamptz,
    outcome varchar(32),
    failure_code varchar(64),
    failure_metadata jsonb not null default '{}'::jsonb,
    constraint operation_attempts_id_v7 check (memoid.is_uuid_v7(id)),
    constraint operation_attempts_operation_fk foreign key (workspace_id, project_id, operation_id)
      references memoid.operations(workspace_id, project_id, id),
    constraint operation_attempts_worker_fk foreign key (workspace_id, worker_actor_id)
      references memoid.actors(workspace_id, id),
    constraint operation_attempts_number check (attempt_number > 0),
    constraint operation_attempts_lease_v7 check (memoid.is_uuid_v7(lease_token)),
    constraint operation_attempts_outcome check (outcome is null or outcome in ('SUCCEEDED', 'RETRY_SCHEDULED', 'FAILED', 'CANCELLED', 'LEASE_EXPIRED')),
    constraint operation_attempts_completion check ((finished_at is null and outcome is null) or (finished_at is not null and outcome is not null)),
    constraint operation_attempts_failure_code check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint operation_attempts_failure_metadata check (memoid.is_sanitized_metadata(failure_metadata)),
    constraint operation_attempts_number_unique unique (workspace_id, project_id, operation_id, attempt_number),
    constraint operation_attempts_lease_unique unique (workspace_id, project_id, operation_id, lease_token)
  )`.execute(db);

  await sql`create table memoid.idempotency_records (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    actor_id uuid not null,
    action_key varchar(64) not null,
    idempotency_key_hash bytea not null,
    request_fingerprint bytea not null,
    correlation_id uuid not null default uuidv7(),
    causation_id uuid,
    state varchar(32) not null default 'IN_PROGRESS',
    claim_token uuid,
    claim_expires_at timestamptz,
    attempt_count integer not null default 1,
    next_retry_at timestamptz,
    result_kind varchar(64),
    result_reference varchar(512),
    result_operation_id uuid,
    response_fingerprint bytea,
    result_status_code integer,
    result_metadata jsonb not null default '{}'::jsonb,
    failure_code varchar(64),
    created_at timestamptz not null default clock_timestamp(),
    state_changed_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null,
    constraint idempotency_records_id_v7 check (memoid.is_uuid_v7(id)),
    constraint idempotency_records_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint idempotency_records_actor_fk foreign key (workspace_id, actor_id)
      references memoid.actors(workspace_id, id),
    constraint idempotency_records_operation_fk foreign key (workspace_id, project_id, result_operation_id)
      references memoid.operations(workspace_id, project_id, id),
    constraint idempotency_records_action check (action_key ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint idempotency_records_key_hash check (octet_length(idempotency_key_hash) = 32),
    constraint idempotency_records_request_hash check (octet_length(request_fingerprint) = 32),
    constraint idempotency_records_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint idempotency_records_causation_v7 check (causation_id is null or memoid.is_uuid_v7(causation_id)),
    constraint idempotency_records_state check (state in ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL')),
    constraint idempotency_records_claim_v7 check (claim_token is null or memoid.is_uuid_v7(claim_token)),
    constraint idempotency_records_claim_shape check ((state = 'IN_PROGRESS') = (claim_token is not null and claim_expires_at is not null)),
    constraint idempotency_records_attempts check (attempt_count > 0),
    constraint idempotency_records_retry_shape check ((state = 'FAILED_RETRYABLE') = (next_retry_at is not null)),
    constraint idempotency_records_result_shape check (
      (state = 'COMPLETED') = (result_kind is not null and result_reference is not null and result_status_code is not null)
    ),
    constraint idempotency_records_result_kind check (result_kind is null or result_kind ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint idempotency_records_response_hash check (response_fingerprint is null or octet_length(response_fingerprint) = 32),
    constraint idempotency_records_status_code check (result_status_code is null or result_status_code between 100 and 599),
    constraint idempotency_records_metadata check (memoid.is_sanitized_metadata(result_metadata)),
    constraint idempotency_records_failure_code check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint idempotency_records_expiry check (expires_at > created_at),
    constraint idempotency_records_scope_unique unique (workspace_id, project_id, actor_id, action_key, idempotency_key_hash),
    constraint idempotency_records_project_id_unique unique (workspace_id, project_id, id),
    constraint idempotency_records_operation_unique unique (workspace_id, project_id, result_operation_id)
  )`.execute(db);

  await sql`create table memoid.provider_event_receipts (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    received_by_actor_id uuid not null,
    provider_key varchar(64) not null,
    receipt_scope_key varchar(256) not null,
    external_delivery_id varchar(256) not null,
    payload_hash bytea not null,
    validation_state varchar(32) not null default 'UNVALIDATED',
    disposition varchar(32) not null default 'PENDING',
    provider_occurred_at timestamptz,
    received_at timestamptz not null,
    first_seen_at timestamptz not null default clock_timestamp(),
    correlation_id uuid not null default uuidv7(),
    causation_id uuid,
    operation_id uuid,
    attempt_count integer not null default 0,
    next_attempt_at timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    failure_code varchar(64),
    state_changed_at timestamptz not null default clock_timestamp(),
    constraint provider_receipts_id_v7 check (memoid.is_uuid_v7(id)),
    constraint provider_receipts_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint provider_receipts_actor_fk foreign key (workspace_id, received_by_actor_id)
      references memoid.actors(workspace_id, id),
    constraint provider_receipts_operation_fk foreign key (workspace_id, project_id, operation_id)
      references memoid.operations(workspace_id, project_id, id),
    constraint provider_receipts_provider check (provider_key ~ '^[a-z0-9][a-z0-9._:/-]{0,63}$'),
    constraint provider_receipts_scope check (receipt_scope_key ~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'),
    constraint provider_receipts_external_id check (length(btrim(external_delivery_id)) between 1 and 256),
    constraint provider_receipts_payload_hash check (octet_length(payload_hash) = 32),
    constraint provider_receipts_validation check (validation_state in ('UNVALIDATED', 'AUTHENTICATED', 'REJECTED')),
    constraint provider_receipts_disposition check (disposition in ('PENDING', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL')),
    constraint provider_receipts_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint provider_receipts_causation_v7 check (causation_id is null or memoid.is_uuid_v7(causation_id)),
    constraint provider_receipts_attempts check (attempt_count >= 0),
    constraint provider_receipts_retry_shape check ((disposition = 'FAILED_RETRYABLE') = (next_attempt_at is not null)),
    constraint provider_receipts_metadata check (memoid.is_sanitized_metadata(metadata)),
    constraint provider_receipts_failure_code check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint provider_receipts_scope_unique unique (workspace_id, project_id, provider_key, receipt_scope_key, external_delivery_id),
    constraint provider_receipts_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.processing_units (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    unit_kind varchar(64) not null,
    unit_key varchar(256) not null,
    desired_sequence bigint not null default 0,
    processed_sequence bigint not null default 0,
    follow_up_required boolean not null default false,
    lease_token uuid,
    lease_owner_actor_id uuid,
    lease_target_sequence bigint,
    lease_expires_at timestamptz,
    attempt_count integer not null default 0,
    next_attempt_at timestamptz,
    correlation_id uuid not null default uuidv7(),
    causation_id uuid,
    failure_code varchar(64),
    failure_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default clock_timestamp(),
    state_changed_at timestamptz not null default clock_timestamp(),
    constraint processing_units_id_v7 check (memoid.is_uuid_v7(id)),
    constraint processing_units_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint processing_units_lease_owner_fk foreign key (workspace_id, lease_owner_actor_id)
      references memoid.actors(workspace_id, id),
    constraint processing_units_kind check (unit_kind ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint processing_units_key check (unit_key ~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'),
    constraint processing_units_frontier check (desired_sequence >= 0 and processed_sequence >= 0 and processed_sequence <= desired_sequence),
    constraint processing_units_follow_up check (follow_up_required = (desired_sequence > processed_sequence)),
    constraint processing_units_lease_shape check (
      (lease_token is null and lease_owner_actor_id is null and lease_target_sequence is null and lease_expires_at is null)
      or
      (lease_token is not null and lease_owner_actor_id is not null and lease_target_sequence is not null and lease_expires_at is not null)
    ),
    constraint processing_units_lease_v7 check (lease_token is null or memoid.is_uuid_v7(lease_token)),
    constraint processing_units_lease_target check (lease_target_sequence is null or (lease_target_sequence > processed_sequence and lease_target_sequence <= desired_sequence)),
    constraint processing_units_attempts check (attempt_count >= 0),
    constraint processing_units_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint processing_units_causation_v7 check (causation_id is null or memoid.is_uuid_v7(causation_id)),
    constraint processing_units_failure_code check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint processing_units_failure_metadata check (memoid.is_sanitized_metadata(failure_metadata)),
    constraint processing_units_identity_unique unique (workspace_id, project_id, unit_kind, unit_key),
    constraint processing_units_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.audit_events (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    actor_id uuid not null,
    actor_kind_snapshot varchar(32) not null,
    actor_reference_snapshot varchar(256) not null,
    actor_label_snapshot varchar(256) not null,
    category varchar(32) not null,
    event_type varchar(64) not null,
    occurred_at timestamptz not null,
    recorded_at timestamptz not null default clock_timestamp(),
    target_type varchar(64) not null,
    target_key varchar(512) not null,
    correlation_id uuid not null,
    causation_id uuid,
    operation_id uuid,
    provider_event_receipt_id uuid,
    idempotency_record_id uuid,
    outcome varchar(32) not null,
    failure_code varchar(64),
    metadata jsonb not null default '{}'::jsonb,
    constraint audit_events_id_v7 check (memoid.is_uuid_v7(id)),
    constraint audit_events_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint audit_events_actor_fk foreign key (workspace_id, actor_id)
      references memoid.actors(workspace_id, id),
    constraint audit_events_operation_fk foreign key (workspace_id, project_id, operation_id)
      references memoid.operations(workspace_id, project_id, id),
    constraint audit_events_receipt_fk foreign key (workspace_id, project_id, provider_event_receipt_id)
      references memoid.provider_event_receipts(workspace_id, project_id, id),
    constraint audit_events_idempotency_fk foreign key (workspace_id, project_id, idempotency_record_id)
      references memoid.idempotency_records(workspace_id, project_id, id),
    constraint audit_events_actor_kind check (actor_kind_snapshot in ('HUMAN', 'MEMOID_SYSTEM', 'MEMOID_WORKER', 'INTEGRATION', 'DEVELOPER_CLIENT', 'SOURCE_SYSTEM')),
    constraint audit_events_category check (category in ('SECURITY', 'DATA_INTEGRITY', 'OPERATION', 'INTEGRATION', 'SYSTEM', 'PRODUCT')),
    constraint audit_events_type check (event_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint audit_events_target_type check (target_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint audit_events_target_key check (length(btrim(target_key)) between 1 and 512),
    constraint audit_events_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint audit_events_causation_v7 check (causation_id is null or memoid.is_uuid_v7(causation_id)),
    constraint audit_events_outcome check (outcome in ('SUCCESS', 'FAILURE', 'DENIED', 'CANCELLED', 'PARTIAL')),
    constraint audit_events_failure_code check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint audit_events_metadata check (memoid.is_sanitized_metadata(metadata))
  )`.execute(db);
}

async function createGuardsAndAttribution(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.reject_history_change() returns trigger
    language plpgsql as $$
    begin
      raise exception 'immutable history row %.% cannot be %', tg_table_schema, tg_table_name, lower(tg_op);
    end;
    $$`.execute(db);
  for (const tableName of ["actors", "audit_events"] as const) {
    await sql
      .raw(
        `create trigger ${tableName}_history_guard before update or delete on memoid.${tableName}
      for each row execute function memoid.reject_history_change()`,
      )
      .execute(db);
  }

  await sql`create function memoid.guard_operation_update() returns trigger
    language plpgsql as $$
    begin
      if old.state in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
        raise exception 'terminal Operation cannot be changed';
      end if;
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.id <> old.id
        or new.initiating_actor_id <> old.initiating_actor_id or new.operation_kind <> old.operation_kind
        or new.correlation_id <> old.correlation_id or new.causation_id is distinct from old.causation_id
        or new.created_at <> old.created_at or new.max_attempts <> old.max_attempts
      then raise exception 'Operation identity and basis are immutable'; end if;
      if new.state <> old.state and not (
        (old.state = 'PENDING' and new.state in ('RUNNING', 'CANCELLED'))
        or (old.state = 'RUNNING' and new.state in ('SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'CANCELLATION_REQUESTED'))
        or (old.state = 'RETRY_WAIT' and new.state in ('RUNNING', 'CANCELLED'))
        or (old.state = 'CANCELLATION_REQUESTED' and new.state = 'CANCELLED')
      ) then raise exception 'illegal Operation transition % -> %', old.state, new.state; end if;
      if new.attempt_count < old.attempt_count or new.attempt_count > old.attempt_count + 1 then
        raise exception 'Operation attempt count must advance one at a time';
      end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger operations_update_guard before update on memoid.operations
    for each row execute function memoid.guard_operation_update()`.execute(db);

  await sql`create function memoid.guard_operation_attempt_update() returns trigger
    language plpgsql as $$
    begin
      if old.finished_at is not null then raise exception 'completed Operation attempt is immutable'; end if;
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.id <> old.id
        or new.operation_id <> old.operation_id or new.attempt_number <> old.attempt_number
        or new.worker_actor_id <> old.worker_actor_id or new.lease_token <> old.lease_token
        or new.acquired_at <> old.acquired_at
      then raise exception 'Operation attempt identity is immutable'; end if;
      if new.lease_expires_at < old.lease_expires_at then raise exception 'Operation attempt lease cannot shrink'; end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger operation_attempts_update_guard before update on memoid.operation_attempts
    for each row execute function memoid.guard_operation_attempt_update()`.execute(db);
  await sql`create trigger operation_attempts_delete_guard before delete on memoid.operation_attempts
    for each row execute function memoid.reject_history_change()`.execute(db);

  await sql`create function memoid.guard_idempotency_update() returns trigger
    language plpgsql as $$
    begin
      if old.state in ('COMPLETED', 'FAILED_TERMINAL') then
        raise exception 'terminal idempotency record is immutable';
      end if;
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.id <> old.id
        or new.actor_id <> old.actor_id or new.action_key <> old.action_key
        or new.idempotency_key_hash <> old.idempotency_key_hash
        or new.request_fingerprint <> old.request_fingerprint or new.created_at <> old.created_at
        or new.correlation_id <> old.correlation_id or new.causation_id is distinct from old.causation_id
        or new.expires_at <> old.expires_at
      then raise exception 'idempotency identity and request fingerprint are immutable'; end if;
      if new.state <> old.state and not (
        (old.state = 'IN_PROGRESS' and new.state in ('COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'))
        or (old.state = 'FAILED_RETRYABLE' and new.state = 'IN_PROGRESS')
      ) then raise exception 'illegal idempotency transition % -> %', old.state, new.state; end if;
      if new.attempt_count < old.attempt_count or new.attempt_count > old.attempt_count + 1 then
        raise exception 'idempotency attempt count must advance one at a time';
      end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger idempotency_records_update_guard before update on memoid.idempotency_records
    for each row execute function memoid.guard_idempotency_update()`.execute(db);

  await sql`create function memoid.guard_provider_receipt_update() returns trigger
    language plpgsql as $$
    begin
      if old.disposition in ('PROCESSED', 'IGNORED', 'FAILED_TERMINAL') then
        raise exception 'terminal provider receipt is immutable';
      end if;
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.id <> old.id
        or new.received_by_actor_id <> old.received_by_actor_id or new.provider_key <> old.provider_key
        or new.receipt_scope_key <> old.receipt_scope_key or new.external_delivery_id <> old.external_delivery_id
        or new.payload_hash <> old.payload_hash or new.provider_occurred_at is distinct from old.provider_occurred_at
        or new.received_at <> old.received_at or new.first_seen_at <> old.first_seen_at
        or new.correlation_id <> old.correlation_id or new.causation_id is distinct from old.causation_id
        or new.metadata <> old.metadata
      then raise exception 'provider receipt identity and evidence metadata are immutable'; end if;
      if old.validation_state <> new.validation_state and not (
        old.validation_state = 'UNVALIDATED' and new.validation_state in ('AUTHENTICATED', 'REJECTED')
      ) then raise exception 'illegal provider receipt validation transition'; end if;
      if old.operation_id is not null and new.operation_id is distinct from old.operation_id then
        raise exception 'provider receipt Operation linkage cannot change';
      end if;
      if new.disposition <> old.disposition and not (
        (old.disposition = 'PENDING' and new.disposition in ('PROCESSING', 'IGNORED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'))
        or (old.disposition = 'PROCESSING' and new.disposition in ('PROCESSED', 'IGNORED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'))
        or (old.disposition = 'FAILED_RETRYABLE' and new.disposition = 'PROCESSING')
      ) then raise exception 'illegal provider receipt disposition transition % -> %', old.disposition, new.disposition; end if;
      if new.attempt_count < old.attempt_count or new.attempt_count > old.attempt_count + 1 then
        raise exception 'provider receipt attempt count must advance one at a time';
      end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger provider_receipts_update_guard before update on memoid.provider_event_receipts
    for each row execute function memoid.guard_provider_receipt_update()`.execute(db);

  await sql`create function memoid.guard_processing_unit_update() returns trigger
    language plpgsql as $$
    begin
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.id <> old.id
        or new.unit_kind <> old.unit_kind or new.unit_key <> old.unit_key
        or new.correlation_id <> old.correlation_id or new.causation_id is distinct from old.causation_id
        or new.created_at <> old.created_at
      then raise exception 'processing unit identity is immutable'; end if;
      if new.desired_sequence < old.desired_sequence or new.processed_sequence < old.processed_sequence then
        raise exception 'processing frontiers cannot move backwards';
      end if;
      if new.attempt_count < old.attempt_count or new.attempt_count > old.attempt_count + 1 then
        raise exception 'processing attempt count must advance one at a time';
      end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger processing_units_update_guard before update on memoid.processing_units
    for each row execute function memoid.guard_processing_unit_update()`.execute(db);

  await sql`create function memoid.populate_audit_actor_snapshot_and_validate_links() returns trigger
    language plpgsql as $$
    declare
      actor_row memoid.actors%rowtype;
    begin
      select * into actor_row from memoid.actors
        where workspace_id = new.workspace_id and id = new.actor_id;
      if not found then raise exception 'Audit Event Actor is outside the Workspace'; end if;
      new.actor_kind_snapshot := actor_row.actor_kind;
      new.actor_reference_snapshot := actor_row.actor_reference;
      new.actor_label_snapshot := actor_row.display_label;
      if new.operation_id is not null and not exists (
        select 1 from memoid.operations where workspace_id = new.workspace_id and project_id = new.project_id
          and id = new.operation_id and correlation_id = new.correlation_id
      ) then raise exception 'Audit Event Operation correlation mismatch'; end if;
      if new.provider_event_receipt_id is not null and not exists (
        select 1 from memoid.provider_event_receipts where workspace_id = new.workspace_id and project_id = new.project_id
          and id = new.provider_event_receipt_id and correlation_id = new.correlation_id
      ) then raise exception 'Audit Event receipt correlation mismatch'; end if;
      if new.idempotency_record_id is not null and not exists (
        select 1 from memoid.idempotency_records where workspace_id = new.workspace_id and project_id = new.project_id
          and id = new.idempotency_record_id and correlation_id = new.correlation_id
      ) then raise exception 'Audit Event idempotency scope mismatch'; end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger audit_events_snapshot_guard before insert on memoid.audit_events
    for each row execute function memoid.populate_audit_actor_snapshot_and_validate_links()`.execute(
    db,
  );

  await sql`create function memoid.validate_receipt_operation_correlation() returns trigger
    language plpgsql as $$
    begin
      if new.operation_id is not null and not exists (
        select 1 from memoid.operations where workspace_id = new.workspace_id and project_id = new.project_id
          and id = new.operation_id and correlation_id = new.correlation_id
      ) then raise exception 'provider receipt Operation correlation mismatch'; end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger provider_receipts_operation_correlation_guard
    before insert or update on memoid.provider_event_receipts
    for each row execute function memoid.validate_receipt_operation_correlation()`.execute(db);
}

async function createReceiptRegistration(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.register_provider_event_receipt(
      p_workspace_id uuid, p_project_id uuid, p_received_by_actor_id uuid,
      p_provider_key varchar, p_receipt_scope_key varchar, p_external_delivery_id varchar,
      p_payload_hash bytea, p_validation_state varchar, p_provider_occurred_at timestamptz,
      p_received_at timestamptz, p_correlation_id uuid, p_causation_id uuid, p_metadata jsonb
    ) returns table (registration_outcome text, receipt_id uuid, receipt_correlation_id uuid)
    language plpgsql as $$
    declare
      inserted_id uuid;
      existing_id uuid;
      existing_hash bytea;
      existing_correlation uuid;
    begin
      insert into memoid.provider_event_receipts (
        workspace_id, project_id, received_by_actor_id, provider_key, receipt_scope_key,
        external_delivery_id, payload_hash, validation_state, provider_occurred_at,
        received_at, correlation_id, causation_id, metadata
      ) values (
        p_workspace_id, p_project_id, p_received_by_actor_id, p_provider_key, p_receipt_scope_key,
        p_external_delivery_id, p_payload_hash, p_validation_state, p_provider_occurred_at,
        p_received_at, p_correlation_id, p_causation_id, p_metadata
      ) on conflict (workspace_id, project_id, provider_key, receipt_scope_key, external_delivery_id)
        do nothing returning id into inserted_id;
      if inserted_id is not null then
        return query select 'CREATED'::text, inserted_id, p_correlation_id;
        return;
      end if;
      select id, payload_hash, correlation_id into existing_id, existing_hash, existing_correlation
        from memoid.provider_event_receipts
        where workspace_id = p_workspace_id and project_id = p_project_id
          and provider_key = p_provider_key and receipt_scope_key = p_receipt_scope_key
          and external_delivery_id = p_external_delivery_id
        for update;
      if existing_hash = p_payload_hash then
        return query select 'DUPLICATE'::text, existing_id, existing_correlation;
      else
        return query select 'CONFLICT'::text, existing_id, existing_correlation;
      end if;
    end;
    $$`.execute(db);
}

async function createOperationFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.acquire_operation(
      p_workspace_id uuid, p_project_id uuid, p_operation_id uuid,
      p_worker_actor_id uuid, p_lease_seconds integer
    ) returns table (was_acquired boolean, acquired_lease_token uuid, acquired_attempt integer, current_state text)
    language plpgsql as $$
    declare
      operation_row memoid.operations%rowtype;
      worker_kind varchar;
      new_token uuid;
      now_at timestamptz := clock_timestamp();
    begin
      if p_lease_seconds < 1 or p_lease_seconds > 3600 then raise exception 'invalid Operation lease duration'; end if;
      select actor_kind into worker_kind from memoid.actors
        where workspace_id = p_workspace_id and id = p_worker_actor_id;
      if worker_kind is distinct from 'MEMOID_WORKER' then raise exception 'Operation lease requires MEMOID_WORKER Actor'; end if;
      select * into operation_row from memoid.operations
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id
        for update;
      if not found then raise exception 'Operation not found in Project'; end if;
      if operation_row.state in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
        return query select false, null::uuid, operation_row.attempt_count, operation_row.state::text;
        return;
      end if;
      if operation_row.state = 'CANCELLATION_REQUESTED' then
        if operation_row.lease_expires_at > now_at then
          return query select false, null::uuid, operation_row.attempt_count, operation_row.state::text;
          return;
        end if;
        update memoid.operation_attempts set finished_at = now_at, outcome = 'CANCELLED'
          where workspace_id = p_workspace_id and project_id = p_project_id and operation_id = p_operation_id
            and attempt_number = operation_row.attempt_count and finished_at is null;
        update memoid.operations set state = 'CANCELLED', lease_token = null, lease_owner_actor_id = null,
          lease_expires_at = null, state_changed_at = now_at, terminal_at = now_at
          where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
        return query select false, null::uuid, operation_row.attempt_count, 'CANCELLED'::text;
        return;
      end if;
      if operation_row.state = 'RUNNING' and operation_row.lease_expires_at > now_at then
        return query select false, null::uuid, operation_row.attempt_count, operation_row.state::text;
        return;
      end if;
      if operation_row.state = 'RETRY_WAIT' and operation_row.next_attempt_at > now_at then
        return query select false, null::uuid, operation_row.attempt_count, operation_row.state::text;
        return;
      end if;
      if operation_row.state = 'RUNNING' then
        update memoid.operation_attempts set finished_at = now_at, outcome = 'LEASE_EXPIRED'
          where workspace_id = p_workspace_id and project_id = p_project_id and operation_id = p_operation_id
            and attempt_number = operation_row.attempt_count and finished_at is null;
      end if;
      if operation_row.attempt_count >= operation_row.max_attempts then
        update memoid.operations set state = 'FAILED', lease_token = null, lease_owner_actor_id = null,
          lease_expires_at = null, next_attempt_at = null, failure_code = 'ATTEMPTS_EXHAUSTED',
          state_changed_at = now_at, terminal_at = now_at
          where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
        return query select false, null::uuid, operation_row.attempt_count, 'FAILED'::text;
        return;
      end if;
      new_token := uuidv7();
      update memoid.operations set state = 'RUNNING', attempt_count = operation_row.attempt_count + 1,
        next_attempt_at = null, lease_token = new_token, lease_owner_actor_id = p_worker_actor_id,
        lease_expires_at = now_at + make_interval(secs => p_lease_seconds),
        started_at = coalesce(started_at, now_at), state_changed_at = now_at,
        failure_code = null, failure_metadata = '{}'::jsonb
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
      insert into memoid.operation_attempts (
        workspace_id, project_id, operation_id, attempt_number, worker_actor_id,
        lease_token, acquired_at, lease_expires_at
      ) values (
        p_workspace_id, p_project_id, p_operation_id, operation_row.attempt_count + 1,
        p_worker_actor_id, new_token, now_at, now_at + make_interval(secs => p_lease_seconds)
      );
      return query select true, new_token, operation_row.attempt_count + 1, 'RUNNING'::text;
    end;
    $$`.execute(db);

  await sql`create function memoid.renew_operation_lease(
      p_workspace_id uuid, p_project_id uuid, p_operation_id uuid,
      p_lease_token uuid, p_lease_seconds integer
    ) returns timestamptz language plpgsql as $$
    declare
      operation_row memoid.operations%rowtype;
      renewed_until timestamptz;
      now_at timestamptz := clock_timestamp();
    begin
      if p_lease_seconds < 1 or p_lease_seconds > 3600 then raise exception 'invalid Operation lease duration'; end if;
      select * into operation_row from memoid.operations
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id
        for update;
      if not found or operation_row.state not in ('RUNNING', 'CANCELLATION_REQUESTED')
        or operation_row.lease_token is distinct from p_lease_token or operation_row.lease_expires_at <= now_at
      then raise exception 'stale Operation lease'; end if;
      renewed_until := now_at + make_interval(secs => p_lease_seconds);
      update memoid.operations set lease_expires_at = renewed_until, state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
      update memoid.operation_attempts set lease_expires_at = renewed_until
        where workspace_id = p_workspace_id and project_id = p_project_id and operation_id = p_operation_id
          and attempt_number = operation_row.attempt_count and finished_at is null;
      return renewed_until;
    end;
    $$`.execute(db);

  await sql`create function memoid.finish_operation(
      p_workspace_id uuid, p_project_id uuid, p_operation_id uuid, p_lease_token uuid,
      p_resolution varchar, p_failure_code varchar, p_failure_metadata jsonb, p_next_attempt_at timestamptz
    ) returns text language plpgsql as $$
    declare
      operation_row memoid.operations%rowtype;
      final_state varchar;
      attempt_outcome varchar;
      now_at timestamptz := clock_timestamp();
    begin
      if p_resolution not in ('SUCCEEDED', 'RETRY', 'FAILED', 'CANCELLED') then raise exception 'unsupported Operation resolution'; end if;
      if not memoid.is_sanitized_metadata(p_failure_metadata) then raise exception 'unsafe Operation failure metadata'; end if;
      select * into operation_row from memoid.operations
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id
        for update;
      if not found or operation_row.state not in ('RUNNING', 'CANCELLATION_REQUESTED')
        or operation_row.lease_token is distinct from p_lease_token or operation_row.lease_expires_at <= now_at
      then raise exception 'stale Operation lease'; end if;
      if operation_row.state = 'CANCELLATION_REQUESTED' and p_resolution <> 'CANCELLED' then
        raise exception 'cancellation request requires cancellation completion';
      end if;
      if operation_row.state = 'RUNNING' and p_resolution = 'CANCELLED' then
        raise exception 'Operation cannot cancel without a cancellation request';
      end if;
      if p_resolution = 'SUCCEEDED' then
        final_state := 'SUCCEEDED'; attempt_outcome := 'SUCCEEDED';
      elsif p_resolution = 'CANCELLED' then
        final_state := 'CANCELLED'; attempt_outcome := 'CANCELLED';
      elsif p_resolution = 'RETRY' and operation_row.attempt_count < operation_row.max_attempts then
        if p_next_attempt_at is null or p_next_attempt_at < now_at then raise exception 'retry requires a future attempt time'; end if;
        final_state := 'RETRY_WAIT'; attempt_outcome := 'RETRY_SCHEDULED';
      else
        final_state := 'FAILED'; attempt_outcome := 'FAILED';
      end if;
      update memoid.operation_attempts set finished_at = now_at, outcome = attempt_outcome,
        failure_code = case when final_state in ('RETRY_WAIT', 'FAILED') then p_failure_code else null end,
        failure_metadata = case when final_state in ('RETRY_WAIT', 'FAILED') then p_failure_metadata else '{}'::jsonb end
        where workspace_id = p_workspace_id and project_id = p_project_id and operation_id = p_operation_id
          and attempt_number = operation_row.attempt_count and lease_token = p_lease_token and finished_at is null;
      update memoid.operations set state = final_state, lease_token = null, lease_owner_actor_id = null,
        lease_expires_at = null,
        next_attempt_at = case when final_state = 'RETRY_WAIT' then p_next_attempt_at else null end,
        failure_code = case when final_state in ('RETRY_WAIT', 'FAILED') then coalesce(p_failure_code, 'UNCLASSIFIED_FAILURE') else null end,
        failure_metadata = case when final_state in ('RETRY_WAIT', 'FAILED') then p_failure_metadata else '{}'::jsonb end,
        state_changed_at = now_at,
        terminal_at = case when final_state in ('SUCCEEDED', 'FAILED', 'CANCELLED') then now_at else null end
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
      return final_state;
    end;
    $$`.execute(db);

  await sql`create function memoid.request_operation_cancellation(
      p_workspace_id uuid, p_project_id uuid, p_operation_id uuid
    ) returns text language plpgsql as $$
    declare
      operation_row memoid.operations%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      select * into operation_row from memoid.operations
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id
        for update;
      if not found then raise exception 'Operation not found in Project'; end if;
      if operation_row.state in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
        raise exception 'terminal Operation cannot be cancelled';
      end if;
      if operation_row.state = 'CANCELLATION_REQUESTED' then return operation_row.state; end if;
      if operation_row.state in ('PENDING', 'RETRY_WAIT') then
        update memoid.operations set state = 'CANCELLED', next_attempt_at = null,
          state_changed_at = now_at, terminal_at = now_at
          where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
        return 'CANCELLED';
      end if;
      update memoid.operations set state = 'CANCELLATION_REQUESTED', state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_operation_id;
      return 'CANCELLATION_REQUESTED';
    end;
    $$`.execute(db);
}

async function createIdempotencyFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.claim_idempotency(
      p_workspace_id uuid, p_project_id uuid, p_actor_id uuid, p_action_key varchar,
      p_idempotency_key_hash bytea, p_request_fingerprint bytea,
      p_correlation_id uuid, p_causation_id uuid, p_claim_seconds integer, p_expires_at timestamptz
    ) returns table (
      claim_outcome text, idempotency_record_id uuid, active_claim_token uuid,
      record_state text, stable_result_reference text
    ) language plpgsql as $$
    declare
      inserted_id uuid;
      new_token uuid := uuidv7();
      record_row memoid.idempotency_records%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      if p_claim_seconds < 1 or p_claim_seconds > 3600 then raise exception 'invalid idempotency claim duration'; end if;
      if octet_length(p_idempotency_key_hash) <> 32 or octet_length(p_request_fingerprint) <> 32 then
        raise exception 'idempotency hashes must be SHA-256';
      end if;
      if p_expires_at <= now_at then raise exception 'idempotency expiry must be in the future'; end if;
      insert into memoid.idempotency_records (
        workspace_id, project_id, actor_id, action_key, idempotency_key_hash,
        request_fingerprint, correlation_id, causation_id, claim_token, claim_expires_at, expires_at
      ) values (
        p_workspace_id, p_project_id, p_actor_id, p_action_key, p_idempotency_key_hash,
        p_request_fingerprint, p_correlation_id, p_causation_id, new_token,
        now_at + make_interval(secs => p_claim_seconds), p_expires_at
      ) on conflict (workspace_id, project_id, actor_id, action_key, idempotency_key_hash)
        do nothing returning id into inserted_id;
      if inserted_id is not null then
        return query select 'CLAIMED'::text, inserted_id, new_token, 'IN_PROGRESS'::text, null::text;
        return;
      end if;
      select * into record_row from memoid.idempotency_records
        where workspace_id = p_workspace_id and project_id = p_project_id and actor_id = p_actor_id
          and action_key = p_action_key and idempotency_key_hash = p_idempotency_key_hash
        for update;
      if record_row.request_fingerprint <> p_request_fingerprint then
        return query select 'CONFLICT'::text, record_row.id, null::uuid, record_row.state::text, null::text;
        return;
      end if;
      if record_row.state = 'COMPLETED' then
        return query select 'REPLAY'::text, record_row.id, null::uuid, record_row.state::text, record_row.result_reference::text;
        return;
      end if;
      if record_row.state = 'FAILED_TERMINAL' then
        return query select 'TERMINAL_FAILURE'::text, record_row.id, null::uuid, record_row.state::text, null::text;
        return;
      end if;
      if record_row.state = 'IN_PROGRESS' and record_row.claim_expires_at > now_at then
        return query select 'IN_PROGRESS'::text, record_row.id, null::uuid, record_row.state::text, null::text;
        return;
      end if;
      if record_row.state = 'FAILED_RETRYABLE' and record_row.next_retry_at > now_at then
        return query select 'IN_PROGRESS'::text, record_row.id, null::uuid, record_row.state::text, null::text;
        return;
      end if;
      new_token := uuidv7();
      update memoid.idempotency_records set state = 'IN_PROGRESS', claim_token = new_token,
        claim_expires_at = now_at + make_interval(secs => p_claim_seconds), attempt_count = attempt_count + 1,
        next_retry_at = null, failure_code = null, state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = record_row.id;
      return query select 'RETRY_CLAIMED'::text, record_row.id, new_token, 'IN_PROGRESS'::text, null::text;
    end;
    $$`.execute(db);

  await sql`create function memoid.finish_idempotency(
      p_workspace_id uuid, p_project_id uuid, p_record_id uuid, p_claim_token uuid,
      p_resolution varchar, p_result_kind varchar, p_result_reference varchar,
      p_result_operation_id uuid, p_response_fingerprint bytea, p_result_status_code integer,
      p_result_metadata jsonb, p_failure_code varchar, p_next_retry_at timestamptz
    ) returns text language plpgsql as $$
    declare
      record_row memoid.idempotency_records%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      if p_resolution not in ('COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL') then
        raise exception 'unsupported idempotency resolution';
      end if;
      if not memoid.is_sanitized_metadata(p_result_metadata) then raise exception 'unsafe idempotency result metadata'; end if;
      select * into record_row from memoid.idempotency_records
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_record_id
        for update;
      if not found or record_row.state <> 'IN_PROGRESS'
        or record_row.claim_token is distinct from p_claim_token or record_row.claim_expires_at <= now_at
      then raise exception 'stale idempotency claim'; end if;
      if p_resolution = 'COMPLETED' then
        if p_result_kind is null or p_result_reference is null or p_result_status_code is null
          or p_response_fingerprint is null or octet_length(p_response_fingerprint) <> 32
        then raise exception 'completed idempotency result is incomplete'; end if;
        update memoid.idempotency_records set state = 'COMPLETED', claim_token = null,
          claim_expires_at = null, result_kind = p_result_kind, result_reference = p_result_reference,
          result_operation_id = p_result_operation_id, response_fingerprint = p_response_fingerprint,
          result_status_code = p_result_status_code, result_metadata = p_result_metadata,
          failure_code = null, state_changed_at = now_at
          where workspace_id = p_workspace_id and project_id = p_project_id and id = p_record_id;
      elsif p_resolution = 'FAILED_RETRYABLE' then
        if p_next_retry_at is null or p_next_retry_at < now_at then raise exception 'retryable idempotency failure requires a future retry time'; end if;
        update memoid.idempotency_records set state = 'FAILED_RETRYABLE', claim_token = null,
          claim_expires_at = null, next_retry_at = p_next_retry_at,
          result_metadata = p_result_metadata, failure_code = coalesce(p_failure_code, 'UNCLASSIFIED_FAILURE'),
          state_changed_at = now_at
          where workspace_id = p_workspace_id and project_id = p_project_id and id = p_record_id;
      else
        update memoid.idempotency_records set state = 'FAILED_TERMINAL', claim_token = null,
          claim_expires_at = null, result_metadata = p_result_metadata,
          failure_code = coalesce(p_failure_code, 'UNCLASSIFIED_FAILURE'), state_changed_at = now_at
          where workspace_id = p_workspace_id and project_id = p_project_id and id = p_record_id;
      end if;
      return p_resolution;
    end;
    $$`.execute(db);
}

async function createProcessingFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.advance_processing_desired(
      p_workspace_id uuid, p_project_id uuid, p_unit_id uuid, p_desired_sequence bigint
    ) returns bigint language plpgsql as $$
    declare
      unit_row memoid.processing_units%rowtype;
    begin
      select * into unit_row from memoid.processing_units
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id
        for update;
      if not found then raise exception 'processing unit not found in Project'; end if;
      if p_desired_sequence < unit_row.desired_sequence then raise exception 'desired processing frontier cannot move backwards'; end if;
      update memoid.processing_units set desired_sequence = p_desired_sequence,
        follow_up_required = p_desired_sequence > processed_sequence,
        state_changed_at = clock_timestamp()
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id;
      return p_desired_sequence;
    end;
    $$`.execute(db);

  await sql`create function memoid.acquire_processing_unit(
      p_workspace_id uuid, p_project_id uuid, p_unit_id uuid,
      p_worker_actor_id uuid, p_lease_seconds integer
    ) returns table (was_acquired boolean, acquired_lease_token uuid, target_sequence bigint, acquired_attempt integer)
    language plpgsql as $$
    declare
      unit_row memoid.processing_units%rowtype;
      worker_kind varchar;
      new_token uuid;
      now_at timestamptz := clock_timestamp();
    begin
      if p_lease_seconds < 1 or p_lease_seconds > 3600 then raise exception 'invalid processing lease duration'; end if;
      select actor_kind into worker_kind from memoid.actors
        where workspace_id = p_workspace_id and id = p_worker_actor_id;
      if worker_kind is distinct from 'MEMOID_WORKER' then raise exception 'processing lease requires MEMOID_WORKER Actor'; end if;
      select * into unit_row from memoid.processing_units
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id
        for update;
      if not found then raise exception 'processing unit not found in Project'; end if;
      if not unit_row.follow_up_required
        or (unit_row.next_attempt_at is not null and unit_row.next_attempt_at > now_at)
        or (unit_row.lease_token is not null and unit_row.lease_expires_at > now_at)
      then
        return query select false, null::uuid, unit_row.desired_sequence, unit_row.attempt_count;
        return;
      end if;
      new_token := uuidv7();
      update memoid.processing_units set lease_token = new_token,
        lease_owner_actor_id = p_worker_actor_id, lease_target_sequence = desired_sequence,
        lease_expires_at = now_at + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1, next_attempt_at = null,
        failure_code = null, failure_metadata = '{}'::jsonb, state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id;
      return query select true, new_token, unit_row.desired_sequence, unit_row.attempt_count + 1;
    end;
    $$`.execute(db);

  await sql`create function memoid.renew_processing_unit_lease(
      p_workspace_id uuid, p_project_id uuid, p_unit_id uuid,
      p_lease_token uuid, p_lease_seconds integer
    ) returns timestamptz language plpgsql as $$
    declare
      unit_row memoid.processing_units%rowtype;
      renewed_until timestamptz;
      now_at timestamptz := clock_timestamp();
    begin
      if p_lease_seconds < 1 or p_lease_seconds > 3600 then raise exception 'invalid processing lease duration'; end if;
      select * into unit_row from memoid.processing_units
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id
        for update;
      if not found or unit_row.lease_token is distinct from p_lease_token or unit_row.lease_expires_at <= now_at
      then raise exception 'stale processing lease'; end if;
      renewed_until := now_at + make_interval(secs => p_lease_seconds);
      update memoid.processing_units set lease_expires_at = renewed_until, state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id;
      return renewed_until;
    end;
    $$`.execute(db);

  await sql`create function memoid.complete_processing_unit(
      p_workspace_id uuid, p_project_id uuid, p_unit_id uuid,
      p_lease_token uuid, p_processed_sequence bigint
    ) returns table (processed_through bigint, current_desired bigint, follow_up_still_required boolean)
    language plpgsql as $$
    declare
      unit_row memoid.processing_units%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      select * into unit_row from memoid.processing_units
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id
        for update;
      if not found or unit_row.lease_token is distinct from p_lease_token or unit_row.lease_expires_at <= now_at
      then raise exception 'stale processing lease'; end if;
      if p_processed_sequence <> unit_row.lease_target_sequence then
        raise exception 'processing completion must match the leased target';
      end if;
      update memoid.processing_units set processed_sequence = p_processed_sequence,
        follow_up_required = desired_sequence > p_processed_sequence,
        lease_token = null, lease_owner_actor_id = null, lease_target_sequence = null,
        lease_expires_at = null, next_attempt_at = null, failure_code = null,
        failure_metadata = '{}'::jsonb, state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id;
      return query select p_processed_sequence, unit_row.desired_sequence,
        unit_row.desired_sequence > p_processed_sequence;
    end;
    $$`.execute(db);

  await sql`create function memoid.retry_processing_unit(
      p_workspace_id uuid, p_project_id uuid, p_unit_id uuid, p_lease_token uuid,
      p_next_attempt_at timestamptz, p_failure_code varchar, p_failure_metadata jsonb
    ) returns boolean language plpgsql as $$
    declare
      unit_row memoid.processing_units%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      if p_next_attempt_at <= now_at then raise exception 'processing retry requires a future attempt time'; end if;
      if not memoid.is_sanitized_metadata(p_failure_metadata) then raise exception 'unsafe processing failure metadata'; end if;
      select * into unit_row from memoid.processing_units
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id
        for update;
      if not found or unit_row.lease_token is distinct from p_lease_token or unit_row.lease_expires_at <= now_at
      then raise exception 'stale processing lease'; end if;
      update memoid.processing_units set lease_token = null, lease_owner_actor_id = null,
        lease_target_sequence = null, lease_expires_at = null, next_attempt_at = p_next_attempt_at,
        failure_code = coalesce(p_failure_code, 'UNCLASSIFIED_FAILURE'),
        failure_metadata = p_failure_metadata, state_changed_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and id = p_unit_id;
      return true;
    end;
    $$`.execute(db);
}

async function createIndexesAndPermissions(db: Kysely<unknown>): Promise<void> {
  await sql`create index operations_project_state_due_idx
    on memoid.operations (workspace_id, project_id, state, next_attempt_at, created_at)`.execute(
    db,
  );
  await sql`create index operation_attempts_operation_idx
    on memoid.operation_attempts (workspace_id, project_id, operation_id, attempt_number desc)`.execute(
    db,
  );
  await sql`create index idempotency_records_expiry_idx
    on memoid.idempotency_records (expires_at)`.execute(db);
  await sql`create index provider_receipts_received_idx
    on memoid.provider_event_receipts (workspace_id, project_id, received_at desc)`.execute(db);
  await sql`create index provider_receipts_retry_idx
    on memoid.provider_event_receipts (workspace_id, project_id, disposition, next_attempt_at)`.execute(
    db,
  );
  await sql`create index processing_units_follow_up_idx
    on memoid.processing_units (workspace_id, project_id, next_attempt_at)
    where follow_up_required`.execute(db);
  await sql`create index audit_events_project_occurred_idx
    on memoid.audit_events (workspace_id, project_id, occurred_at desc, id)`.execute(db);
  await sql`create index audit_events_correlation_idx
    on memoid.audit_events (workspace_id, project_id, correlation_id, occurred_at)`.execute(db);
  await sql`comment on table memoid.actors is 'Stable attribution identities; not authentication, authorization, OAuth metadata, or clientInfo'`.execute(
    db,
  );
  await sql`comment on table memoid.audit_events is 'Append-oriented sanitized audit history distinct from Context Revision history'`.execute(
    db,
  );
  await sql`comment on table memoid.provider_event_receipts is 'Provider-neutral durable signal receipts; no raw payload and no direct semantic mutation'`.execute(
    db,
  );
  await sql`comment on table memoid.processing_units is 'Provider-neutral desired/processed lease foundation with transactional lost-wakeup protection'`.execute(
    db,
  );
  await sql`revoke all on schema memoid from public, memoid_app`.execute(db);
  await sql`revoke all on all tables in schema memoid from public, memoid_app`.execute(db);
  await sql`revoke all on all sequences in schema memoid from public, memoid_app`.execute(db);
  await sql`revoke all on all functions in schema memoid from public, memoid_app`.execute(db);
}

export const stage10bActorAuditOperationMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createSanitizedMetadataContract(db);
    await createTables(db);
    await createGuardsAndAttribution(db);
    await createReceiptRegistration(db);
    await createOperationFunctions(db);
    await createIdempotencyFunctions(db);
    await createProcessingFunctions(db);
    await createIndexesAndPermissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`drop table if exists memoid.audit_events, memoid.processing_units, memoid.provider_event_receipts,
      memoid.idempotency_records, memoid.operation_attempts, memoid.operations, memoid.actors cascade`.execute(
      db,
    );
    await sql`drop function if exists
      memoid.register_provider_event_receipt(uuid,uuid,uuid,varchar,varchar,varchar,bytea,varchar,timestamptz,timestamptz,uuid,uuid,jsonb),
      memoid.acquire_operation(uuid,uuid,uuid,uuid,integer),
      memoid.renew_operation_lease(uuid,uuid,uuid,uuid,integer),
      memoid.finish_operation(uuid,uuid,uuid,uuid,varchar,varchar,jsonb,timestamptz),
      memoid.request_operation_cancellation(uuid,uuid,uuid),
      memoid.claim_idempotency(uuid,uuid,uuid,varchar,bytea,bytea,uuid,uuid,integer,timestamptz),
      memoid.finish_idempotency(uuid,uuid,uuid,uuid,varchar,varchar,varchar,uuid,bytea,integer,jsonb,varchar,timestamptz),
      memoid.advance_processing_desired(uuid,uuid,uuid,bigint),
      memoid.acquire_processing_unit(uuid,uuid,uuid,uuid,integer),
      memoid.renew_processing_unit_lease(uuid,uuid,uuid,uuid,integer),
      memoid.complete_processing_unit(uuid,uuid,uuid,uuid,bigint),
      memoid.retry_processing_unit(uuid,uuid,uuid,uuid,timestamptz,varchar,jsonb),
      memoid.populate_audit_actor_snapshot_and_validate_links(),
      memoid.validate_receipt_operation_correlation(),
      memoid.guard_processing_unit_update(),
      memoid.guard_provider_receipt_update(),
      memoid.guard_idempotency_update(),
      memoid.guard_operation_attempt_update(),
      memoid.guard_operation_update(),
      memoid.reject_history_change()
      cascade`.execute(db);
    await sql`drop function if exists memoid.is_sanitized_metadata(jsonb)`.execute(db);
    await sql`reset role`.execute(db);
  },
};
