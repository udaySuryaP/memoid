import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.github_connection_intents (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    auth_session_id uuid not null,
    actor_id uuid not null,
    state_hash bytea not null,
    phase varchar(16) not null default 'SETUP',
    installation_id varchar(40),
    correlation_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null,
    consumed_at timestamptz,
    constraint github_connection_intents_id_v7 check (memoid.is_uuid_v7(id)),
    constraint github_connection_intents_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint github_connection_intents_session_fk foreign key (auth_session_id)
      references memoid.auth_sessions(id),
    constraint github_connection_intents_actor_fk foreign key (workspace_id, actor_id)
      references memoid.actors(workspace_id, id),
    constraint github_connection_intents_state_hash check (octet_length(state_hash) = 32),
    constraint github_connection_intents_phase check (phase in ('SETUP', 'SELECTION')),
    constraint github_connection_intents_installation check (
      installation_id is null or installation_id ~ '^[1-9][0-9]{0,39}$'
    ),
    constraint github_connection_intents_expiry check (expires_at > created_at),
    constraint github_connection_intents_phase_shape check (
      (phase = 'SETUP' and installation_id is null)
      or (phase = 'SELECTION' and installation_id is not null)
    ),
    constraint github_connection_intents_state_unique unique (state_hash),
    constraint github_connection_intents_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.github_repository_candidates (
    workspace_id uuid not null,
    project_id uuid not null,
    intent_id uuid not null,
    repository_id varchar(40) not null,
    app_id varchar(40) not null,
    installation_id varchar(40) not null,
    account_id varchar(40) not null,
    owner_login varchar(100) not null,
    repository_name varchar(100) not null,
    full_name varchar(201) not null,
    html_url varchar(512) not null,
    visibility varchar(16) not null,
    default_branch varchar(255) not null,
    verified_at timestamptz not null,
    expires_at timestamptz not null,
    primary key (workspace_id, project_id, intent_id, repository_id),
    constraint github_repository_candidates_intent_fk
      foreign key (workspace_id, project_id, intent_id)
      references memoid.github_connection_intents(workspace_id, project_id, id),
    constraint github_repository_candidates_ids check (
      repository_id ~ '^[1-9][0-9]{0,39}$' and app_id ~ '^[1-9][0-9]{0,39}$'
      and installation_id ~ '^[1-9][0-9]{0,39}$' and account_id ~ '^[1-9][0-9]{0,39}$'
    ),
    constraint github_repository_candidates_text check (
      length(owner_login) > 0 and btrim(owner_login) = owner_login
      and length(repository_name) > 0 and btrim(repository_name) = repository_name
      and length(full_name) > 0 and btrim(full_name) = full_name
      and length(default_branch) > 0 and btrim(default_branch) = default_branch
      and html_url ~ '^https://github[.]com/'
    ),
    constraint github_repository_candidates_visibility check (visibility in ('PUBLIC','PRIVATE','INTERNAL')),
    constraint github_repository_candidates_expiry check (expires_at > verified_at)
  )`.execute(db);

  await sql`create table memoid.github_source_connections (
    workspace_id uuid not null,
    project_id uuid not null,
    source_id uuid not null,
    provider_key varchar(16) not null default 'GITHUB',
    app_id varchar(40) not null,
    installation_id varchar(40) not null,
    account_id varchar(40) not null,
    repository_id varchar(40) not null,
    owner_login varchar(100) not null,
    repository_name varchar(100) not null,
    full_name varchar(201) not null,
    html_url varchar(512) not null,
    visibility varchar(16) not null,
    default_branch varchar(255) not null,
    connection_state varchar(32) not null default 'ACTIVE',
    verified_at timestamptz not null,
    provider_occurred_at timestamptz,
    state_changed_at timestamptz not null default clock_timestamp(),
    created_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id),
    constraint github_source_connections_source_fk foreign key (workspace_id, project_id, source_id)
      references memoid.sources(workspace_id, project_id, id),
    constraint github_source_connections_source_unique unique (workspace_id, project_id, source_id),
    constraint github_source_connections_provider check (provider_key = 'GITHUB'),
    constraint github_source_connections_ids check (
      app_id ~ '^[1-9][0-9]{0,39}$' and installation_id ~ '^[1-9][0-9]{0,39}$'
      and account_id ~ '^[1-9][0-9]{0,39}$' and repository_id ~ '^[1-9][0-9]{0,39}$'
    ),
    constraint github_source_connections_visibility check (visibility in ('PUBLIC','PRIVATE','INTERNAL')),
    constraint github_source_connections_state check (connection_state in (
      'ACTIVE','VERIFICATION_REQUIRED','SUSPENDED','INSTALLATION_DELETED',
      'REPOSITORY_ACCESS_REMOVED','REPOSITORY_DELETED'
    ))
  )`.execute(db);

  await sql`create table memoid.github_provider_lifecycle_fences (
    scope_key varchar(122) not null,
    app_id varchar(40) not null,
    installation_id varchar(40) not null,
    repository_id varchar(40),
    connection_state varchar(32) not null,
    external_delivery_id varchar(128) not null,
    payload_hash bytea not null,
    provider_occurred_at timestamptz,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (scope_key, external_delivery_id),
    constraint github_provider_lifecycle_fences_ids check (
      app_id ~ '^[1-9][0-9]{0,39}$' and installation_id ~ '^[1-9][0-9]{0,39}$'
      and (repository_id is null or repository_id ~ '^[1-9][0-9]{0,39}$')
    ),
    constraint github_provider_lifecycle_fences_state check (connection_state in (
      'VERIFICATION_REQUIRED','SUSPENDED','INSTALLATION_DELETED',
      'REPOSITORY_ACCESS_REMOVED','REPOSITORY_DELETED'
    )),
    constraint github_provider_lifecycle_fences_hash check (octet_length(payload_hash) = 32)
  )`.execute(db);

  for (const table of [
    "github_connection_intents",
    "github_repository_candidates",
    "github_source_connections",
  ]) {
    await sql.raw(`alter table memoid.${table} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${table} force row level security`).execute(db);
    await sql
      .raw(
        `create policy project_scope on memoid.${table}
      using (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))
      with check (current_user = 'memoid_owner' or memoid.has_project_scope(workspace_id, project_id))`,
      )
      .execute(db);
  }
  await sql`alter table memoid.github_provider_lifecycle_fences enable row level security`.execute(
    db,
  );
  await sql`alter table memoid.github_provider_lifecycle_fences force row level security`.execute(
    db,
  );
  await sql`create policy owner_only on memoid.github_provider_lifecycle_fences
    using (current_user = 'memoid_owner')
    with check (current_user = 'memoid_owner')`.execute(db);
  await sql`create index github_connection_intents_expiry_idx
    on memoid.github_connection_intents (expires_at) where consumed_at is null`.execute(db);
  await sql`create index github_source_connections_provider_identity_idx
    on memoid.github_source_connections (app_id, installation_id, repository_id)`.execute(db);
  await sql`create index github_provider_lifecycle_fences_identity_recorded_idx
    on memoid.github_provider_lifecycle_fences
      (app_id, installation_id, repository_id, recorded_at desc)`.execute(db);
  await sql`create function memoid.guard_github_source_connection_update() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id
        or new.source_id <> old.source_id or new.provider_key <> old.provider_key
        or new.app_id <> old.app_id or new.installation_id <> old.installation_id
        or new.repository_id <> old.repository_id
        or new.created_at <> old.created_at
      then raise exception 'GitHub Source provider identity is immutable'; end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger github_source_connections_identity_guard
    before update on memoid.github_source_connections for each row
    execute function memoid.guard_github_source_connection_update()`.execute(db);
  await sql`revoke all on function memoid.guard_github_source_connection_update()
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
}

