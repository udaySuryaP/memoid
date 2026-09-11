import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const categoryFacetCheck = `(authority_category, authority_facet) in (
  ('IMPLEMENTATION_STATE','CODE'), ('IMPLEMENTATION_STATE','CONFIGURATION'),
  ('ARCHITECTURE_INTENT','DOCUMENTATION'), ('ARCHITECTURE_INTENT','DECISION'),
  ('PROVIDER_STATE','ISSUE_STATE'), ('PROVIDER_STATE','PULL_REQUEST_STATE')
)`;

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create table memoid.source_authority_scopes (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    authority_category varchar(40) not null,
    authority_facet varchar(40) not null,
    scope_kind varchar(20) not null,
    scope_key varchar(1024) not null,
    ref_selector varchar(24) not null,
    ref_key varchar(1024),
    version bigint not null default 0,
    current_assignment_id uuid,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint source_authority_scopes_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint source_authority_scopes_exact_id unique (workspace_id, project_id, id),
    constraint source_authority_scopes_identity unique nulls not distinct
      (workspace_id, project_id, authority_category, authority_facet, scope_kind, scope_key, ref_selector, ref_key),
    constraint source_authority_scopes_category_facet check (${categoryFacetCheck}),
    constraint source_authority_scopes_kind check (scope_kind in ('PROJECT','PATH_PREFIX')),
    constraint source_authority_scopes_scope check (
      (scope_kind = 'PROJECT' and scope_key = '/') or
      (scope_kind = 'PATH_PREFIX' and length(scope_key) between 1 and 1024
        and scope_key ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
        and scope_key !~ '(^|/)[.][.]?(/|$)')
    ),
    constraint source_authority_scopes_ref_selector check (ref_selector in ('ANY_REF','DEFAULT_BRANCH','EXACT_REF')),
    constraint source_authority_scopes_ref check (
      (ref_selector in ('ANY_REF','DEFAULT_BRANCH') and ref_key is null) or
      (ref_selector = 'EXACT_REF' and ref_key ~ '^refs/heads/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
        and ref_key !~ '(^|/)[.][.]?(/|$)')
    ),
    constraint source_authority_scopes_version check (version >= 0),
    constraint source_authority_scopes_currentness check (
      (version = 0 and current_assignment_id is null) or version > 0
    )
  )`,
    )
    .execute(db);

  await sql`create table memoid.source_authority_assignments (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    authority_scope_id uuid not null,
    assignment_version bigint not null,
    source_id uuid not null,
    source_default_ref_snapshot varchar(1024),
    effective_at timestamptz not null,
    reason_key varchar(40) not null,
    reason_note varchar(500),
    created_by_actor_id uuid not null,
    correlation_id uuid not null,
    causation_id uuid,
    idempotency_record_id uuid not null,
    supersedes_assignment_id uuid,
    created_at timestamptz not null default clock_timestamp(),
    constraint source_authority_assignments_scope_fk foreign key
      (workspace_id, project_id, authority_scope_id)
      references memoid.source_authority_scopes(workspace_id, project_id, id),
    constraint source_authority_assignments_source_fk foreign key
      (workspace_id, project_id, source_id) references memoid.sources(workspace_id, project_id, id),
    constraint source_authority_assignments_actor_fk foreign key
      (workspace_id, created_by_actor_id) references memoid.actors(workspace_id, id),
    constraint source_authority_assignments_idempotency_fk foreign key
      (workspace_id, project_id, idempotency_record_id)
      references memoid.idempotency_records(workspace_id, project_id, id),
    constraint source_authority_assignments_exact_id unique
      (workspace_id, project_id, authority_scope_id, id),
    constraint source_authority_assignments_scope_version unique
      (workspace_id, project_id, authority_scope_id, assignment_version),
    constraint source_authority_assignments_version check (assignment_version > 0),
    constraint source_authority_assignments_default_ref check (
      source_default_ref_snapshot is null or
      source_default_ref_snapshot ~ '^refs/heads/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
    ),
    constraint source_authority_assignments_reason check
      (reason_key in ('INITIAL_REVIEW','SCOPE_CORRECTION','SOURCE_REPLACEMENT','DEFAULT_BRANCH_REVALIDATION','ACCESS_DEGRADATION')),
    constraint source_authority_assignments_reason_note check
      (reason_note is null or (length(reason_note) between 1 and 500 and btrim(reason_note) = reason_note and reason_note !~ '[[:cntrl:]]')),
    constraint source_authority_assignments_correlation check
      (memoid.is_uuid_v7(correlation_id) and (causation_id is null or memoid.is_uuid_v7(causation_id)))
  )`.execute(db);

  await sql`alter table memoid.source_authority_assignments add constraint
    source_authority_assignments_supersedes_fk foreign key
    (workspace_id, project_id, authority_scope_id, supersedes_assignment_id)
    references memoid.source_authority_assignments(workspace_id, project_id, authority_scope_id, id)`.execute(
    db,
  );
  await sql`alter table memoid.source_authority_scopes add constraint
    source_authority_scopes_current_assignment_fk foreign key
    (workspace_id, project_id, id, current_assignment_id)
    references memoid.source_authority_assignments(workspace_id, project_id, authority_scope_id, id)
    deferrable initially deferred`.execute(db);

  await sql`create table memoid.source_authority_assignment_endings (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    authority_scope_id uuid not null,
    ended_assignment_id uuid not null,
    ending_version bigint not null,
    ending_kind varchar(20) not null,
    successor_assignment_id uuid,
    ended_at timestamptz not null,
    reason_key varchar(40) not null,
    reason_note varchar(500),
    ended_by_actor_id uuid not null,
    correlation_id uuid not null,
    causation_id uuid,
    idempotency_record_id uuid not null,
    recorded_at timestamptz not null default clock_timestamp(),
    constraint source_authority_endings_scope_fk foreign key
      (workspace_id, project_id, authority_scope_id)
      references memoid.source_authority_scopes(workspace_id, project_id, id),
    constraint source_authority_endings_assignment_fk foreign key
      (workspace_id, project_id, authority_scope_id, ended_assignment_id)
      references memoid.source_authority_assignments(workspace_id, project_id, authority_scope_id, id),
    constraint source_authority_endings_successor_fk foreign key
      (workspace_id, project_id, authority_scope_id, successor_assignment_id)
      references memoid.source_authority_assignments(workspace_id, project_id, authority_scope_id, id),
    constraint source_authority_endings_actor_fk foreign key
      (workspace_id, ended_by_actor_id) references memoid.actors(workspace_id, id),
    constraint source_authority_endings_idempotency_fk foreign key
      (workspace_id, project_id, idempotency_record_id)
      references memoid.idempotency_records(workspace_id, project_id, id),
    constraint source_authority_endings_assignment_unique unique
      (workspace_id, project_id, authority_scope_id, ended_assignment_id),
    constraint source_authority_endings_scope_version unique
      (workspace_id, project_id, authority_scope_id, ending_version),
    constraint source_authority_endings_kind check (ending_kind in ('SUPERSEDED','REVOKED')),
    constraint source_authority_endings_successor check (
      (ending_kind = 'SUPERSEDED' and successor_assignment_id is not null) or
      (ending_kind = 'REVOKED' and successor_assignment_id is null)
    ),
    constraint source_authority_endings_version check (ending_version > 0),
    constraint source_authority_endings_reason check
      (reason_key in ('INITIAL_REVIEW','SCOPE_CORRECTION','SOURCE_REPLACEMENT','DEFAULT_BRANCH_REVALIDATION','ACCESS_DEGRADATION')),
    constraint source_authority_endings_reason_note check
      (reason_note is null or (length(reason_note) between 1 and 500 and btrim(reason_note) = reason_note and reason_note !~ '[[:cntrl:]]')),
    constraint source_authority_endings_correlation check
      (memoid.is_uuid_v7(correlation_id) and (causation_id is null or memoid.is_uuid_v7(causation_id)))
  )`.execute(db);

  await sql`create index source_authority_assignments_source_idx on memoid.source_authority_assignments
    (workspace_id, project_id, source_id, effective_at desc)`.execute(db);
  await sql`comment on table memoid.source_authority_assignments is
    'Immutable reviewed authority decisions; Source evidence authority never grants instruction or application authority.'`.execute(
    db,
  );
}

async function createGuards(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.guard_source_authority_history() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin raise exception 'source authority history is immutable'; end $$`.execute(db);
  await sql`create trigger source_authority_assignments_immutable before update or delete
    on memoid.source_authority_assignments for each row execute function memoid.guard_source_authority_history()`.execute(
    db,
  );
  await sql`create trigger source_authority_endings_immutable before update or delete
    on memoid.source_authority_assignment_endings for each row execute function memoid.guard_source_authority_history()`.execute(
    db,
  );
  await sql`create function memoid.guard_source_authority_scope_update() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin
      if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id or new.id <> old.id
        or new.authority_category <> old.authority_category or new.authority_facet <> old.authority_facet
        or new.scope_kind <> old.scope_kind or new.scope_key <> old.scope_key
        or new.ref_selector <> old.ref_selector or new.ref_key is distinct from old.ref_key
        or new.created_at <> old.created_at or new.version <> old.version + 1
        or new.current_assignment_id is not distinct from old.current_assignment_id
      then raise exception 'invalid source authority scope transition'; end if;
      new.updated_at := clock_timestamp();
      return new;
    end $$`.execute(db);
  await sql`create trigger source_authority_scope_transition before update
    on memoid.source_authority_scopes for each row execute function memoid.guard_source_authority_scope_update()`.execute(
    db,
  );
}

