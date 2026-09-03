import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

async function addLifecycleColumnsAndGuards(db: Kysely<unknown>): Promise<void> {
  await sql`alter table memoid.projects
    add column display_name text,
    add column description text,
    add column lifecycle_state varchar(16),
    add column version bigint,
    add column updated_at timestamptz,
    add column archived_at timestamptz`.execute(db);
  await sql`update memoid.projects set
      display_name = 'Untitled project', lifecycle_state = 'ACTIVE', version = 1,
      updated_at = created_at
    where display_name is null`.execute(db);
  await sql`alter table memoid.projects
    alter column display_name set not null,
    alter column display_name set default 'Untitled project',
    alter column lifecycle_state set not null,
    alter column lifecycle_state set default 'ACTIVE',
    alter column version set not null,
    alter column version set default 1,
    alter column updated_at set not null,
    alter column updated_at set default clock_timestamp(),
    add constraint projects_display_name check (
      length(display_name) between 1 and 120 and btrim(display_name) = display_name
      and display_name !~ '[[:cntrl:]]'
    ),
    add constraint projects_description check (
      description is null or (
        length(description) between 1 and 2000 and btrim(description) = description
        and description !~ '[[:cntrl:]]'
      )
    ),
    add constraint projects_lifecycle_state check (lifecycle_state in ('ACTIVE', 'ARCHIVED')),
    add constraint projects_version_positive check (version > 0),
    add constraint projects_archive_shape check (
      (lifecycle_state = 'ACTIVE' and archived_at is null)
      or (lifecycle_state = 'ARCHIVED' and archived_at is not null)
    )`.execute(db);

  await sql`create function memoid.guard_personal_workspace_ownership() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin
      if new.id <> old.id or new.account_id <> old.account_id or new.created_at <> old.created_at then
        raise exception 'Personal Workspace ownership is immutable in V1';
      end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger workspaces_ownership_guard before update on memoid.workspaces
    for each row execute function memoid.guard_personal_workspace_ownership()`.execute(db);

  await sql`create function memoid.guard_project_lifecycle_update() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin
      if new.id <> old.id or new.workspace_id <> old.workspace_id or new.created_at <> old.created_at then
        raise exception 'Project identity and ownership are immutable';
      end if;
      new.version := old.version + 1;
      new.updated_at := clock_timestamp();
      return new;
    end $$`.execute(db);
  await sql`create trigger projects_lifecycle_update_guard before update on memoid.projects
    for each row execute function memoid.guard_project_lifecycle_update()`.execute(db);

  await sql`insert into memoid.project_review_policy_versions (
      workspace_id, project_id, version, policy, effective_at, changed_by_account_id
    )
    select p.workspace_id, p.id, 1, 'MANUAL', p.created_at, w.account_id
      from memoid.projects p join memoid.workspaces w on w.id = p.workspace_id
      where not exists (
        select 1 from memoid.project_review_policy_versions v
        where v.workspace_id = p.workspace_id and v.project_id = p.id
      )`.execute(db);

  await sql`create function memoid.require_initial_project_policy() returns trigger
    language plpgsql as $$
    begin
      -- Owners may load historical fixtures and maintenance data. Product callers
      -- cannot bypass the atomic create_project path.
      if session_user <> 'memoid_app' then return null; end if;
      if not exists (
        select 1 from memoid.project_review_policy_versions v
        where v.workspace_id = new.workspace_id and v.project_id = new.id and v.version = 1
      ) then raise exception 'Project requires review policy version 1 in its creation transaction'; end if;
      return null;
    end $$`.execute(db);
  await sql`create constraint trigger projects_require_initial_policy
    after insert on memoid.projects deferrable initially deferred
    for each row execute function memoid.require_initial_project_policy()`.execute(db);

  await sql`create index projects_workspace_inventory_idx
    on memoid.projects (workspace_id, created_at desc, id desc)`.execute(db);
  await sql`revoke all on function
      memoid.guard_personal_workspace_ownership(),
      memoid.guard_project_lifecycle_update(),
      memoid.require_initial_project_policy()
    from public, memoid_app, memoid_auth`.execute(db);
}

