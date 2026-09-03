import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const PROJECT_SCOPED_TABLES = [
  "project_review_policy_versions",
  "sources",
  "source_frontier_units",
  "source_observations",
  "source_frontier_states",
  "candidate_frontier_states",
  "candidate_submissions",
  "candidate_assertions",
  "candidate_stable_dispositions",
  "context_identities",
  "working_context_items",
  "context_revisions",
  "context_records",
  "context_identity_current_records",
  "context_record_candidate_provenance",
  "context_record_source_provenance",
  "context_record_source_coverage",
  "operations",
  "operation_attempts",
  "idempotency_records",
  "provider_event_receipts",
  "processing_units",
] as const;

async function createIdentityAndSessionTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.account_identity_bindings (
    id uuid primary key default uuidv7(),
    account_id uuid not null references memoid.accounts(id),
    provider_key varchar(64) not null,
    provider_subject varchar(256) not null,
    normalized_email varchar(320) not null,
    email_verified boolean not null,
    state varchar(16) not null default 'ACTIVE',
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    disabled_at timestamptz,
    constraint identity_bindings_id_v7 check (memoid.is_uuid_v7(id)),
    constraint identity_bindings_provider check (provider_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
    constraint identity_bindings_subject check (provider_subject ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
    constraint identity_bindings_email check (
      normalized_email = lower(btrim(normalized_email)) and
      length(normalized_email) between 3 and 320 and
      normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ),
    constraint identity_bindings_state check (state in ('ACTIVE', 'DISABLED', 'DELETED')),
    constraint identity_bindings_active_verified check (state <> 'ACTIVE' or email_verified),
    constraint identity_bindings_disabled_time check ((state = 'ACTIVE') = (disabled_at is null)),
    constraint identity_bindings_provider_subject_unique unique (provider_key, provider_subject),
    constraint identity_bindings_account_id_unique unique (account_id, id)
  )`.execute(db);
  await sql`create unique index identity_bindings_active_email_unique
    on memoid.account_identity_bindings (provider_key, normalized_email)
    where state = 'ACTIVE' and email_verified`.execute(db);

  await sql`create table memoid.account_security_states (
    account_id uuid primary key references memoid.accounts(id),
    security_epoch bigint not null default 1,
    disabled_at timestamptz,
    updated_at timestamptz not null default clock_timestamp(),
    constraint account_security_epoch_positive check (security_epoch > 0)
  )`.execute(db);

  await sql`create table memoid.auth_sessions (
    id uuid primary key default uuidv7(),
    account_id uuid not null references memoid.accounts(id),
    identity_binding_id uuid not null,
    token_hash bytea not null,
    provider_session_id varchar(256) not null,
    security_epoch bigint not null,
    created_at timestamptz not null,
    last_activity_at timestamptz not null,
    absolute_expires_at timestamptz not null,
    idle_expires_at timestamptz not null,
    provider_verified_until timestamptz not null,
    provider_expires_at timestamptz not null,
    fresh_authenticated_at timestamptz not null,
    rotated_from_session_id uuid,
    revoked_at timestamptz,
    revocation_reason varchar(64),
    constraint auth_sessions_id_v7 check (memoid.is_uuid_v7(id)),
    constraint auth_sessions_binding_fk foreign key (account_id, identity_binding_id)
      references memoid.account_identity_bindings(account_id, id),
    constraint auth_sessions_rotated_from_fk foreign key (rotated_from_session_id)
      references memoid.auth_sessions(id),
    constraint auth_sessions_token_hash check (octet_length(token_hash) = 32),
    constraint auth_sessions_provider_session check (length(btrim(provider_session_id)) between 1 and 256),
    constraint auth_sessions_security_epoch check (security_epoch > 0),
    constraint auth_sessions_time_order check (
      last_activity_at >= created_at and
      absolute_expires_at > created_at and
      idle_expires_at > created_at and idle_expires_at <= absolute_expires_at and
      provider_verified_until >= created_at and provider_verified_until <= provider_expires_at and
      provider_expires_at > created_at and
      fresh_authenticated_at <= created_at + interval '5 minutes'
    ),
    constraint auth_sessions_revocation_shape check (
      (revoked_at is null and revocation_reason is null) or
      (revoked_at is not null and revocation_reason ~ '^[A-Z][A-Z0-9_]{0,63}$')
    ),
    constraint auth_sessions_token_unique unique (token_hash),
    constraint auth_sessions_account_id_unique unique (account_id, id)
  )`.execute(db);
  await sql`create unique index auth_sessions_active_provider_session_unique
    on memoid.auth_sessions (provider_session_id) where revoked_at is null`.execute(db);

  await sql`create table memoid.auth_step_up_intents (
    id uuid primary key default uuidv7(),
    account_id uuid not null references memoid.accounts(id),
    auth_session_id uuid not null,
    nonce_hash bytea not null,
    action_key varchar(64) not null,
    workspace_id uuid,
    project_id uuid,
    return_path varchar(512) not null,
    correlation_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null,
    consumed_at timestamptz,
    constraint step_up_intents_id_v7 check (memoid.is_uuid_v7(id)),
    constraint step_up_intents_session_fk foreign key (account_id, auth_session_id)
      references memoid.auth_sessions(account_id, id),
    constraint step_up_intents_workspace_fk foreign key (workspace_id, account_id)
      references memoid.workspaces(id, account_id),
    constraint step_up_intents_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint step_up_intents_nonce check (octet_length(nonce_hash) = 32),
    constraint step_up_intents_action check (action_key ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint step_up_intents_scope check ((project_id is null) or (workspace_id is not null)),
    constraint step_up_intents_return check (return_path ~ '^/[^/]' and length(return_path) <= 512),
    constraint step_up_intents_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint step_up_intents_expiry check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
    constraint step_up_intents_nonce_unique unique (nonce_hash),
    constraint step_up_intents_account_id_unique unique (account_id, id)
  )`.execute(db);

  await sql`create table memoid.account_security_events (
    id uuid primary key default uuidv7(),
    account_id uuid not null references memoid.accounts(id),
    event_type varchar(64) not null,
    outcome varchar(16) not null,
    target_type varchar(64) not null,
    target_key varchar(256) not null,
    correlation_id uuid not null,
    failure_code varchar(64),
    metadata jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null,
    recorded_at timestamptz not null default clock_timestamp(),
    constraint account_security_events_id_v7 check (memoid.is_uuid_v7(id)),
    constraint account_security_events_type check (event_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint account_security_events_outcome check (outcome in ('SUCCESS', 'FAILURE', 'DENIED')),
    constraint account_security_events_target_type check (target_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint account_security_events_target_key check (length(btrim(target_key)) between 1 and 256),
    constraint account_security_events_correlation_v7 check (memoid.is_uuid_v7(correlation_id)),
    constraint account_security_events_failure check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint account_security_events_metadata check (memoid.is_sanitized_metadata(metadata)),
    constraint account_security_events_account_id_unique unique (account_id, id)
  )`.execute(db);
}

async function createIdentityAndSessionFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.initialize_account_security_state() returns trigger
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    begin
      insert into memoid.account_security_states (account_id) values (new.id) on conflict do nothing;
      return new;
    end $$`.execute(db);
  await sql`create trigger accounts_initialize_security_state
    after insert on memoid.accounts for each row execute function memoid.initialize_account_security_state()`.execute(
    db,
  );
  await sql`insert into memoid.account_security_states (account_id)
    select id from memoid.accounts on conflict do nothing`.execute(db);

  await sql`create function memoid.resolve_account_identity(
      p_provider_key varchar, p_provider_subject varchar, p_email varchar, p_email_verified boolean
    ) returns table (resolved_account_id uuid, resolved_binding_id uuid, resolution text)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      v_normalized_email varchar := lower(btrim(p_email));
      subject_row memoid.account_identity_bindings%rowtype;
      email_row memoid.account_identity_bindings%rowtype;
      new_account_id uuid;
      new_binding_id uuid;
    begin
      if not p_email_verified then raise exception 'EMAIL_NOT_VERIFIED'; end if;
      if p_provider_key !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        or p_provider_subject !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
        or v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        or length(v_normalized_email) > 320 then raise exception 'INVALID_IDENTITY_EVIDENCE'; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_provider_key || ':' || p_provider_subject, 1012));
      perform pg_advisory_xact_lock(hashtextextended(p_provider_key || ':' || v_normalized_email, 1013));
      select * into subject_row from memoid.account_identity_bindings
        where provider_key = p_provider_key and provider_subject = p_provider_subject for update;
      select * into email_row from memoid.account_identity_bindings
        where provider_key = p_provider_key and normalized_email = v_normalized_email
          and state = 'ACTIVE' and email_verified for update;
      if subject_row.id is not null then
        if subject_row.state <> 'ACTIVE' or not subject_row.email_verified then
          raise exception 'IDENTITY_BINDING_DISABLED';
        end if;
        if email_row.id is not null and email_row.account_id <> subject_row.account_id then
          raise exception 'IDENTITY_LINK_AMBIGUOUS';
        end if;
        if subject_row.normalized_email <> v_normalized_email then
          update memoid.account_identity_bindings set normalized_email = v_normalized_email,
            email_verified = true, updated_at = clock_timestamp()
            where id = subject_row.id;
          return query select subject_row.account_id, subject_row.id, 'UPDATED_EMAIL'::text;
        else
          return query select subject_row.account_id, subject_row.id, 'EXISTING'::text;
        end if;
        return;
      end if;
      if email_row.id is not null then raise exception 'IDENTITY_LINK_AMBIGUOUS'; end if;
      insert into memoid.accounts default values returning id into new_account_id;
      insert into memoid.account_identity_bindings (
        account_id, provider_key, provider_subject, normalized_email, email_verified
      ) values (new_account_id, p_provider_key, p_provider_subject, v_normalized_email, true)
      returning id into new_binding_id;
      insert into memoid.workspaces (account_id) values (new_account_id);
      return query select new_account_id, new_binding_id, 'CREATED'::text;
    end $$`.execute(db);

  await sql`create function memoid.create_auth_session(
      p_account_id uuid, p_binding_id uuid, p_token_hash bytea, p_provider_session_id varchar,
      p_fresh_authenticated_at timestamptz, p_provider_expires_at timestamptz, p_correlation_id uuid
    ) returns uuid language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      binding_row memoid.account_identity_bindings%rowtype;
      epoch bigint;
      now_at timestamptz := clock_timestamp();
      absolute_until timestamptz;
      new_session_id uuid;
    begin
      if octet_length(p_token_hash) <> 32 or p_provider_expires_at <= now_at
        or p_fresh_authenticated_at > now_at + interval '5 minutes'
        or not memoid.is_uuid_v7(p_correlation_id) then raise exception 'INVALID_SESSION_EVIDENCE'; end if;
      select * into binding_row from memoid.account_identity_bindings
        where account_id = p_account_id and id = p_binding_id for update;
      if not found or binding_row.state <> 'ACTIVE' or not binding_row.email_verified then
        raise exception 'IDENTITY_BINDING_DISABLED'; end if;
      select security_epoch into epoch from memoid.account_security_states
        where account_id = p_account_id and disabled_at is null for update;
      if not found then raise exception 'ACCOUNT_DISABLED'; end if;
      absolute_until := least(now_at + interval '24 hours', p_provider_expires_at);
      insert into memoid.auth_sessions (
        account_id, identity_binding_id, token_hash, provider_session_id, security_epoch,
        created_at, last_activity_at, absolute_expires_at, idle_expires_at,
        provider_verified_until, provider_expires_at, fresh_authenticated_at
      ) values (
        p_account_id, p_binding_id, p_token_hash, p_provider_session_id, epoch,
        now_at, now_at, absolute_until, least(now_at + interval '1 hour', absolute_until),
        least(now_at + interval '5 minutes', p_provider_expires_at), p_provider_expires_at,
        p_fresh_authenticated_at
      ) returning id into new_session_id;
      insert into memoid.account_security_events (
        account_id, event_type, outcome, target_type, target_key, correlation_id, occurred_at
      ) values (p_account_id, 'SESSION_ESTABLISHED', 'SUCCESS', 'AUTH_SESSION', new_session_id::text,
        p_correlation_id, now_at);
      return new_session_id;
    end $$`.execute(db);

  await sql`create function memoid.authenticate_auth_session(p_token_hash bytea)
    returns table (
      auth_session_id uuid, resolved_account_id uuid, resolved_binding_id uuid,
      provider_subject varchar, provider_session_id varchar, provider_expires_at timestamptz,
      fresh_authenticated_at timestamptz, provider_recheck_required boolean, fresh boolean
    ) language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_row memoid.auth_sessions%rowtype;
      binding_row memoid.account_identity_bindings%rowtype;
      security_row memoid.account_security_states%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      if octet_length(p_token_hash) <> 32 then return; end if;
      select * into session_row from memoid.auth_sessions where token_hash = p_token_hash for update;
      if not found then return; end if;
      select * into binding_row from memoid.account_identity_bindings
        where account_id = session_row.account_id and id = session_row.identity_binding_id;
      select * into security_row from memoid.account_security_states where account_id = session_row.account_id;
      if session_row.revoked_at is not null or binding_row.state <> 'ACTIVE' or not binding_row.email_verified
        or security_row.disabled_at is not null or security_row.security_epoch <> session_row.security_epoch
        or now_at >= session_row.absolute_expires_at or now_at >= session_row.idle_expires_at
        or now_at >= session_row.provider_expires_at then
        update memoid.auth_sessions set revoked_at = coalesce(revoked_at, now_at),
          revocation_reason = coalesce(revocation_reason, 'SESSION_INVALIDATED') where id = session_row.id;
        return;
      end if;
      update memoid.auth_sessions set last_activity_at = now_at,
        idle_expires_at = least(now_at + interval '1 hour', absolute_expires_at)
        where id = session_row.id;
      return query select session_row.id, session_row.account_id, session_row.identity_binding_id,
        binding_row.provider_subject, session_row.provider_session_id, session_row.provider_expires_at,
        session_row.fresh_authenticated_at, now_at >= session_row.provider_verified_until,
        now_at - session_row.fresh_authenticated_at <= interval '15 minutes';
    end $$`.execute(db);

  await sql`create function memoid.mark_auth_session_provider_state(
      p_token_hash bytea, p_active boolean, p_provider_expires_at timestamptz
    ) returns boolean language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare now_at timestamptz := clock_timestamp();
    begin
      if octet_length(p_token_hash) <> 32 then return false; end if;
      if not p_active or p_provider_expires_at <= now_at then
        update memoid.auth_sessions set revoked_at = coalesce(revoked_at, now_at),
          revocation_reason = coalesce(revocation_reason, 'PROVIDER_SESSION_INACTIVE')
          where token_hash = p_token_hash and revoked_at is null;
      else
        update memoid.auth_sessions set provider_expires_at = least(provider_expires_at, p_provider_expires_at),
          provider_verified_until = least(now_at + interval '5 minutes', provider_expires_at, p_provider_expires_at)
          where token_hash = p_token_hash and revoked_at is null;
      end if;
      return found;
    end $$`.execute(db);

  await sql`create function memoid.revoke_auth_session(
      p_token_hash bytea, p_reason varchar, p_correlation_id uuid
    ) returns varchar language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare session_row memoid.auth_sessions%rowtype; now_at timestamptz := clock_timestamp();
    begin
      if p_reason !~ '^[A-Z][A-Z0-9_]{0,63}$' or not memoid.is_uuid_v7(p_correlation_id)
        then raise exception 'INVALID_REVOCATION_EVIDENCE'; end if;
      select * into session_row from memoid.auth_sessions where token_hash = p_token_hash for update;
      if not found then return null; end if;
      update memoid.auth_sessions set revoked_at = coalesce(revoked_at, now_at),
        revocation_reason = coalesce(revocation_reason, p_reason) where id = session_row.id;
      insert into memoid.account_security_events (
        account_id, event_type, outcome, target_type, target_key, correlation_id, occurred_at
      ) values (session_row.account_id, 'SESSION_REVOKED', 'SUCCESS', 'AUTH_SESSION', session_row.id::text,
        p_correlation_id, now_at);
      return session_row.provider_session_id;
    end $$`.execute(db);

  await sql`create function memoid.revoke_provider_auth_session(
      p_provider_session_id varchar, p_reason varchar, p_correlation_id uuid
    ) returns integer language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare changed integer; affected_account_id uuid; now_at timestamptz := clock_timestamp();
    begin
      if p_reason !~ '^[A-Z][A-Z0-9_]{0,63}$' or not memoid.is_uuid_v7(p_correlation_id)
        then raise exception 'INVALID_REVOCATION_EVIDENCE'; end if;
      update memoid.auth_sessions set revoked_at = coalesce(revoked_at, now_at),
        revocation_reason = coalesce(revocation_reason, p_reason)
        where provider_session_id = p_provider_session_id and revoked_at is null
        returning account_id into affected_account_id;
      get diagnostics changed = row_count;
      if changed > 0 then
        insert into memoid.account_security_events (
          account_id, event_type, outcome, target_type, target_key, correlation_id, occurred_at
        ) values (affected_account_id, 'PROVIDER_SESSION_REVOKED', 'SUCCESS', 'PROVIDER_SESSION',
          p_provider_session_id, p_correlation_id, now_at);
      end if;
      return changed;
    end $$`.execute(db);

  await sql`create function memoid.revoke_provider_identity_sessions(
      p_provider_key varchar, p_provider_subject varchar, p_reason varchar, p_correlation_id uuid
    ) returns integer language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare account_row record; changed integer; total_changed integer := 0;
      now_at timestamptz := clock_timestamp();
    begin
      if p_provider_key !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        or p_provider_subject !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'
        or p_reason !~ '^[A-Z][A-Z0-9_]{0,63}$' or not memoid.is_uuid_v7(p_correlation_id)
        then raise exception 'INVALID_PROVIDER_REVOCATION_EVIDENCE'; end if;
      for account_row in select distinct account_id from memoid.account_identity_bindings
        where provider_key = p_provider_key and provider_subject = p_provider_subject loop
        update memoid.auth_sessions set revoked_at = coalesce(revoked_at, now_at),
          revocation_reason = coalesce(revocation_reason, p_reason)
          where account_id = account_row.account_id and revoked_at is null;
        get diagnostics changed = row_count;
        total_changed := total_changed + changed;
        if changed > 0 then
          insert into memoid.account_security_events (
            account_id, event_type, outcome, target_type, target_key, correlation_id, occurred_at,
            metadata
          ) values (account_row.account_id, 'PROVIDER_IDENTITY_SESSIONS_REVOKED', 'SUCCESS',
            'PROVIDER_IDENTITY', p_provider_subject, p_correlation_id, now_at,
            jsonb_build_object('REVOKED_COUNT', changed, 'REASON', p_reason));
        end if;
      end loop;
      return total_changed;
    end $$`.execute(db);

  await sql`create function memoid.revoke_all_account_auth_sessions(
      p_token_hash bytea, p_reason varchar, p_correlation_id uuid
    ) returns integer language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare current_row memoid.auth_sessions%rowtype; changed integer; now_at timestamptz := clock_timestamp();
    begin
      if p_reason !~ '^[A-Z][A-Z0-9_]{0,63}$' or not memoid.is_uuid_v7(p_correlation_id)
        then raise exception 'INVALID_REVOCATION_EVIDENCE'; end if;
      select * into current_row from memoid.auth_sessions where token_hash = p_token_hash for update;
      if not found or current_row.revoked_at is not null then return 0; end if;
      update memoid.account_security_states set security_epoch = security_epoch + 1, updated_at = now_at
        where account_id = current_row.account_id;
      update memoid.auth_sessions set revoked_at = coalesce(revoked_at, now_at),
        revocation_reason = coalesce(revocation_reason, p_reason)
        where account_id = current_row.account_id and revoked_at is null;
      get diagnostics changed = row_count;
      insert into memoid.account_security_events (
        account_id, event_type, outcome, target_type, target_key, correlation_id, occurred_at,
        metadata
      ) values (current_row.account_id, 'ALL_SESSIONS_REVOKED', 'SUCCESS', 'ACCOUNT',
        current_row.account_id::text, p_correlation_id, now_at, jsonb_build_object('REVOKED_COUNT', changed));
      return changed;
    end $$`.execute(db);

  await sql`create function memoid.create_step_up_intent(
      p_token_hash bytea, p_nonce_hash bytea, p_action_key varchar, p_workspace_id uuid,
      p_project_id uuid, p_return_path varchar, p_correlation_id uuid
    ) returns uuid language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_row memoid.auth_sessions%rowtype;
      now_at timestamptz := clock_timestamp();
      new_intent_id uuid;
    begin
      if octet_length(p_token_hash) <> 32 or octet_length(p_nonce_hash) <> 32
        or p_action_key !~ '^[A-Z][A-Z0-9_]{0,63}$'
        or p_return_path !~ '^/[^/]' or length(p_return_path) > 512
        or (p_project_id is not null and p_workspace_id is null)
        or not memoid.is_uuid_v7(p_correlation_id) then raise exception 'INVALID_STEP_UP_EVIDENCE'; end if;
      select * into session_row from memoid.auth_sessions where token_hash = p_token_hash for update;
      if not found or session_row.revoked_at is not null or now_at >= session_row.absolute_expires_at
        or now_at >= session_row.idle_expires_at or now_at >= session_row.provider_expires_at
        then raise exception 'SESSION_NOT_ACTIVE'; end if;
      if p_workspace_id is not null and not exists (
        select 1 from memoid.workspaces where id = p_workspace_id and account_id = session_row.account_id
      ) then raise exception 'STEP_UP_SCOPE_DENIED'; end if;
      if p_project_id is not null and not exists (
        select 1 from memoid.projects where id = p_project_id and workspace_id = p_workspace_id
      ) then raise exception 'STEP_UP_SCOPE_DENIED'; end if;
      insert into memoid.auth_step_up_intents (
        account_id, auth_session_id, nonce_hash, action_key, workspace_id, project_id,
        return_path, correlation_id, expires_at
      ) values (
        session_row.account_id, session_row.id, p_nonce_hash, p_action_key, p_workspace_id,
        p_project_id, p_return_path, p_correlation_id, now_at + interval '10 minutes'
      ) returning id into new_intent_id;
      return new_intent_id;
    end $$`.execute(db);

  await sql`create function memoid.complete_step_up_intent(
      p_old_token_hash bytea, p_nonce_hash bytea, p_intent_id uuid, p_new_token_hash bytea,
      p_provider_subject varchar, p_provider_session_id varchar,
      p_fresh_authenticated_at timestamptz, p_provider_expires_at timestamptz
    ) returns table (new_session_id uuid, return_path varchar)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      old_session memoid.auth_sessions%rowtype;
      binding_row memoid.account_identity_bindings%rowtype;
      intent_row memoid.auth_step_up_intents%rowtype;
      now_at timestamptz := clock_timestamp();
      absolute_until timestamptz;
      created_session_id uuid;
    begin
      if octet_length(p_old_token_hash) <> 32 or octet_length(p_nonce_hash) <> 32
        or octet_length(p_new_token_hash) <> 32 or p_provider_expires_at <= now_at
        or p_fresh_authenticated_at > now_at + interval '5 minutes'
        then raise exception 'INVALID_STEP_UP_COMPLETION'; end if;
      select * into old_session from memoid.auth_sessions
        where token_hash = p_old_token_hash for update;
      if not found or old_session.revoked_at is not null or now_at >= old_session.absolute_expires_at
        or now_at >= old_session.idle_expires_at or now_at >= old_session.provider_expires_at
        then raise exception 'SESSION_NOT_ACTIVE'; end if;
      select * into binding_row from memoid.account_identity_bindings
        where account_id = old_session.account_id and id = old_session.identity_binding_id;
      if not found or binding_row.state <> 'ACTIVE' or not binding_row.email_verified
        or binding_row.provider_subject <> p_provider_subject
        then raise exception 'STEP_UP_IDENTITY_MISMATCH'; end if;
      select * into intent_row from memoid.auth_step_up_intents
        where id = p_intent_id and account_id = old_session.account_id
          and auth_session_id = old_session.id and nonce_hash = p_nonce_hash for update;
      if not found or intent_row.consumed_at is not null or now_at >= intent_row.expires_at
        or p_fresh_authenticated_at < date_trunc('second', intent_row.created_at)
        then raise exception 'STEP_UP_INTENT_INVALID'; end if;
      absolute_until := least(old_session.absolute_expires_at, p_provider_expires_at);
      if absolute_until <= now_at then raise exception 'STEP_UP_SESSION_EXPIRED'; end if;
      update memoid.auth_sessions set revoked_at = now_at, revocation_reason = 'STEP_UP_ROTATED'
        where id = old_session.id;
      insert into memoid.auth_sessions (
        account_id, identity_binding_id, token_hash, provider_session_id, security_epoch,
        created_at, last_activity_at, absolute_expires_at, idle_expires_at,
        provider_verified_until, provider_expires_at, fresh_authenticated_at,
        rotated_from_session_id
      ) values (
        old_session.account_id, old_session.identity_binding_id, p_new_token_hash,
        p_provider_session_id, old_session.security_epoch, now_at, now_at, absolute_until,
        least(now_at + interval '1 hour', absolute_until),
        least(now_at + interval '5 minutes', p_provider_expires_at), p_provider_expires_at,
        p_fresh_authenticated_at, old_session.id
      ) returning id into created_session_id;
      update memoid.auth_step_up_intents set consumed_at = now_at where id = intent_row.id;
      insert into memoid.account_security_events (
        account_id, event_type, outcome, target_type, target_key, correlation_id, occurred_at,
        metadata
      ) values (old_session.account_id, 'STEP_UP_COMPLETED', 'SUCCESS', 'AUTH_SESSION',
        created_session_id::text, intent_row.correlation_id, now_at,
        jsonb_build_object('ACTION_KEY', intent_row.action_key));
      return query select created_session_id, intent_row.return_path;
    end $$`.execute(db);
}

async function createRlsFunctionsAndPolicies(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.current_account_id() returns uuid language sql stable as $$
    select nullif(current_setting('memoid.account_id', true), '')::uuid $$`.execute(db);
  await sql`create function memoid.current_workspace_id() returns uuid language sql stable as $$
    select nullif(current_setting('memoid.workspace_id', true), '')::uuid $$`.execute(db);
  await sql`create function memoid.current_project_id() returns uuid language sql stable as $$
    select nullif(current_setting('memoid.project_id', true), '')::uuid $$`.execute(db);
  await sql`create function memoid.current_actor_id() returns uuid language sql stable as $$
    select nullif(current_setting('memoid.actor_id', true), '')::uuid $$`.execute(db);
  await sql`create function memoid.has_workspace_scope(p_workspace_id uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, memoid as $$
    select p_workspace_id = memoid.current_workspace_id()
      and exists (select 1 from memoid.workspaces w
        where w.id = p_workspace_id and w.account_id = memoid.current_account_id()) $$`.execute(db);
  await sql`create function memoid.has_project_scope(p_workspace_id uuid, p_project_id uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, memoid as $$
    select p_project_id = memoid.current_project_id()
      and memoid.has_workspace_scope(p_workspace_id)
      and exists (select 1 from memoid.projects p
        where p.workspace_id = p_workspace_id and p.id = p_project_id) $$`.execute(db);
  await sql`create function memoid.has_actor_scope(
      p_workspace_id uuid, p_actor_id uuid, p_actor_kind varchar,
      p_actor_reference varchar, p_actor_label varchar
    ) returns boolean language sql stable set search_path = pg_catalog, memoid as $$
    select p_actor_id = memoid.current_actor_id()
      and memoid.has_workspace_scope(p_workspace_id)
      and exists (select 1 from memoid.actors a where a.workspace_id = p_workspace_id
        and a.id = p_actor_id and a.actor_kind = p_actor_kind
        and a.actor_reference = p_actor_reference and a.display_label = p_actor_label) $$`.execute(
    db,
  );

  await sql`alter table memoid.accounts enable row level security`.execute(db);
  await sql`alter table memoid.accounts force row level security`.execute(db);
  await sql`create policy account_scope on memoid.accounts
    using (current_user = 'memoid_owner' or id = memoid.current_account_id())
    with check (current_user = 'memoid_owner' or id = memoid.current_account_id())`.execute(db);
  for (const tableName of [
    "account_identity_bindings",
    "account_security_states",
    "auth_sessions",
    "auth_step_up_intents",
    "account_security_events",
  ]) {
    await sql.raw(`alter table memoid.${tableName} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${tableName} force row level security`).execute(db);
    await sql
      .raw(
        `create policy account_scope on memoid.${tableName}
      using (current_user = 'memoid_owner' or account_id = memoid.current_account_id())
      with check (current_user = 'memoid_owner' or account_id = memoid.current_account_id())`,
      )
      .execute(db);
  }
  await sql`alter table memoid.workspaces enable row level security`.execute(db);
  await sql`alter table memoid.workspaces force row level security`.execute(db);
  await sql`create policy workspace_scope on memoid.workspaces
    using (current_user = 'memoid_owner'
      or (id = memoid.current_workspace_id() and account_id = memoid.current_account_id()))
    with check (current_user = 'memoid_owner'
      or (id = memoid.current_workspace_id() and account_id = memoid.current_account_id()))`.execute(
    db,
  );
  await sql`alter table memoid.projects enable row level security`.execute(db);
  await sql`alter table memoid.projects force row level security`.execute(db);
  await sql`create policy project_scope on memoid.projects
    using (current_user = 'memoid_owner' or (memoid.has_workspace_scope(workspace_id)
      and (memoid.current_project_id() is null or id = memoid.current_project_id())))
    with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, id))`.execute(
    db,
  );
  await sql`alter table memoid.actors enable row level security`.execute(db);
  await sql`alter table memoid.actors force row level security`.execute(db);
  await sql`create policy actors_select_scope on memoid.actors for select
    using (current_user = 'memoid_owner' or memoid.has_workspace_scope(workspace_id))`.execute(db);
  await sql`create policy actors_human_insert_scope on memoid.actors for insert
    with check (current_user = 'memoid_owner' or (memoid.has_workspace_scope(workspace_id)
      and actor_kind = 'HUMAN'
      and actor_reference = 'account:' || memoid.current_account_id()::text))`.execute(db);
  for (const tableName of PROJECT_SCOPED_TABLES) {
    await sql.raw(`alter table memoid.${tableName} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${tableName} force row level security`).execute(db);
    await sql
      .raw(
        `create policy project_scope on memoid.${tableName}
      using (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))
      with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))`,
      )
      .execute(db);
  }
  await sql`alter table memoid.audit_events enable row level security`.execute(db);
  await sql`alter table memoid.audit_events force row level security`.execute(db);
  await sql`create policy audit_event_scope on memoid.audit_events
    using (memoid.has_project_scope(workspace_id, project_id))
    with check (memoid.has_project_scope(workspace_id, project_id)
      and memoid.has_actor_scope(workspace_id, actor_id, actor_kind_snapshot,
        actor_reference_snapshot, actor_label_snapshot))`.execute(db);
}

async function createGuardsIndexesAndPermissions(db: Kysely<unknown>): Promise<void> {
  await sql`create trigger account_security_events_history_guard before update or delete
    on memoid.account_security_events for each row execute function memoid.reject_history_change()`.execute(
    db,
  );
  await sql`create index auth_sessions_account_active_idx
    on memoid.auth_sessions (account_id, revoked_at, absolute_expires_at)`.execute(db);
  await sql`create index auth_step_up_intents_session_idx
    on memoid.auth_step_up_intents (account_id, auth_session_id, consumed_at, expires_at)`.execute(
    db,
  );
  await sql`create index account_security_events_occurred_idx
    on memoid.account_security_events (account_id, occurred_at desc, id)`.execute(db);

  await sql`revoke all on schema memoid from public, memoid_app, memoid_auth`.execute(db);
  await sql`revoke all on all tables in schema memoid from public, memoid_app, memoid_auth`.execute(
    db,
  );
  await sql`revoke all on all sequences in schema memoid from public, memoid_app, memoid_auth`.execute(
    db,
  );
  await sql`revoke all on all functions in schema memoid from public, memoid_app, memoid_auth`.execute(
    db,
  );
  await sql`grant usage on schema memoid to memoid_app`.execute(db);
  await sql`grant select on all tables in schema memoid to memoid_app`.execute(db);
  await sql`grant insert on memoid.actors, memoid.audit_events to memoid_app`.execute(db);
  await sql`grant execute on function
      memoid.is_uuid_v7(uuid), memoid.is_sanitized_metadata(jsonb),
      memoid.current_account_id(), memoid.current_workspace_id(), memoid.current_project_id(),
      memoid.current_actor_id(), memoid.has_workspace_scope(uuid), memoid.has_project_scope(uuid,uuid),
      memoid.has_actor_scope(uuid,uuid,varchar,varchar,varchar)
    to memoid_app`.execute(db);
  await sql`grant usage on schema memoid to memoid_auth`.execute(db);
  await sql`grant execute on function
      memoid.resolve_account_identity(varchar,varchar,varchar,boolean),
      memoid.create_auth_session(uuid,uuid,bytea,varchar,timestamptz,timestamptz,uuid),
      memoid.authenticate_auth_session(bytea),
      memoid.mark_auth_session_provider_state(bytea,boolean,timestamptz),
      memoid.revoke_auth_session(bytea,varchar,uuid),
      memoid.revoke_provider_auth_session(varchar,varchar,uuid),
      memoid.revoke_provider_identity_sessions(varchar,varchar,varchar,uuid),
      memoid.create_step_up_intent(bytea,bytea,varchar,uuid,uuid,varchar,uuid),
      memoid.complete_step_up_intent(bytea,bytea,uuid,bytea,varchar,varchar,timestamptz,timestamptz)
    to memoid_auth`.execute(db);
  await sql`comment on schema memoid is 'Memoid product schema with application-primary authorization and forced transaction-scoped RLS defense in depth'`.execute(
    db,
  );
}

export const stage10cIdentityAuthzRlsMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createIdentityAndSessionTables(db);
    await createIdentityAndSessionFunctions(db);
    await createRlsFunctionsAndPolicies(db);
    await createGuardsIndexesAndPermissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    for (const tableName of PROJECT_SCOPED_TABLES) {
      await sql.raw(`drop policy if exists project_scope on memoid.${tableName}`).execute(db);
      await sql.raw(`alter table memoid.${tableName} disable row level security`).execute(db);
    }
    await sql`drop policy if exists audit_event_scope on memoid.audit_events`.execute(db);
    await sql`alter table memoid.audit_events disable row level security`.execute(db);
    await sql`drop policy if exists actors_select_scope on memoid.actors`.execute(db);
    await sql`drop policy if exists actors_human_insert_scope on memoid.actors`.execute(db);
    await sql`alter table memoid.actors disable row level security`.execute(db);
    await sql`drop policy if exists project_scope on memoid.projects`.execute(db);
    await sql`alter table memoid.projects disable row level security`.execute(db);
    await sql`drop policy if exists workspace_scope on memoid.workspaces`.execute(db);
    await sql`alter table memoid.workspaces disable row level security`.execute(db);
    await sql`drop policy if exists account_scope on memoid.accounts`.execute(db);
    await sql`alter table memoid.accounts disable row level security`.execute(db);
    await sql`drop table if exists memoid.account_security_events, memoid.auth_step_up_intents,
      memoid.auth_sessions, memoid.account_security_states, memoid.account_identity_bindings cascade`.execute(
      db,
    );
    await sql`drop function if exists
      memoid.resolve_account_identity(varchar,varchar,varchar,boolean),
      memoid.create_auth_session(uuid,uuid,bytea,varchar,timestamptz,timestamptz,uuid),
      memoid.authenticate_auth_session(bytea),
      memoid.mark_auth_session_provider_state(bytea,boolean,timestamptz),
      memoid.revoke_auth_session(bytea,varchar,uuid),
      memoid.revoke_provider_auth_session(varchar,varchar,uuid),
      memoid.revoke_provider_identity_sessions(varchar,varchar,varchar,uuid),
      memoid.revoke_all_account_auth_sessions(bytea,varchar,uuid),
      memoid.create_step_up_intent(bytea,bytea,varchar,uuid,uuid,varchar,uuid),
      memoid.complete_step_up_intent(bytea,bytea,uuid,bytea,varchar,varchar,timestamptz,timestamptz),
      memoid.initialize_account_security_state(), memoid.current_account_id(),
      memoid.current_workspace_id(), memoid.current_project_id(), memoid.current_actor_id(),
      memoid.has_workspace_scope(uuid), memoid.has_project_scope(uuid,uuid),
      memoid.has_actor_scope(uuid,uuid,varchar,varchar,varchar) cascade`.execute(db);
    await sql`revoke all on schema memoid from memoid_app`.execute(db);
    await sql`revoke all on all tables in schema memoid from memoid_app`.execute(db);
    await sql`revoke all on all functions in schema memoid from memoid_app`.execute(db);
    await sql`revoke all on schema memoid from memoid_auth`.execute(db);
    await sql`revoke all on all tables in schema memoid from memoid_auth`.execute(db);
    await sql`revoke all on all functions in schema memoid from memoid_auth`.execute(db);
    await sql`reset role`.execute(db);
  },
};