async function createRls(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "source_authority_scopes",
    "source_authority_assignments",
    "source_authority_assignment_endings",
  ]) {
    await sql.raw(`alter table memoid.${table} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${table} force row level security`).execute(db);
    await sql
      .raw(
        `create policy project_scope on memoid.${table}
      using (workspace_id = memoid.current_workspace_id() and project_id = memoid.current_project_id())
      with check (workspace_id = memoid.current_workspace_id() and project_id = memoid.current_project_id())`,
      )
      .execute(db);
  }
}

async function createFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.has_source_authority_step_up(
      p_session_token_hash bytea, p_project_id uuid
    ) returns boolean language sql stable security definer set search_path = pg_catalog, memoid as $$
    select session_user = 'memoid_app' and exists (
      select 1 from memoid.auth_sessions current_session
      join memoid.account_security_states security_state on security_state.account_id = current_session.account_id
      join memoid.account_identity_bindings binding on binding.id = current_session.identity_binding_id
      join memoid.projects project on project.workspace_id = memoid.current_workspace_id()
        and project.id = p_project_id and project.lifecycle_state = 'ACTIVE'
      join memoid.workspaces workspace on workspace.id = project.workspace_id
        and workspace.account_id = current_session.account_id
      join memoid.auth_step_up_intents intent
        on intent.auth_session_id = current_session.rotated_from_session_id
        and intent.action_key = 'MANAGE_SOURCE_AUTHORITY'
        and intent.workspace_id = project.workspace_id and intent.project_id = project.id
        and intent.consumed_at is not null and intent.consumed_at >= clock_timestamp() - interval '15 minutes'
      where current_session.token_hash = p_session_token_hash
        and current_session.account_id = memoid.current_account_id()
        and current_session.revoked_at is null and current_session.security_epoch = security_state.security_epoch
        and security_state.disabled_at is null and binding.state = 'ACTIVE' and binding.email_verified
        and clock_timestamp() < current_session.absolute_expires_at
        and clock_timestamp() < current_session.idle_expires_at
        and clock_timestamp() < current_session.provider_expires_at
        and clock_timestamp() - current_session.fresh_authenticated_at <= interval '15 minutes'
    ) $$`.execute(db);

  await sql`create function memoid.set_source_authority(
      p_session_token_hash bytea, p_project_id uuid, p_source_id uuid,
      p_category_facet varchar, p_scope_kind varchar, p_scope_key varchar,
      p_ref_selector varchar, p_ref_key varchar, p_expected_version bigint,
      p_reason_key varchar, p_reason_note varchar, p_idempotency_key_hash bytea,
      p_request_fingerprint bytea, p_correlation_id uuid, p_causation_id uuid default null
    ) returns table (assignment_id uuid, scope_id uuid, scope_version bigint, replayed boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_row memoid.auth_sessions%rowtype;
      project_row memoid.projects%rowtype;
      source_row memoid.sources%rowtype;
      github_row memoid.github_source_connections%rowtype;
      actor_row memoid.actors%rowtype;
      scope_row memoid.source_authority_scopes%rowtype;
      previous_assignment uuid;
      new_assignment uuid;
      new_version bigint;
      default_ref_snapshot varchar;
      claim_row record;
      now_at timestamptz := clock_timestamp();
      category_value varchar := split_part(p_category_facet, ':', 1);
      facet_value varchar := split_part(p_category_facet, ':', 2);
    begin
      if session_user <> 'memoid_app' then raise exception 'AUTHORITY_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32 or octet_length(p_idempotency_key_hash) <> 32
        or octet_length(p_request_fingerprint) <> 32 or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
        or p_expected_version < 0 or p_category_facet not in (
          'IMPLEMENTATION_STATE:CODE','IMPLEMENTATION_STATE:CONFIGURATION',
          'ARCHITECTURE_INTENT:DOCUMENTATION','ARCHITECTURE_INTENT:DECISION',
          'PROVIDER_STATE:ISSUE_STATE','PROVIDER_STATE:PULL_REQUEST_STATE')
        or p_scope_kind not in ('PROJECT','PATH_PREFIX')
        or not ((p_scope_kind = 'PROJECT' and p_scope_key = '/') or
          (p_scope_kind = 'PATH_PREFIX' and length(p_scope_key) between 1 and 1024
            and p_scope_key ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' and p_scope_key !~ '(^|/)[.][.]?(/|$)'))
        or p_ref_selector not in ('ANY_REF','DEFAULT_BRANCH','EXACT_REF')
        or not ((p_ref_selector in ('ANY_REF','DEFAULT_BRANCH') and p_ref_key is null) or
          (p_ref_selector = 'EXACT_REF' and p_ref_key ~ '^refs/heads/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'))
        or p_reason_key not in ('INITIAL_REVIEW','SCOPE_CORRECTION','SOURCE_REPLACEMENT','DEFAULT_BRANCH_REVALIDATION','ACCESS_DEGRADATION')
        or (p_reason_note is not null and (length(p_reason_note) not between 1 and 500
          or btrim(p_reason_note) <> p_reason_note or p_reason_note ~ '[[:cntrl:]]'))
      then raise exception 'INVALID_SOURCE_AUTHORITY_REQUEST'; end if;
      select s.* into session_row from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if not memoid.has_source_authority_step_up(p_session_token_hash, p_project_id)
      then raise exception 'SOURCE_AUTHORITY_STEP_UP_REQUIRED'; end if;
      select * into project_row from memoid.projects where workspace_id = memoid.current_workspace_id()
        and id = p_project_id and p_project_id = memoid.current_project_id() for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state <> 'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      select * into actor_row from memoid.actors where workspace_id = project_row.workspace_id
        and id = memoid.current_actor_id() and actor_kind = 'HUMAN'
        and actor_reference = 'account:' || session_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;
      select * into source_row from memoid.sources where workspace_id = project_row.workspace_id
        and project_id = project_row.id and id = p_source_id for update;
      if not found or source_row.source_kind <> 'GITHUB_REPOSITORY'
      then raise exception 'SOURCE_UNAVAILABLE'; end if;
      select * into github_row from memoid.github_source_connections
        where workspace_id = project_row.workspace_id and project_id = project_row.id
          and source_id = source_row.id for update;
      if not found or github_row.connection_state <> 'ACTIVE' then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if p_ref_selector = 'DEFAULT_BRANCH' then
        default_ref_snapshot := 'refs/heads/' || github_row.default_branch;
      end if;
      select * into claim_row from memoid.claim_idempotency(
        project_row.workspace_id, project_row.id, actor_row.id, 'SOURCE_AUTHORITY_SET',
        p_idempotency_key_hash, p_request_fingerprint, p_correlation_id, p_causation_id,
        60, now_at + interval '24 hours');
      if claim_row.claim_outcome = 'CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome = 'IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome = 'TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome = 'REPLAY' then
        select a.id, a.authority_scope_id, a.assignment_version into new_assignment, scope_id, new_version
          from memoid.source_authority_assignments a
          where a.workspace_id = project_row.workspace_id and a.project_id = project_row.id
            and a.id = claim_row.stable_result_reference::uuid;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select new_assignment, scope_id, new_version, true;
        return;
      end if;
      select * into scope_row from memoid.source_authority_scopes s
        where s.workspace_id = project_row.workspace_id and s.project_id = project_row.id
          and s.authority_category = category_value and s.authority_facet = facet_value
          and s.scope_kind = p_scope_kind and s.scope_key = p_scope_key
          and s.ref_selector = p_ref_selector and s.ref_key is not distinct from p_ref_key for update;
      if not found then
        if p_expected_version <> 0 then raise exception 'STALE_AUTHORITY_VERSION'; end if;
        insert into memoid.source_authority_scopes (
          workspace_id, project_id, authority_category, authority_facet, scope_kind, scope_key,
          ref_selector, ref_key) values (
          project_row.workspace_id, project_row.id, category_value, facet_value, p_scope_kind,
          p_scope_key, p_ref_selector, p_ref_key) returning * into scope_row;
      elsif scope_row.version <> p_expected_version then
        raise exception 'STALE_AUTHORITY_VERSION';
      end if;
      previous_assignment := scope_row.current_assignment_id;
      new_version := scope_row.version + 1;
      insert into memoid.source_authority_assignments (
        workspace_id, project_id, authority_scope_id, assignment_version, source_id,
        source_default_ref_snapshot, effective_at, reason_key, reason_note, created_by_actor_id,
        correlation_id, causation_id, idempotency_record_id, supersedes_assignment_id
      ) values (
        project_row.workspace_id, project_row.id, scope_row.id, new_version, source_row.id,
        default_ref_snapshot, now_at, p_reason_key, p_reason_note, actor_row.id,
        p_correlation_id, p_causation_id, claim_row.idempotency_record_id, previous_assignment
      ) returning id into new_assignment;
      if previous_assignment is not null then
        insert into memoid.source_authority_assignment_endings (
          workspace_id, project_id, authority_scope_id, ended_assignment_id, ending_version,
          ending_kind, successor_assignment_id, ended_at, reason_key, reason_note,
          ended_by_actor_id, correlation_id, causation_id, idempotency_record_id
        ) values (
          project_row.workspace_id, project_row.id, scope_row.id, previous_assignment, new_version,
          'SUPERSEDED', new_assignment, now_at, p_reason_key, p_reason_note,
          actor_row.id, p_correlation_id, p_causation_id, claim_row.idempotency_record_id);
      end if;
      update memoid.source_authority_scopes set version = new_version,
        current_assignment_id = new_assignment where id = scope_row.id;
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type,
        target_key, correlation_id, causation_id, idempotency_record_id, outcome, metadata
      ) values (
        project_row.workspace_id, project_row.id, actor_row.id, 'DATA_INTEGRITY',
        case when previous_assignment is null then 'SOURCE_AUTHORITY_ASSIGNED' else 'SOURCE_AUTHORITY_REPLACED' end,
        now_at, 'AUTHORITY_ASSIGNMENT', new_assignment::text, p_correlation_id, p_causation_id,
        claim_row.idempotency_record_id, 'SUCCESS', jsonb_build_object(
          'AUTHORITY_CATEGORY',category_value,'AUTHORITY_FACET',facet_value,
          'SCOPE_KIND',p_scope_kind,'REF_SELECTOR',p_ref_selector,'SOURCE_ID',source_row.id::text,
          'AUTHORITY_VERSION',new_version));
      perform memoid.finish_idempotency(
        project_row.workspace_id, project_row.id, claim_row.idempotency_record_id,
        claim_row.active_claim_token, 'COMPLETED', 'AUTHORITY_ASSIGNMENT', new_assignment::text,
        null, sha256(convert_to(new_assignment::text,'UTF8')), 200,
        jsonb_build_object('REPLAYABLE',true), null, null);
      return query select new_assignment, scope_row.id, new_version, false;
    end $$`.execute(db);

  await sql`create function memoid.revoke_source_authority(
      p_session_token_hash bytea, p_project_id uuid, p_scope_id uuid, p_expected_version bigint,
      p_reason_key varchar, p_reason_note varchar, p_idempotency_key_hash bytea,
      p_request_fingerprint bytea, p_correlation_id uuid, p_causation_id uuid default null
    ) returns table (scope_id uuid, scope_version bigint, replayed boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_row memoid.auth_sessions%rowtype;
      project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype;
      scope_row memoid.source_authority_scopes%rowtype;
      ending_id uuid;
      new_version bigint;
      claim_row record;
      now_at timestamptz := clock_timestamp();
    begin
      if session_user <> 'memoid_app' then raise exception 'AUTHORITY_CALLER_FORBIDDEN'; end if;
      if octet_length(p_session_token_hash) <> 32 or octet_length(p_idempotency_key_hash) <> 32
        or octet_length(p_request_fingerprint) <> 32 or p_expected_version < 1
        or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
        or p_reason_key not in ('INITIAL_REVIEW','SCOPE_CORRECTION','SOURCE_REPLACEMENT','DEFAULT_BRANCH_REVALIDATION','ACCESS_DEGRADATION')
        or (p_reason_note is not null and (length(p_reason_note) not between 1 and 500
          or btrim(p_reason_note) <> p_reason_note or p_reason_note ~ '[[:cntrl:]]'))
      then raise exception 'INVALID_SOURCE_AUTHORITY_REQUEST'; end if;
      select s.* into session_row from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if not memoid.has_source_authority_step_up(p_session_token_hash, p_project_id)
      then raise exception 'SOURCE_AUTHORITY_STEP_UP_REQUIRED'; end if;
      select * into project_row from memoid.projects where workspace_id = memoid.current_workspace_id()
        and id = p_project_id and p_project_id = memoid.current_project_id() for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state <> 'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      select * into actor_row from memoid.actors where workspace_id = project_row.workspace_id
        and id = memoid.current_actor_id() and actor_kind = 'HUMAN'
        and actor_reference = 'account:' || session_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;
      select * into claim_row from memoid.claim_idempotency(
        project_row.workspace_id, project_row.id, actor_row.id, 'SOURCE_AUTHORITY_REVOKE',
        p_idempotency_key_hash, p_request_fingerprint, p_correlation_id, p_causation_id,
        60, now_at + interval '24 hours');
      if claim_row.claim_outcome = 'CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome = 'IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome = 'TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome = 'REPLAY' then
        select e.authority_scope_id, e.ending_version into scope_id, new_version
          from memoid.source_authority_assignment_endings e
          where e.workspace_id = project_row.workspace_id and e.project_id = project_row.id
            and e.id = claim_row.stable_result_reference::uuid;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select scope_id, new_version, true;
        return;
      end if;
      select * into scope_row from memoid.source_authority_scopes s
        where s.workspace_id = project_row.workspace_id and s.project_id = project_row.id
          and s.id = p_scope_id for update;
      if not found or scope_row.current_assignment_id is null then raise exception 'AUTHORITY_ASSIGNMENT_NOT_FOUND'; end if;
      if scope_row.version <> p_expected_version then raise exception 'STALE_AUTHORITY_VERSION'; end if;
      new_version := scope_row.version + 1;
      insert into memoid.source_authority_assignment_endings (
        workspace_id, project_id, authority_scope_id, ended_assignment_id, ending_version,
        ending_kind, ended_at, reason_key, reason_note, ended_by_actor_id, correlation_id,
        causation_id, idempotency_record_id
      ) values (
        project_row.workspace_id, project_row.id, scope_row.id, scope_row.current_assignment_id,
        new_version, 'REVOKED', now_at, p_reason_key, p_reason_note, actor_row.id,
        p_correlation_id, p_causation_id, claim_row.idempotency_record_id
      ) returning id into ending_id;
      update memoid.source_authority_scopes set version = new_version,
        current_assignment_id = null where id = scope_row.id;
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type,
        target_key, correlation_id, causation_id, idempotency_record_id, outcome, metadata
      ) values (
        project_row.workspace_id, project_row.id, actor_row.id, 'DATA_INTEGRITY',
        'SOURCE_AUTHORITY_REVOKED', now_at, 'AUTHORITY_SCOPE', scope_row.id::text,
        p_correlation_id, p_causation_id, claim_row.idempotency_record_id, 'SUCCESS',
        jsonb_build_object('AUTHORITY_CATEGORY',scope_row.authority_category,
          'AUTHORITY_FACET',scope_row.authority_facet,'SCOPE_KIND',scope_row.scope_kind,
          'REF_SELECTOR',scope_row.ref_selector,'AUTHORITY_VERSION',new_version));
      perform memoid.finish_idempotency(
        project_row.workspace_id, project_row.id, claim_row.idempotency_record_id,
        claim_row.active_claim_token, 'COMPLETED', 'AUTHORITY_ENDING', ending_id::text,
        null, sha256(convert_to(ending_id::text,'UTF8')), 200,
        jsonb_build_object('REPLAYABLE',true), null, null);
      return query select scope_row.id, new_version, false;
    end $$`.execute(db);
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.source_authority_scopes, memoid.source_authority_assignments,
    memoid.source_authority_assignment_endings from public, memoid_app, memoid_auth, memoid_provider`.execute(
    db,
  );
  await sql`grant select on memoid.source_authority_scopes, memoid.source_authority_assignments,
    memoid.source_authority_assignment_endings to memoid_app`.execute(db);
  await sql`revoke all on function
    memoid.guard_source_authority_history(),
    memoid.guard_source_authority_scope_update(),
    memoid.has_source_authority_step_up(bytea,uuid),
    memoid.set_source_authority(bytea,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,varchar,varchar,bytea,bytea,uuid,uuid),
    memoid.revoke_source_authority(bytea,uuid,uuid,bigint,varchar,varchar,bytea,bytea,uuid,uuid)
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
  await sql`grant execute on function
    memoid.has_source_authority_step_up(bytea,uuid),
    memoid.set_source_authority(bytea,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,varchar,varchar,bytea,bytea,uuid,uuid),
    memoid.revoke_source_authority(bytea,uuid,uuid,bigint,varchar,varchar,bytea,bytea,uuid,uuid)
    to memoid_app`.execute(db);
}

export const stage10gSourceAuthorityMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createTables(db);
    await createGuards(db);
    await createRls(db);
    await createFunctions(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`drop function if exists memoid.revoke_source_authority(bytea,uuid,uuid,bigint,varchar,varchar,bytea,bytea,uuid,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.set_source_authority(bytea,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,varchar,varchar,bytea,bytea,uuid,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.has_source_authority_step_up(bytea,uuid)`.execute(db);
    await sql`drop table if exists memoid.source_authority_assignment_endings`.execute(db);
    await sql`alter table memoid.source_authority_scopes drop constraint if exists source_authority_scopes_current_assignment_fk`.execute(
      db,
    );
    await sql`drop table if exists memoid.source_authority_assignments`.execute(db);
    await sql`drop table if exists memoid.source_authority_scopes`.execute(db);
    await sql`drop function if exists memoid.guard_source_authority_scope_update()`.execute(db);
    await sql`drop function if exists memoid.guard_source_authority_history()`.execute(db);
    await sql`reset role`.execute(db);
  },
};