async function createHumanFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.create_github_connection_intent(
      p_session_token_hash bytea, p_project_id uuid, p_state_hash bytea,
      p_correlation_id uuid, p_ttl_seconds integer default 600
    ) returns uuid language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_row memoid.auth_sessions%rowtype;
      project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype;
      created_id uuid;
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'LIFECYCLE_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32 or octet_length(p_state_hash) <> 32
        or p_project_id is distinct from memoid.current_project_id()
        or not memoid.is_uuid_v7(p_correlation_id) or p_ttl_seconds not between 60 and 900
      then raise exception 'INVALID_GITHUB_CONNECTION_INTENT'; end if;
      select s.* into session_row from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified
        for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into project_row from memoid.projects
        where workspace_id = memoid.current_workspace_id() and id = p_project_id for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state <> 'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      select * into actor_row from memoid.actors where workspace_id = project_row.workspace_id
        and id = memoid.current_actor_id() and actor_kind = 'HUMAN'
        and actor_reference = 'account:' || session_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;
      if exists (select 1 from memoid.github_source_connections c
        where c.workspace_id = project_row.workspace_id and c.project_id = project_row.id
          and c.connection_state = 'ACTIVE')
      then raise exception 'GITHUB_SOURCE_ALREADY_CONNECTED'; end if;
      insert into memoid.github_connection_intents (
        workspace_id, project_id, auth_session_id, actor_id, state_hash,
        correlation_id, expires_at
      ) values (
        project_row.workspace_id, project_row.id, session_row.id, actor_row.id,
        p_state_hash, p_correlation_id, now_at + make_interval(secs => p_ttl_seconds)
      ) returning id into created_id;
      return created_id;
    end $$`.execute(db);

  await sql`create function memoid.rotate_github_connection_state(
      p_session_token_hash bytea, p_intent_id uuid, p_old_state_hash bytea,
      p_new_state_hash bytea
    ) returns boolean language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_id uuid;
      intent_row memoid.github_connection_intents%rowtype;
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'LIFECYCLE_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32 or octet_length(p_old_state_hash) <> 32
        or octet_length(p_new_state_hash) <> 32 or p_old_state_hash = p_new_state_hash
      then raise exception 'INVALID_GITHUB_STATE_ROTATION'; end if;
      select s.id into session_id from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified
        for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into intent_row from memoid.github_connection_intents
        where id = p_intent_id and workspace_id = memoid.current_workspace_id()
          and project_id = memoid.current_project_id() for update;
      if not found or intent_row.auth_session_id <> session_id
        or intent_row.state_hash <> p_old_state_hash or intent_row.phase <> 'SETUP'
        or intent_row.consumed_at is not null or intent_row.expires_at <= now_at
      then raise exception 'GITHUB_CONNECTION_INTENT_INVALID'; end if;
      update memoid.github_connection_intents set state_hash = p_new_state_hash
        where id = intent_row.id;
      return true;
    end $$`.execute(db);

  await sql`create function memoid.record_github_repository_candidate(
      p_session_token_hash bytea, p_intent_id uuid, p_state_hash bytea,
      p_app_id varchar, p_installation_id varchar, p_account_id varchar,
      p_repository_id varchar, p_owner_login varchar, p_repository_name varchar,
      p_full_name varchar, p_html_url varchar, p_visibility varchar,
      p_default_branch varchar, p_verified_at timestamptz
    ) returns boolean language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      intent_row memoid.github_connection_intents%rowtype;
      session_id uuid;
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'LIFECYCLE_CALLER_FORBIDDEN'; end if;
      select s.id into session_id from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified
        for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into intent_row from memoid.github_connection_intents
        where id = p_intent_id and workspace_id = memoid.current_workspace_id()
          and project_id = memoid.current_project_id() for update;
      if not found or intent_row.auth_session_id <> session_id or intent_row.state_hash <> p_state_hash
        or intent_row.phase not in ('SETUP','SELECTION') or intent_row.consumed_at is not null
        or (intent_row.phase = 'SELECTION' and intent_row.installation_id <> p_installation_id)
        or intent_row.expires_at <= now_at
      then raise exception 'GITHUB_CONNECTION_INTENT_INVALID'; end if;
      if p_app_id !~ '^[1-9][0-9]{0,39}$' or p_installation_id !~ '^[1-9][0-9]{0,39}$'
        or p_account_id !~ '^[1-9][0-9]{0,39}$' or p_repository_id !~ '^[1-9][0-9]{0,39}$'
        or p_html_url !~ '^https://github[.]com/' or p_visibility not in ('PUBLIC','PRIVATE','INTERNAL')
        or p_verified_at > now_at or p_verified_at < now_at - interval '5 minutes'
      then raise exception 'INVALID_GITHUB_REPOSITORY_EVIDENCE'; end if;
      update memoid.github_connection_intents set phase = 'SELECTION', installation_id = p_installation_id
        where id = intent_row.id;
      insert into memoid.github_repository_candidates (
        workspace_id, project_id, intent_id, repository_id, app_id, installation_id,
        account_id, owner_login, repository_name, full_name, html_url, visibility,
        default_branch, verified_at, expires_at
      ) values (
        intent_row.workspace_id, intent_row.project_id, intent_row.id, p_repository_id,
        p_app_id, p_installation_id, p_account_id, p_owner_login, p_repository_name,
        p_full_name, p_html_url, p_visibility, p_default_branch, p_verified_at,
        least(intent_row.expires_at, now_at + interval '5 minutes')
      ) on conflict (workspace_id, project_id, intent_id, repository_id) do update set
        account_id = excluded.account_id, owner_login = excluded.owner_login,
        repository_name = excluded.repository_name, full_name = excluded.full_name,
        html_url = excluded.html_url, visibility = excluded.visibility,
        default_branch = excluded.default_branch, verified_at = excluded.verified_at,
        expires_at = excluded.expires_at;
      return true;
    end $$`.execute(db);

  await sql`create function memoid.connect_github_repository(
      p_session_token_hash bytea, p_intent_id uuid, p_state_hash bytea,
      p_repository_id varchar, p_idempotency_key_hash bytea,
      p_request_fingerprint bytea, p_correlation_id uuid
    ) returns table (source_id uuid, replayed boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      intent_row memoid.github_connection_intents%rowtype;
      candidate_row memoid.github_repository_candidates%rowtype;
      session_row memoid.auth_sessions%rowtype;
      project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype;
      existing_connection memoid.github_source_connections%rowtype;
      claim_row record;
      created_source uuid;
      audit_event_type varchar := 'GITHUB_SOURCE_CONNECTED';
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'LIFECYCLE_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32 or octet_length(p_state_hash) <> 32
        or octet_length(p_idempotency_key_hash) <> 32 or octet_length(p_request_fingerprint) <> 32
        or not memoid.is_uuid_v7(p_correlation_id)
      then raise exception 'INVALID_GITHUB_CONNECTION_REQUEST'; end if;
      select s.* into session_row from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified
        for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into intent_row from memoid.github_connection_intents
        where id = p_intent_id and workspace_id = memoid.current_workspace_id()
          and project_id = memoid.current_project_id() for update;
      if not found or intent_row.auth_session_id <> session_row.id or intent_row.state_hash <> p_state_hash
        or intent_row.phase <> 'SELECTION'
      then raise exception 'GITHUB_CONNECTION_INTENT_INVALID'; end if;
      select * into project_row from memoid.projects
        where workspace_id = intent_row.workspace_id and id = intent_row.project_id for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state <> 'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      select * into actor_row from memoid.actors where workspace_id = project_row.workspace_id
        and id = memoid.current_actor_id() and actor_kind = 'HUMAN'
        and actor_reference = 'account:' || session_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;
      select * into candidate_row from memoid.github_repository_candidates
        where workspace_id = project_row.workspace_id and project_id = project_row.id
          and intent_id = intent_row.id and repository_id = p_repository_id for update;
      if not found then raise exception 'GITHUB_REPOSITORY_NOT_VERIFIED'; end if;
      if exists (select 1 from memoid.github_provider_lifecycle_fences f
        where f.app_id = candidate_row.app_id and f.installation_id = candidate_row.installation_id
          and (f.repository_id is null or f.repository_id = candidate_row.repository_id))
      then raise exception 'GITHUB_PROVIDER_STATE_CHANGED'; end if;
      select * into claim_row from memoid.claim_idempotency(
        project_row.workspace_id, project_row.id, actor_row.id, 'GITHUB_SOURCE_CONNECT',
        p_idempotency_key_hash, p_request_fingerprint, p_correlation_id, null,
        60, now_at + interval '24 hours'
      );
      if claim_row.claim_outcome = 'CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome = 'IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome = 'TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome = 'REPLAY' then
        if not exists (select 1 from memoid.github_source_connections c
          where c.workspace_id = project_row.workspace_id and c.project_id = project_row.id
            and c.source_id = claim_row.stable_result_reference::uuid)
        then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select claim_row.stable_result_reference::uuid, true;
        return;
      end if;
      if intent_row.consumed_at is not null or intent_row.expires_at <= now_at
      then raise exception 'GITHUB_CONNECTION_INTENT_INVALID'; end if;
      if candidate_row.expires_at <= now_at
      then raise exception 'GITHUB_REPOSITORY_NOT_VERIFIED'; end if;
      select * into existing_connection from memoid.github_source_connections c
        where c.workspace_id = project_row.workspace_id and c.project_id = project_row.id for update;
      if found then
        if existing_connection.app_id <> candidate_row.app_id
          or existing_connection.installation_id <> candidate_row.installation_id
          or existing_connection.repository_id <> candidate_row.repository_id
        then raise exception 'GITHUB_SOURCE_REPLACEMENT_REQUIRES_SEPARATE_WORKFLOW'; end if;
        created_source := existing_connection.source_id;
        audit_event_type := 'GITHUB_SOURCE_REVERIFIED';
        update memoid.github_source_connections set account_id = candidate_row.account_id,
          owner_login = candidate_row.owner_login, repository_name = candidate_row.repository_name,
          full_name = candidate_row.full_name, html_url = candidate_row.html_url,
          visibility = candidate_row.visibility, default_branch = candidate_row.default_branch,
          connection_state = 'ACTIVE', verified_at = candidate_row.verified_at,
          state_changed_at = now_at
          where workspace_id = project_row.workspace_id and project_id = project_row.id;
      else
        insert into memoid.sources (workspace_id, project_id, source_kind)
          values (project_row.workspace_id, project_row.id, 'GITHUB_REPOSITORY')
          returning id into created_source;
        insert into memoid.github_source_connections (
          workspace_id, project_id, source_id, app_id, installation_id, account_id,
          repository_id, owner_login, repository_name, full_name, html_url, visibility,
          default_branch, verified_at
        ) values (
          project_row.workspace_id, project_row.id, created_source, candidate_row.app_id,
          candidate_row.installation_id, candidate_row.account_id, candidate_row.repository_id,
          candidate_row.owner_login, candidate_row.repository_name, candidate_row.full_name,
          candidate_row.html_url, candidate_row.visibility, candidate_row.default_branch,
          candidate_row.verified_at
        );
      end if;
      update memoid.github_connection_intents set consumed_at = now_at where id = intent_row.id;
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at,
        target_type, target_key, correlation_id, idempotency_record_id, outcome, metadata
      ) values (
        project_row.workspace_id, project_row.id, actor_row.id, 'INTEGRATION',
        audit_event_type, now_at, 'SOURCE', created_source::text,
        p_correlation_id, claim_row.idempotency_record_id, 'SUCCESS',
        jsonb_build_object('PROVIDER_KEY','GITHUB','APP_ID',candidate_row.app_id,
          'INSTALLATION_ID',candidate_row.installation_id,'ACCOUNT_ID',candidate_row.account_id,
          'REPOSITORY_ID',candidate_row.repository_id,'CONNECTION_STATE','ACTIVE')
      );
      perform memoid.finish_idempotency(
        project_row.workspace_id, project_row.id, claim_row.idempotency_record_id,
        claim_row.active_claim_token, 'COMPLETED', 'SOURCE', created_source::text,
        null, sha256(convert_to(created_source::text,'UTF8')), 201,
        jsonb_build_object('REPLAYABLE',true), null, null
      );
      return query select created_source, false;
    end $$`.execute(db);
}
async function createProviderFunction(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.apply_github_lifecycle_signal(
      p_app_id varchar, p_installation_id varchar, p_repository_id varchar,
      p_connection_state varchar, p_external_delivery_id varchar,
      p_payload_hash bytea, p_provider_occurred_at timestamptz
    ) returns integer language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      scope_value varchar;
      now_at timestamptz := clock_timestamp();
      changed integer := 0;
      existing_hash bytea;
      connection_row record;
      source_actor_id uuid;
      receipt_id uuid;
      receipt_outcome text;
      event_correlation uuid;
      inserted_fence integer;
    begin
      if session_user <> 'memoid_provider' then raise exception 'PROVIDER_CALLER_FORBIDDEN'; end if;
      if p_app_id !~ '^[1-9][0-9]{0,39}$' or p_installation_id !~ '^[1-9][0-9]{0,39}$'
        or (p_repository_id is not null and p_repository_id !~ '^[1-9][0-9]{0,39}$')
        or p_connection_state not in ('VERIFICATION_REQUIRED','SUSPENDED','INSTALLATION_DELETED',
          'REPOSITORY_ACCESS_REMOVED','REPOSITORY_DELETED')
        or length(p_external_delivery_id) not between 1 and 128 or octet_length(p_payload_hash) <> 32
        or p_provider_occurred_at > now_at + interval '5 minutes'
      then raise exception 'INVALID_GITHUB_LIFECYCLE_SIGNAL'; end if;
      scope_value := p_app_id || ':' || p_installation_id || ':' || coalesce(p_repository_id, '*');
      select payload_hash into existing_hash from memoid.github_provider_lifecycle_fences
        where scope_key = scope_value and external_delivery_id = p_external_delivery_id;
      if found then
        if existing_hash <> p_payload_hash then raise exception 'PROVIDER_DELIVERY_CONFLICT'; end if;
        return 0;
      end if;
      insert into memoid.github_provider_lifecycle_fences (
        scope_key, app_id, installation_id, repository_id, connection_state,
        external_delivery_id, payload_hash, provider_occurred_at, recorded_at
      ) values (
        scope_value, p_app_id, p_installation_id, p_repository_id, p_connection_state,
        p_external_delivery_id, p_payload_hash, p_provider_occurred_at, now_at
      ) on conflict (scope_key, external_delivery_id) do nothing;
      get diagnostics inserted_fence = row_count;
      if inserted_fence = 0 then
        select payload_hash into existing_hash from memoid.github_provider_lifecycle_fences
          where scope_key = scope_value and external_delivery_id = p_external_delivery_id;
        if existing_hash <> p_payload_hash then raise exception 'PROVIDER_DELIVERY_CONFLICT'; end if;
        return 0;
      end if;
      for connection_row in select c.workspace_id, c.project_id, c.source_id, w.account_id
        from memoid.github_source_connections c
        join memoid.workspaces w on w.id = c.workspace_id
        where c.app_id = p_app_id and c.installation_id = p_installation_id
          and (p_repository_id is null or c.repository_id = p_repository_id)
      loop
        insert into memoid.actors (workspace_id, actor_kind, actor_reference, display_label)
          values (connection_row.workspace_id, 'SOURCE_SYSTEM', 'github:app:' || p_app_id, 'GitHub App')
          on conflict (workspace_id, actor_kind, actor_reference) do nothing;
        select id into source_actor_id from memoid.actors
          where workspace_id = connection_row.workspace_id and actor_kind = 'SOURCE_SYSTEM'
            and actor_reference = 'github:app:' || p_app_id;
        perform set_config('memoid.account_id', connection_row.account_id::text, true);
        perform set_config('memoid.workspace_id', connection_row.workspace_id::text, true);
        perform set_config('memoid.project_id', connection_row.project_id::text, true);
        perform set_config('memoid.actor_id', source_actor_id::text, true);
        event_correlation := uuidv7();
        select r.registration_outcome, r.receipt_id into receipt_outcome, receipt_id
          from memoid.register_provider_event_receipt(
            connection_row.workspace_id, connection_row.project_id, source_actor_id,
            'github', 'installation:' || p_installation_id, p_external_delivery_id,
            p_payload_hash, 'AUTHENTICATED', p_provider_occurred_at, now_at,
            event_correlation, null, jsonb_build_object('CONNECTION_STATE',p_connection_state)
          ) r;
        if receipt_outcome = 'CONFLICT' then raise exception 'PROVIDER_DELIVERY_CONFLICT'; end if;
        if receipt_outcome = 'DUPLICATE' then continue; end if;
        update memoid.provider_event_receipts set disposition = 'PROCESSING',
          attempt_count = attempt_count + 1, state_changed_at = now_at
          where workspace_id = connection_row.workspace_id and project_id = connection_row.project_id
            and id = receipt_id;
        update memoid.provider_event_receipts set disposition = 'PROCESSED', state_changed_at = now_at
          where workspace_id = connection_row.workspace_id and project_id = connection_row.project_id
            and id = receipt_id;
        update memoid.github_source_connections set connection_state = p_connection_state,
          provider_occurred_at = p_provider_occurred_at, state_changed_at = now_at
          where workspace_id = connection_row.workspace_id and project_id = connection_row.project_id
            and coalesce(p_provider_occurred_at, now_at) >= coalesce(provider_occurred_at, created_at)
            and (case p_connection_state
              when 'INSTALLATION_DELETED' then 5 when 'REPOSITORY_DELETED' then 4
              when 'REPOSITORY_ACCESS_REMOVED' then 3 when 'SUSPENDED' then 2 else 1 end)
            >= (case connection_state
              when 'INSTALLATION_DELETED' then 5 when 'REPOSITORY_DELETED' then 4
              when 'REPOSITORY_ACCESS_REMOVED' then 3 when 'SUSPENDED' then 2 else 1 end);
        if found then
          changed := changed + 1;
          insert into memoid.audit_events (
            workspace_id, project_id, actor_id, category, event_type, occurred_at,
            target_type, target_key, correlation_id, provider_event_receipt_id,
            outcome, metadata
          ) values (
            connection_row.workspace_id, connection_row.project_id, source_actor_id,
            'INTEGRATION', 'GITHUB_SOURCE_CONNECTION_STATE_CHANGED', now_at,
            'SOURCE', connection_row.source_id::text, event_correlation, receipt_id,
            'SUCCESS', jsonb_build_object('PROVIDER_KEY','GITHUB',
              'INSTALLATION_ID',p_installation_id,'REPOSITORY_ID',p_repository_id,
              'CONNECTION_STATE',p_connection_state)
          );
        end if;
      end loop;
      return changed;
    end $$`.execute(db);
}