async function extendIdempotencyForProjectCreation(db: Kysely<unknown>): Promise<void> {
  await sql`alter table memoid.idempotency_records
    drop constraint idempotency_records_scope_unique,
    alter column project_id drop not null,
    add constraint idempotency_records_scope_unique
      unique nulls not distinct (workspace_id, project_id, actor_id, action_key, idempotency_key_hash),
    add constraint idempotency_records_project_creation_scope check (
      project_id is not null or action_key = 'PROJECT_CREATE'
    )`.execute(db);
  await sql`alter table memoid.idempotency_records disable trigger idempotency_records_update_guard`.execute(
    db,
  );
  await sql`update memoid.idempotency_records set project_id = null
    where action_key = 'PROJECT_CREATE' and state = 'COMPLETED'`.execute(db);
  await sql`alter table memoid.idempotency_records enable trigger idempotency_records_update_guard`.execute(
    db,
  );

  await sql`create or replace function memoid.guard_idempotency_update() returns trigger
    language plpgsql as $$
    begin
      if old.state in ('COMPLETED', 'FAILED_TERMINAL') then
        raise exception 'terminal idempotency record is immutable';
      end if;
      if new.workspace_id <> old.workspace_id or new.id <> old.id
        or new.actor_id <> old.actor_id or new.action_key <> old.action_key
        or new.idempotency_key_hash <> old.idempotency_key_hash
        or new.request_fingerprint <> old.request_fingerprint or new.created_at <> old.created_at
        or new.correlation_id <> old.correlation_id or new.causation_id is distinct from old.causation_id
        or new.expires_at <> old.expires_at
      then raise exception 'idempotency identity and request fingerprint are immutable'; end if;
      if new.project_id is distinct from old.project_id then
        raise exception 'idempotency Project scope is immutable';
      end if;
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

  await sql`create or replace function memoid.claim_idempotency(
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
        where workspace_id = p_workspace_id and project_id is not distinct from p_project_id
          and actor_id = p_actor_id and action_key = p_action_key
          and idempotency_key_hash = p_idempotency_key_hash
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
        where workspace_id = p_workspace_id and project_id is not distinct from p_project_id
          and id = record_row.id;
      return query select 'RETRY_CLAIMED'::text, record_row.id, new_token, 'IN_PROGRESS'::text, null::text;
    end;
    $$`.execute(db);

  await sql`create or replace function memoid.finish_idempotency(
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
        where workspace_id = p_workspace_id and project_id is not distinct from p_project_id
          and id = p_record_id for update;
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
          where workspace_id = p_workspace_id and project_id is not distinct from p_project_id
            and id = p_record_id;
      elsif p_resolution = 'FAILED_RETRYABLE' then
        if p_next_retry_at is null or p_next_retry_at < now_at then raise exception 'retryable idempotency failure requires a future retry time'; end if;
        update memoid.idempotency_records set state = 'FAILED_RETRYABLE', claim_token = null,
          claim_expires_at = null, next_retry_at = p_next_retry_at,
          result_metadata = p_result_metadata, failure_code = coalesce(p_failure_code, 'UNCLASSIFIED_FAILURE'),
          state_changed_at = now_at
          where workspace_id = p_workspace_id and project_id is not distinct from p_project_id
            and id = p_record_id;
      else
        update memoid.idempotency_records set state = 'FAILED_TERMINAL', claim_token = null,
          claim_expires_at = null, result_metadata = p_result_metadata,
          failure_code = coalesce(p_failure_code, 'UNCLASSIFIED_FAILURE'), state_changed_at = now_at
          where workspace_id = p_workspace_id and project_id is not distinct from p_project_id
            and id = p_record_id;
      end if;
      return p_resolution;
    end;
    $$`.execute(db);
}

async function createLifecycleFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create or replace function memoid.has_project_scope(p_workspace_id uuid, p_project_id uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, memoid as $$
    select p_project_id = memoid.current_project_id()
      and memoid.has_workspace_scope(p_workspace_id)
      and exists (select 1 from memoid.projects p
        where p.workspace_id = p_workspace_id and p.id = p_project_id
          and p.lifecycle_state = 'ACTIVE') $$`.execute(db);
  await sql`drop policy workspace_scope on memoid.workspaces`.execute(db);
  await sql`create policy workspace_scope on memoid.workspaces
    using (current_user = 'memoid_owner' or (
      account_id = memoid.current_account_id()
      and (memoid.current_workspace_id() is null or id = memoid.current_workspace_id())
    ))
    with check (current_user = 'memoid_owner' or (
      account_id = memoid.current_account_id() and id = memoid.current_workspace_id()
    ))`.execute(db);

  await sql`drop policy project_scope on memoid.projects`.execute(db);
  await sql`create policy project_scope on memoid.projects
    using (current_user = 'memoid_owner' or (
      memoid.has_workspace_scope(workspace_id)
      and (memoid.current_project_id() is null or (
        id = memoid.current_project_id() and lifecycle_state = 'ACTIVE'
      ))
    ))
    with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, id))`.execute(
    db,
  );

  await sql`drop policy project_scope on memoid.project_review_policy_versions`.execute(db);
  await sql`create policy project_scope on memoid.project_review_policy_versions
    using (current_user = 'memoid_owner' or (
      memoid.has_workspace_scope(workspace_id)
      and (memoid.current_project_id() is null or project_id = memoid.current_project_id())
    ))
    with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))`.execute(
    db,
  );

  await sql`create function memoid.create_project(
      p_session_token_hash bytea, p_display_name text, p_description text, p_review_policy varchar,
      p_idempotency_key_hash bytea, p_request_fingerprint bytea,
      p_correlation_id uuid, p_causation_id uuid default null
    ) returns table (project_id uuid, project_version bigint, replayed boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      workspace_row memoid.workspaces%rowtype;
      actor_row memoid.actors%rowtype;
      claim_row record;
      created_project memoid.projects%rowtype;
      chosen_policy varchar := coalesce(p_review_policy, 'MANUAL');
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'LIFECYCLE_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32
        or p_display_name is null or length(p_display_name) not between 1 and 120
        or btrim(p_display_name) <> p_display_name or p_display_name ~ '[[:cntrl:]]'
        or (p_description is not null and (
          length(p_description) not between 1 and 2000 or btrim(p_description) <> p_description
          or p_description ~ '[[:cntrl:]]'
        )) then raise exception 'INVALID_PROJECT_INPUT'; end if;
      if chosen_policy not in ('MANUAL', 'AUTOMATIC') then raise exception 'INVALID_REVIEW_POLICY'; end if;
      if octet_length(p_idempotency_key_hash) <> 32 or octet_length(p_request_fingerprint) <> 32
        or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
      then raise exception 'INVALID_PROJECT_REQUEST_EVIDENCE'; end if;

      select w.* into workspace_row from memoid.workspaces w
        join memoid.account_security_states s on s.account_id = w.account_id
        join memoid.auth_sessions auth_session on auth_session.account_id = w.account_id
          and auth_session.token_hash = p_session_token_hash
        join memoid.account_identity_bindings binding on binding.account_id = w.account_id
          and binding.id = auth_session.identity_binding_id
        where w.id = memoid.current_workspace_id()
          and w.account_id = memoid.current_account_id() and s.disabled_at is null
          and auth_session.revoked_at is null
          and auth_session.security_epoch = s.security_epoch
          and now_at < auth_session.absolute_expires_at
          and now_at < auth_session.idle_expires_at
          and now_at < auth_session.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified
        for update of w, s, auth_session, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into actor_row from memoid.actors
        where workspace_id = workspace_row.id and id = memoid.current_actor_id()
          and actor_kind = 'HUMAN'
          and actor_reference = 'account:' || workspace_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;

      select * into claim_row from memoid.claim_idempotency(
        workspace_row.id, null, actor_row.id, 'PROJECT_CREATE', p_idempotency_key_hash,
        p_request_fingerprint, p_correlation_id, p_causation_id, 60, now_at + interval '24 hours'
      );
      if claim_row.claim_outcome = 'CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome = 'IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome = 'TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome = 'REPLAY' then
        select * into created_project from memoid.projects
          where workspace_id = workspace_row.id
            and id = claim_row.stable_result_reference::uuid
            and lifecycle_state = 'ACTIVE';
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select created_project.id, created_project.version, true;
        return;
      end if;

      insert into memoid.projects (workspace_id, display_name, description)
        values (workspace_row.id, p_display_name, p_description)
        returning * into created_project;
      perform set_config('memoid.project_id', created_project.id::text, true);
      insert into memoid.project_review_policy_versions (
        workspace_id, project_id, version, policy, effective_at, changed_by_account_id
      ) values (
        workspace_row.id, created_project.id, 1, chosen_policy, now_at, workspace_row.account_id
      );
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at,
        target_type, target_key, correlation_id, causation_id, idempotency_record_id,
        outcome, metadata
      ) values
        (workspace_row.id, created_project.id, actor_row.id, 'PRODUCT', 'PROJECT_CREATED', now_at,
          'PROJECT', created_project.id::text, p_correlation_id, p_causation_id,
          null, 'SUCCESS',
          jsonb_build_object('LIFECYCLE_STATE', 'ACTIVE',
            'IDEMPOTENCY_RECORD_ID', claim_row.idempotency_record_id::text)),
        (workspace_row.id, created_project.id, actor_row.id, 'PRODUCT',
          'PROJECT_REVIEW_POLICY_ESTABLISHED', now_at, 'PROJECT', created_project.id::text,
          p_correlation_id, p_causation_id, null, 'SUCCESS',
          jsonb_build_object('POLICY', chosen_policy, 'POLICY_VERSION', 1,
            'IDEMPOTENCY_RECORD_ID', claim_row.idempotency_record_id::text)),
        (workspace_row.id, created_project.id, actor_row.id, 'PRODUCT',
          'PROJECT_LIFECYCLE_ESTABLISHED', now_at, 'PROJECT', created_project.id::text,
          p_correlation_id, p_causation_id, null, 'SUCCESS',
          jsonb_build_object('LIFECYCLE_STATE', 'ACTIVE',
            'IDEMPOTENCY_RECORD_ID', claim_row.idempotency_record_id::text));
      perform memoid.finish_idempotency(
        workspace_row.id, null, claim_row.idempotency_record_id,
        claim_row.active_claim_token, 'COMPLETED', 'PROJECT', created_project.id::text,
        null, sha256(convert_to(created_project.id::text, 'UTF8')), 201,
        jsonb_build_object('REPLAYABLE', true), null, null
      );
      return query select created_project.id, created_project.version, false;
    end;
    $$`.execute(db);

  await sql`create function memoid.update_project_metadata(
      p_session_token_hash bytea, p_project_id uuid, p_expected_version bigint, p_display_name text,
      p_description text, p_correlation_id uuid
    ) returns table (project_id uuid, project_version bigint)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      workspace_row memoid.workspaces%rowtype;
      actor_row memoid.actors%rowtype;
      project_row memoid.projects%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'LIFECYCLE_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32
        or p_project_id is distinct from memoid.current_project_id()
        or p_expected_version < 1 or not memoid.is_uuid_v7(p_correlation_id)
        or p_display_name is null or length(p_display_name) not between 1 and 120
        or btrim(p_display_name) <> p_display_name or p_display_name ~ '[[:cntrl:]]'
        or (p_description is not null and (
          length(p_description) not between 1 and 2000 or btrim(p_description) <> p_description
          or p_description ~ '[[:cntrl:]]'
        )) then raise exception 'INVALID_PROJECT_INPUT'; end if;
      select w.* into workspace_row from memoid.workspaces w
        join memoid.account_security_states s on s.account_id = w.account_id
        join memoid.auth_sessions auth_session on auth_session.account_id = w.account_id
          and auth_session.token_hash = p_session_token_hash
        join memoid.account_identity_bindings binding on binding.account_id = w.account_id
          and binding.id = auth_session.identity_binding_id
        where w.id = memoid.current_workspace_id()
          and w.account_id = memoid.current_account_id() and s.disabled_at is null
          and auth_session.revoked_at is null
          and auth_session.security_epoch = s.security_epoch
          and now_at < auth_session.absolute_expires_at
          and now_at < auth_session.idle_expires_at
          and now_at < auth_session.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified
        for update of w, s, auth_session, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into actor_row from memoid.actors
        where workspace_id = workspace_row.id and id = memoid.current_actor_id()
          and actor_kind = 'HUMAN'
          and actor_reference = 'account:' || workspace_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;
      select * into project_row from memoid.projects
        where workspace_id = workspace_row.id and id = p_project_id for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state <> 'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      if project_row.version <> p_expected_version then raise exception 'STALE_PROJECT_VERSION'; end if;
      update memoid.projects set display_name = p_display_name, description = p_description
        where workspace_id = workspace_row.id and id = p_project_id returning * into project_row;
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at,
        target_type, target_key, correlation_id, outcome, metadata
      ) values (
        workspace_row.id, project_row.id, actor_row.id, 'PRODUCT', 'PROJECT_METADATA_CHANGED',
        now_at, 'PROJECT', project_row.id::text, p_correlation_id, 'SUCCESS',
        jsonb_build_object('PROJECT_VERSION', project_row.version)
      );
      return query select project_row.id, project_row.version;
    end;
    $$`.execute(db);

  await sql`revoke all on function
      memoid.create_project(bytea,text,text,varchar,bytea,bytea,uuid,uuid),
      memoid.update_project_metadata(bytea,uuid,bigint,text,text,uuid)
    from public`.execute(db);
  await sql`grant execute on function
      memoid.create_project(bytea,text,text,varchar,bytea,bytea,uuid,uuid),
      memoid.update_project_metadata(bytea,uuid,bigint,text,text,uuid)
    to memoid_app`.execute(db);
}

async function restoreStage10bIdempotency(db: Kysely<unknown>): Promise<void> {
  await sql`create or replace function memoid.guard_idempotency_update() returns trigger
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

  await sql`create or replace function memoid.claim_idempotency(
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

  await sql`create or replace function memoid.finish_idempotency(
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

export const stage10dWorkspaceProjectMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await addLifecycleColumnsAndGuards(db);
    await extendIdempotencyForProjectCreation(db);
    await createLifecycleFunctions(db);
    await sql`comment on schema memoid is 'Memoid product schema with personal Workspace and private Project lifecycle through Stage 10D'`.execute(
      db,
    );
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`revoke all on function
        memoid.create_project(bytea,text,text,varchar,bytea,bytea,uuid,uuid),
        memoid.update_project_metadata(bytea,uuid,bigint,text,text,uuid)
      from public, memoid_app`.execute(db);
    await sql`drop function memoid.create_project(bytea,text,text,varchar,bytea,bytea,uuid,uuid),
      memoid.update_project_metadata(bytea,uuid,bigint,text,text,uuid)`.execute(db);
    await sql`drop policy workspace_scope on memoid.workspaces`.execute(db);
    await sql`create policy workspace_scope on memoid.workspaces
      using (current_user = 'memoid_owner'
        or (id = memoid.current_workspace_id() and account_id = memoid.current_account_id()))
      with check (current_user = 'memoid_owner'
        or (id = memoid.current_workspace_id() and account_id = memoid.current_account_id()))`.execute(
      db,
    );
    await sql`drop policy project_scope on memoid.projects`.execute(db);
    await sql`create policy project_scope on memoid.projects
      using (current_user = 'memoid_owner' or (memoid.has_workspace_scope(workspace_id)
        and (memoid.current_project_id() is null or id = memoid.current_project_id())))
      with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, id))`.execute(
      db,
    );
    await sql`drop policy project_scope on memoid.project_review_policy_versions`.execute(db);
    await sql`create policy project_scope on memoid.project_review_policy_versions
      using (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))
      with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))`.execute(
      db,
    );
    await sql`create or replace function memoid.has_project_scope(p_workspace_id uuid, p_project_id uuid) returns boolean
      language sql stable security definer set search_path = pg_catalog, memoid as $$
      select p_project_id = memoid.current_project_id()
        and memoid.has_workspace_scope(p_workspace_id)
        and exists (select 1 from memoid.projects p
          where p.workspace_id = p_workspace_id and p.id = p_project_id) $$`.execute(db);
    await sql`drop trigger projects_require_initial_policy on memoid.projects`.execute(db);
    await sql`drop function memoid.require_initial_project_policy()`.execute(db);
    await sql`drop trigger projects_lifecycle_update_guard on memoid.projects`.execute(db);
    await sql`drop function memoid.guard_project_lifecycle_update()`.execute(db);
    await sql`drop trigger workspaces_ownership_guard on memoid.workspaces`.execute(db);
    await sql`drop function memoid.guard_personal_workspace_ownership()`.execute(db);
    await sql`drop index memoid.projects_workspace_inventory_idx`.execute(db);
    await sql`alter table memoid.projects
      drop constraint projects_display_name,
      drop constraint projects_description,
      drop constraint projects_lifecycle_state,
      drop constraint projects_version_positive,
      drop constraint projects_archive_shape,
      drop column display_name,
      drop column description,
      drop column lifecycle_state,
      drop column version,
      drop column updated_at,
      drop column archived_at`.execute(db);
    await sql`alter table memoid.idempotency_records
      drop constraint idempotency_records_project_creation_scope,
      drop constraint idempotency_records_scope_unique`.execute(db);
    await sql`alter table memoid.idempotency_records disable trigger idempotency_records_update_guard`.execute(
      db,
    );
    await sql`update memoid.idempotency_records set project_id = result_reference::uuid
      where project_id is null and action_key = 'PROJECT_CREATE' and state = 'COMPLETED'`.execute(
      db,
    );
    await sql`alter table memoid.idempotency_records enable trigger idempotency_records_update_guard`.execute(
      db,
    );
    await sql`alter table memoid.idempotency_records
      alter column project_id set not null,
      add constraint idempotency_records_scope_unique
        unique (workspace_id, project_id, actor_id, action_key, idempotency_key_hash)`.execute(db);
    await restoreStage10bIdempotency(db);
    await sql`comment on schema memoid is 'Memoid product schema with application-primary authorization and forced transaction-scoped RLS defense in depth'`.execute(
      db,
    );
    await sql`reset role`.execute(db);
  },
};