async function grantNarrowPermissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.github_connection_intents,
      memoid.github_repository_candidates, memoid.github_source_connections,
      memoid.github_provider_lifecycle_fences
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
  await sql`grant select on memoid.github_connection_intents,
      memoid.github_repository_candidates, memoid.github_source_connections
    to memoid_app`.execute(db);
  await sql`revoke all on function
      memoid.create_github_connection_intent(bytea,uuid,bytea,uuid,integer),
      memoid.rotate_github_connection_state(bytea,uuid,bytea,bytea),
      memoid.record_github_repository_candidate(bytea,uuid,bytea,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,timestamptz),
      memoid.connect_github_repository(bytea,uuid,bytea,varchar,bytea,bytea,uuid),
      memoid.apply_github_lifecycle_signal(varchar,varchar,varchar,varchar,varchar,bytea,timestamptz)
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
  await sql`grant execute on function
      memoid.create_github_connection_intent(bytea,uuid,bytea,uuid,integer),
      memoid.rotate_github_connection_state(bytea,uuid,bytea,bytea),
      memoid.record_github_repository_candidate(bytea,uuid,bytea,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,timestamptz),
      memoid.connect_github_repository(bytea,uuid,bytea,varchar,bytea,bytea,uuid)
    to memoid_app`.execute(db);
  await sql`grant usage on schema memoid to memoid_provider`.execute(db);
  await sql`grant execute on function
      memoid.apply_github_lifecycle_signal(varchar,varchar,varchar,varchar,varchar,bytea,timestamptz)
    to memoid_provider`.execute(db);
}

export const stage10eGitHubSourceProviderIdentityMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createTables(db);
    await createHumanFunctions(db);
    await createProviderFunction(db);
    await grantNarrowPermissions(db);
    // Kysely records the migration in this same transaction after up() returns.
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`drop function if exists memoid.apply_github_lifecycle_signal(varchar,varchar,varchar,varchar,varchar,bytea,timestamptz)`.execute(
      db,
    );
    await sql`drop function if exists memoid.connect_github_repository(bytea,uuid,bytea,varchar,bytea,bytea,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.record_github_repository_candidate(bytea,uuid,bytea,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,timestamptz)`.execute(
      db,
    );
    await sql`drop function if exists memoid.create_github_connection_intent(bytea,uuid,bytea,uuid,integer)`.execute(
      db,
    );
    await sql`drop function if exists memoid.rotate_github_connection_state(bytea,uuid,bytea,bytea)`.execute(
      db,
    );
    await sql`drop table if exists memoid.github_provider_lifecycle_fences`.execute(db);
    await sql`drop table if exists memoid.github_source_connections`.execute(db);
    await sql`drop table if exists memoid.github_repository_candidates`.execute(db);
    await sql`drop table if exists memoid.github_connection_intents`.execute(db);
    await sql`drop function if exists memoid.guard_github_source_connection_update()`.execute(db);
    // Kysely removes the migration record in this same transaction after down() returns.
    await sql`reset role`.execute(db);
  },
};
