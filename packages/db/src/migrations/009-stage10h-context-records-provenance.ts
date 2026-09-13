import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

async function extendContextFoundation(db: Kysely<unknown>): Promise<void> {
  await sql`alter table memoid.source_authority_assignments add constraint
    source_authority_assignments_stage10h_project_id_unique
    unique (workspace_id, project_id, id)`.execute(db);
  await sql`alter table memoid.context_identities
    add column lifecycle_state varchar(16) not null default 'ACTIVE',
    add column version bigint not null default 1,
    add column ended_at timestamptz,
    add constraint context_identities_lifecycle check (lifecycle_state in ('ACTIVE','ENDED')),
    add constraint context_identities_version_positive check (version > 0),
    add constraint context_identities_ending_shape check (
      (lifecycle_state = 'ACTIVE' and ended_at is null) or
      (lifecycle_state = 'ENDED' and ended_at is not null and ended_at >= created_at)
    )`.execute(db);

  await sql`create table memoid.context_record_origins (
    workspace_id uuid not null,
    project_id uuid not null,
    context_record_id uuid not null,
    context_identity_id uuid not null,
    origin_kind varchar(24) not null,
    record_version bigint not null,
    supersedes_context_record_id uuid,
    created_by_actor_id uuid not null,
    idempotency_record_id uuid not null,
    correlation_id uuid not null,
    causation_id uuid,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, context_record_id),
    constraint context_record_origins_record_fk foreign key
      (workspace_id, project_id, context_identity_id, context_record_id)
      references memoid.context_records(workspace_id, project_id, context_identity_id, id),
    constraint context_record_origins_supersedes_fk foreign key
      (workspace_id, project_id, context_identity_id, supersedes_context_record_id)
      references memoid.context_records(workspace_id, project_id, context_identity_id, id),
    constraint context_record_origins_actor_fk foreign key (workspace_id, created_by_actor_id)
      references memoid.actors(workspace_id, id),
    constraint context_record_origins_idempotency_fk foreign key
      (workspace_id, project_id, idempotency_record_id)
      references memoid.idempotency_records(workspace_id, project_id, id),
    constraint context_record_origins_kind check
      (origin_kind in ('USER_NATIVE','SOURCE_EVIDENCE','MEMOID_OPERATION')),
    constraint context_record_origins_version check (record_version > 0),
    constraint context_record_origins_identity_version unique
      (workspace_id, project_id, context_identity_id, record_version),
    constraint context_record_origins_successor_unique unique
      (workspace_id, project_id, context_identity_id, supersedes_context_record_id),
    constraint context_record_origins_first_or_successor check
      ((record_version = 1 and supersedes_context_record_id is null) or
       (record_version > 1 and supersedes_context_record_id is not null)),
    constraint context_record_origins_trace check
      (memoid.is_uuid_v7(correlation_id) and (causation_id is null or memoid.is_uuid_v7(causation_id)))
  )`.execute(db);

  await sql`create table memoid.context_record_evidence_provenance (
    workspace_id uuid not null,
    project_id uuid not null,
    context_record_id uuid not null,
    context_identity_id uuid not null,
    evidence_reference_id uuid not null,
    source_id uuid not null,
    source_observation_id uuid not null,
    frontier_unit_id uuid not null,
    covered_observation_sequence bigint not null,
    source_authority_assignment_id uuid not null,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, context_record_id, evidence_reference_id),
    constraint context_record_evidence_record_fk foreign key
      (workspace_id, project_id, context_identity_id, context_record_id)
      references memoid.context_records(workspace_id, project_id, context_identity_id, id),
    constraint context_record_evidence_reference_fk foreign key
      (workspace_id, project_id, evidence_reference_id)
      references memoid.evidence_references(workspace_id, project_id, id),
    constraint context_record_evidence_source_fk foreign key
      (workspace_id, project_id, source_id) references memoid.sources(workspace_id, project_id, id),
    constraint context_record_evidence_observation_fk foreign key
      (workspace_id, project_id, source_observation_id)
      references memoid.source_observations(workspace_id, project_id, id),
    constraint context_record_evidence_coverage_fk foreign key
      (workspace_id, project_id, frontier_unit_id, covered_observation_sequence)
      references memoid.source_observations(workspace_id, project_id, frontier_unit_id, observation_sequence),
    constraint context_record_evidence_authority_fk foreign key
      (workspace_id, project_id, source_authority_assignment_id)
      references memoid.source_authority_assignments(workspace_id, project_id, id),
    constraint context_record_evidence_sequence check (covered_observation_sequence > 0)
  )`.execute(db);

  await sql`create table memoid.context_identity_endings (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    context_identity_id uuid not null,
    ended_current_record_id uuid,
    identity_version bigint not null,
    reason_key varchar(32) not null,
    reason_note varchar(500),
    ended_by_actor_id uuid not null,
    idempotency_record_id uuid not null,
    correlation_id uuid not null,
    causation_id uuid,
    ended_at timestamptz not null,
    recorded_at timestamptz not null default clock_timestamp(),
    constraint context_identity_endings_identity_fk foreign key
      (workspace_id, project_id, context_identity_id)
      references memoid.context_identities(workspace_id, project_id, id),
    constraint context_identity_endings_record_fk foreign key
      (workspace_id, project_id, context_identity_id, ended_current_record_id)
      references memoid.context_records(workspace_id, project_id, context_identity_id, id),
    constraint context_identity_endings_actor_fk foreign key (workspace_id, ended_by_actor_id)
      references memoid.actors(workspace_id, id),
    constraint context_identity_endings_idempotency_fk foreign key
      (workspace_id, project_id, idempotency_record_id)
      references memoid.idempotency_records(workspace_id, project_id, id),
    constraint context_identity_endings_once unique (workspace_id, project_id, context_identity_id),
    constraint context_identity_endings_version check (identity_version > 1),
    constraint context_identity_endings_reason check
      (reason_key in ('RETIRED','INVALIDATED','NO_LONGER_APPLICABLE')),
    constraint context_identity_endings_note check
      (reason_note is null or (length(reason_note) between 1 and 500
        and btrim(reason_note) = reason_note and reason_note !~ '[[:cntrl:]]')),
    constraint context_identity_endings_trace check
      (memoid.is_uuid_v7(correlation_id) and (causation_id is null or memoid.is_uuid_v7(causation_id)))
  )`.execute(db);
}

async function guards(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.guard_context_history() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin raise exception 'Context history is immutable'; end $$`.execute(db);
  for (const table of [
    "context_record_origins",
    "context_record_evidence_provenance",
    "context_identity_endings",
  ]) {
    await sql
      .raw(
        `create trigger ${table}_immutable before update or delete on memoid.${table}
      for each row execute function memoid.guard_context_history()`,
      )
      .execute(db);
  }

  await sql`create function memoid.guard_context_identity_transition() returns trigger
    language plpgsql set search_path = pg_catalog, memoid as $$
    begin
      if row(new.id,new.workspace_id,new.project_id,new.subject_key,new.scope_key,new.facet_key,
        new.predicate_key,new.created_at) is distinct from
        row(old.id,old.workspace_id,old.project_id,old.subject_key,old.scope_key,old.facet_key,
        old.predicate_key,old.created_at)
        or new.version <> old.version + 1
        or not ((old.lifecycle_state = 'ACTIVE' and new.lifecycle_state = 'ACTIVE'
          and new.ended_at is null) or (old.lifecycle_state = 'ACTIVE'
          and new.lifecycle_state = 'ENDED' and new.ended_at is not null))
      then raise exception 'INVALID_CONTEXT_IDENTITY_TRANSITION'; end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger context_identity_transition before update on memoid.context_identities
    for each row execute function memoid.guard_context_identity_transition()`.execute(db);

  await sql`create or replace function memoid.require_context_record_provenance() returns trigger
    language plpgsql as $$
    declare record_workspace_id uuid; record_project_id uuid; record_id uuid;
    begin
      if tg_table_name = 'context_records' then
        record_workspace_id := new.workspace_id; record_project_id := new.project_id; record_id := new.id;
      else
        record_workspace_id := old.workspace_id; record_project_id := old.project_id;
        record_id := old.context_record_id;
      end if;
      perform 1 from memoid.context_records where workspace_id = record_workspace_id
        and project_id = record_project_id and id = record_id for update;
      if not exists (select 1 from memoid.context_record_origins where workspace_id = record_workspace_id
          and project_id = record_project_id and context_record_id = record_id)
        and not exists (select 1 from memoid.context_record_candidate_provenance where workspace_id = record_workspace_id
          and project_id = record_project_id and context_record_id = record_id)
        and not exists (select 1 from memoid.context_record_source_provenance where workspace_id = record_workspace_id
          and project_id = record_project_id and context_record_id = record_id)
      then raise exception 'reviewed Context Record requires explicit provenance'; end if;
      return null;
    end $$`.execute(db);
}

async function rlsAndIndexes(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "context_record_origins",
    "context_record_evidence_provenance",
    "context_identity_endings",
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
  await sql`create index context_record_origins_identity_idx on memoid.context_record_origins
    (workspace_id, project_id, context_identity_id, record_version desc)`.execute(db);
  await sql`create index context_record_evidence_source_idx on memoid.context_record_evidence_provenance
    (workspace_id, project_id, source_id, frontier_unit_id, covered_observation_sequence)`.execute(
    db,
  );
}

const authenticatedMutationPrefix = `
      if session_user <> 'memoid_app' then raise exception 'CONTEXT_CALLER_FORBIDDEN'; end if;
      select s.* into session_row from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id = s.account_id
        join memoid.account_identity_bindings binding on binding.id = s.identity_binding_id
        where s.token_hash = p_session_token_hash and s.account_id = memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch = security_state.security_epoch and now_at < s.absolute_expires_at
          and now_at < s.idle_expires_at and now_at < s.provider_expires_at
          and binding.state = 'ACTIVE' and binding.email_verified for update of s, security_state, binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into project_row from memoid.projects where workspace_id = memoid.current_workspace_id()
        and id = p_project_id and p_project_id = memoid.current_project_id() for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state <> 'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      select * into actor_row from memoid.actors where workspace_id = project_row.workspace_id
        and id = memoid.current_actor_id() and actor_kind = 'HUMAN'
        and actor_reference = 'account:' || session_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;`;

async function functions(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.put_context_record(
      p_session_token_hash bytea, p_project_id uuid,
      p_subject_key varchar, p_scope_key varchar, p_facet_key varchar, p_predicate_key varchar,
      p_expected_identity_version bigint, p_expected_current_record_id uuid,
      p_assertion_payload jsonb, p_origin_kind varchar,
      p_evidence_reference_id uuid, p_source_authority_assignment_id uuid,
      p_idempotency_key_hash bytea, p_request_fingerprint bytea,
      p_correlation_id uuid, p_causation_id uuid default null
    ) returns table (context_identity_id uuid, context_record_id uuid,
      identity_version bigint, record_version bigint, replayed boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      session_row memoid.auth_sessions%rowtype; project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype; identity_row memoid.context_identities%rowtype;
      current_row memoid.context_identity_current_records%rowtype;
      evidence_row memoid.evidence_references%rowtype; frontier_row memoid.source_frontier_states%rowtype;
      revision_id uuid; new_record_id uuid; new_identity_version bigint; new_record_version bigint;
      policy_version bigint; revision_sequence bigint; claim_row record; now_at timestamptz := clock_timestamp();
    begin
      if octet_length(p_session_token_hash) <> 32 or octet_length(p_idempotency_key_hash) <> 32
        or octet_length(p_request_fingerprint) <> 32 or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
        or p_expected_identity_version < 0
        or p_subject_key !~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'
        or p_scope_key !~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'
        or p_facet_key !~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'
        or p_predicate_key !~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'
        or jsonb_typeof(p_assertion_payload) <> 'object' or octet_length(p_assertion_payload::text) > 65536
        or p_origin_kind not in ('USER_NATIVE','SOURCE_EVIDENCE')
        or not ((p_origin_kind = 'USER_NATIVE' and p_evidence_reference_id is null
          and p_source_authority_assignment_id is null) or (p_origin_kind = 'SOURCE_EVIDENCE'
          and p_evidence_reference_id is not null and p_source_authority_assignment_id is not null))
      then raise exception 'INVALID_CONTEXT_REQUEST'; end if;
${authenticatedMutationPrefix}
      select * into claim_row from memoid.claim_idempotency(project_row.workspace_id, project_row.id,
        actor_row.id, 'CONTEXT_RECORD_PUT', p_idempotency_key_hash, p_request_fingerprint,
        p_correlation_id, p_causation_id, 60, now_at + interval '24 hours');
      if claim_row.claim_outcome = 'CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome = 'IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome = 'TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome = 'REPLAY' then
        select o.context_identity_id, o.context_record_id, i.version, o.record_version
          into context_identity_id, context_record_id, identity_version, record_version
          from memoid.context_record_origins o join memoid.context_identities i
            on i.workspace_id=o.workspace_id and i.project_id=o.project_id and i.id=o.context_identity_id
          where o.workspace_id=project_row.workspace_id and o.project_id=project_row.id
            and o.context_record_id=claim_row.stable_result_reference::uuid;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select context_identity_id, context_record_id, identity_version, record_version, true;
        return;
      end if;
      select * into identity_row from memoid.context_identities where workspace_id=project_row.workspace_id
        and project_id=project_row.id and subject_key=p_subject_key and scope_key=p_scope_key
        and facet_key=p_facet_key and predicate_key=p_predicate_key for update;
      if not found then
        if p_expected_identity_version <> 0 or p_expected_current_record_id is not null
          then raise exception 'STALE_CONTEXT_VERSION'; end if;
        insert into memoid.context_identities(workspace_id,project_id,subject_key,scope_key,facet_key,predicate_key)
          values(project_row.workspace_id,project_row.id,p_subject_key,p_scope_key,p_facet_key,p_predicate_key)
          returning * into identity_row;
        new_identity_version := 1; new_record_version := 1;
      else
        if identity_row.lifecycle_state <> 'ACTIVE' then raise exception 'CONTEXT_IDENTITY_ENDED'; end if;
        if identity_row.version <> p_expected_identity_version then raise exception 'STALE_CONTEXT_VERSION'; end if;
        select * into current_row from memoid.context_identity_current_records where
          workspace_id=project_row.workspace_id and project_id=project_row.id
          and context_identity_id=identity_row.id for update;
        if not found or current_row.context_record_id is distinct from p_expected_current_record_id
          then raise exception 'STALE_CONTEXT_CURRENT_RECORD'; end if;
        new_identity_version := identity_row.version + 1;
        select coalesce(max(record_version),0)+1 into new_record_version from memoid.context_record_origins
          where workspace_id=project_row.workspace_id and project_id=project_row.id
            and context_identity_id=identity_row.id;
      end if;
      if p_origin_kind = 'SOURCE_EVIDENCE' then
        select * into evidence_row from memoid.evidence_references where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=p_evidence_reference_id;
        if not found then raise exception 'INVALID_CONTEXT_EVIDENCE'; end if;
        perform 1 from memoid.source_authority_assignments a join memoid.source_authority_scopes s
            on s.workspace_id=a.workspace_id and s.project_id=a.project_id and s.id=a.authority_scope_id
          join memoid.github_source_connections g on g.workspace_id=a.workspace_id
            and g.project_id=a.project_id and g.source_id=a.source_id
          join memoid.source_frontier_units u on u.workspace_id=evidence_row.workspace_id
            and u.project_id=evidence_row.project_id and u.id=evidence_row.frontier_unit_id
          where a.workspace_id=project_row.workspace_id and a.project_id=project_row.id
            and a.id=p_source_authority_assignment_id and a.source_id=evidence_row.source_id
            and s.current_assignment_id=a.id and g.connection_state='ACTIVE'
            and (s.scope_kind='PROJECT' or evidence_row.repository_path=s.scope_key
              or evidence_row.repository_path like s.scope_key || '/%')
            and (s.ref_selector='ANY_REF' or (s.ref_selector='EXACT_REF' and s.ref_key=u.ref_key)
              or (s.ref_selector='DEFAULT_BRANCH' and a.source_default_ref_snapshot=u.ref_key
                and a.source_default_ref_snapshot='refs/heads/' || g.default_branch));
        if not found then raise exception 'CONTEXT_AUTHORITY_UNAVAILABLE'; end if;
        select * into frontier_row from memoid.source_frontier_states where
          workspace_id=evidence_row.workspace_id and project_id=evidence_row.project_id
          and frontier_unit_id=evidence_row.frontier_unit_id;
        if not found or frontier_row.ingested_sequence is null
          or frontier_row.ingested_sequence < evidence_row.observation_sequence
          or coalesce(frontier_row.desired_sequence,0) > coalesce(frontier_row.ingested_sequence,0)
        then raise exception 'CONTEXT_SOURCE_NOT_CURRENT'; end if;
      end if;
      select version into policy_version from memoid.project_review_policy_versions
        where workspace_id=project_row.workspace_id and project_id=project_row.id
          and effective_at <= now_at order by version desc limit 1;
      if policy_version is null then raise exception 'REVIEW_POLICY_MISSING'; end if;
      select coalesce(max(r.revision_sequence),0)+1 into revision_sequence from memoid.context_revisions r
        where r.workspace_id=project_row.workspace_id and r.project_id=project_row.id;
      insert into memoid.context_revisions(workspace_id,project_id,revision_sequence,review_policy_version,
        decision_mode,applied_by_account_id,applied_at) values(project_row.workspace_id,project_row.id,
        revision_sequence,policy_version,'MANUAL',session_row.account_id,now_at) returning id into revision_id;
      insert into memoid.context_records(workspace_id,project_id,context_identity_id,context_revision_id,
        assertion_payload,assertion_hash,reviewed_at) values(project_row.workspace_id,project_row.id,
        identity_row.id,revision_id,p_assertion_payload,sha256(convert_to(p_assertion_payload::text,'UTF8')),now_at)
        returning id into new_record_id;
      insert into memoid.context_record_origins(workspace_id,project_id,context_record_id,context_identity_id,
        origin_kind,record_version,supersedes_context_record_id,created_by_actor_id,idempotency_record_id,
        correlation_id,causation_id) values(project_row.workspace_id,project_row.id,new_record_id,identity_row.id,
        p_origin_kind,new_record_version,current_row.context_record_id,actor_row.id,claim_row.idempotency_record_id,
        p_correlation_id,p_causation_id);
      if p_origin_kind='SOURCE_EVIDENCE' then
        insert into memoid.context_record_evidence_provenance(workspace_id,project_id,context_record_id,
          context_identity_id,evidence_reference_id,source_id,source_observation_id,frontier_unit_id,
          covered_observation_sequence,source_authority_assignment_id) values(project_row.workspace_id,
          project_row.id,new_record_id,identity_row.id,evidence_row.id,evidence_row.source_id,
          evidence_row.source_observation_id,evidence_row.frontier_unit_id,evidence_row.observation_sequence,
          p_source_authority_assignment_id);
        insert into memoid.context_record_source_provenance(workspace_id,project_id,context_record_id,
          source_observation_id,relation_kind) values(project_row.workspace_id,project_row.id,new_record_id,
          evidence_row.source_observation_id,'SUPPORTS');
        insert into memoid.context_record_source_coverage(workspace_id,project_id,context_record_id,
          frontier_unit_id,covered_observation_sequence) values(project_row.workspace_id,project_row.id,
          new_record_id,evidence_row.frontier_unit_id,evidence_row.observation_sequence);
      end if;
      if new_record_version=1 then
        insert into memoid.context_identity_current_records(workspace_id,project_id,context_identity_id,
          context_record_id,established_by_revision_id,established_at) values(project_row.workspace_id,
          project_row.id,identity_row.id,new_record_id,revision_id,now_at);
      else
        update memoid.context_identity_current_records set context_record_id=new_record_id,
          established_by_revision_id=revision_id,established_at=now_at where workspace_id=project_row.workspace_id
          and project_id=project_row.id and context_identity_id=identity_row.id;
        update memoid.context_identities set version=new_identity_version where id=identity_row.id;
      end if;
      insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,
        target_type,target_key,correlation_id,causation_id,idempotency_record_id,outcome,metadata)
        values(project_row.workspace_id,project_row.id,actor_row.id,'DATA_INTEGRITY',
          case when new_record_version=1 then 'CONTEXT_RECORD_CREATED' else 'CONTEXT_RECORD_REVISED' end,
          now_at,'CONTEXT_RECORD',new_record_id::text,p_correlation_id,p_causation_id,
          claim_row.idempotency_record_id,'SUCCESS',jsonb_build_object('ORIGIN_KIND',p_origin_kind,
            'IDENTITY_VERSION',new_identity_version,'RECORD_VERSION',new_record_version));
      perform memoid.finish_idempotency(project_row.workspace_id,project_row.id,claim_row.idempotency_record_id,
        claim_row.active_claim_token,'COMPLETED','CONTEXT_RECORD',new_record_id::text,null,
        sha256(convert_to(new_record_id::text,'UTF8')),200,jsonb_build_object('REPLAYABLE',true),null,null);
      return query select identity_row.id,new_record_id,new_identity_version,new_record_version,false;
    end $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.end_context_identity(
      p_session_token_hash bytea, p_project_id uuid, p_context_identity_id uuid,
      p_expected_identity_version bigint, p_expected_current_record_id uuid,
      p_reason_key varchar, p_reason_note varchar, p_idempotency_key_hash bytea,
      p_request_fingerprint bytea, p_correlation_id uuid, p_causation_id uuid default null
    ) returns table (context_identity_id uuid, identity_version bigint, replayed boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare session_row memoid.auth_sessions%rowtype; project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype; identity_row memoid.context_identities%rowtype;
      current_row memoid.context_identity_current_records%rowtype; claim_row record;
      ending_id uuid; new_version bigint; now_at timestamptz := clock_timestamp();
    begin
      if octet_length(p_session_token_hash)<>32 or octet_length(p_idempotency_key_hash)<>32
        or octet_length(p_request_fingerprint)<>32 or p_expected_identity_version<1
        or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
        or p_reason_key not in ('RETIRED','INVALIDATED','NO_LONGER_APPLICABLE')
        or (p_reason_note is not null and (length(p_reason_note) not between 1 and 500
          or btrim(p_reason_note)<>p_reason_note or p_reason_note~'[[:cntrl:]]'))
      then raise exception 'INVALID_CONTEXT_END_REQUEST'; end if;
${authenticatedMutationPrefix}
      select * into claim_row from memoid.claim_idempotency(project_row.workspace_id,project_row.id,
        actor_row.id,'CONTEXT_IDENTITY_END',p_idempotency_key_hash,p_request_fingerprint,
        p_correlation_id,p_causation_id,60,now_at+interval '24 hours');
      if claim_row.claim_outcome='CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome='IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome='TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome='REPLAY' then
        select e.context_identity_id,e.identity_version into context_identity_id,identity_version
          from memoid.context_identity_endings e where e.workspace_id=project_row.workspace_id
          and e.project_id=project_row.id and e.id=claim_row.stable_result_reference::uuid;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select context_identity_id,identity_version,true; return;
      end if;
      select * into identity_row from memoid.context_identities where workspace_id=project_row.workspace_id
        and project_id=project_row.id and id=p_context_identity_id for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if identity_row.lifecycle_state<>'ACTIVE' then raise exception 'CONTEXT_IDENTITY_ENDED'; end if;
      if identity_row.version<>p_expected_identity_version then raise exception 'STALE_CONTEXT_VERSION'; end if;
      select * into current_row from memoid.context_identity_current_records where
        workspace_id=project_row.workspace_id and project_id=project_row.id
        and context_identity_id=identity_row.id for update;
      if not found or current_row.context_record_id is distinct from p_expected_current_record_id
        then raise exception 'STALE_CONTEXT_CURRENT_RECORD'; end if;
      new_version:=identity_row.version+1;
      insert into memoid.context_identity_endings(workspace_id,project_id,context_identity_id,
        ended_current_record_id,identity_version,reason_key,reason_note,ended_by_actor_id,
        idempotency_record_id,correlation_id,causation_id,ended_at) values(project_row.workspace_id,
        project_row.id,identity_row.id,current_row.context_record_id,new_version,p_reason_key,p_reason_note,
        actor_row.id,claim_row.idempotency_record_id,p_correlation_id,p_causation_id,now_at) returning id into ending_id;
      update memoid.context_identities set lifecycle_state='ENDED',version=new_version,ended_at=now_at
        where id=identity_row.id;
      insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,
        target_type,target_key,correlation_id,causation_id,idempotency_record_id,outcome,metadata)
        values(project_row.workspace_id,project_row.id,actor_row.id,'DATA_INTEGRITY','CONTEXT_IDENTITY_ENDED',
        now_at,'CONTEXT_IDENTITY',identity_row.id::text,p_correlation_id,p_causation_id,
        claim_row.idempotency_record_id,'SUCCESS',jsonb_build_object('IDENTITY_VERSION',new_version,
          'REASON_KEY',p_reason_key));
      perform memoid.finish_idempotency(project_row.workspace_id,project_row.id,claim_row.idempotency_record_id,
        claim_row.active_claim_token,'COMPLETED','CONTEXT_ENDING',ending_id::text,null,
        sha256(convert_to(ending_id::text,'UTF8')),200,jsonb_build_object('REPLAYABLE',true),null,null);
      return query select identity_row.id,new_version,false;
    end $$`,
    )
    .execute(db);
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.context_record_origins, memoid.context_record_evidence_provenance,
    memoid.context_identity_endings from public, memoid_app, memoid_auth, memoid_provider`.execute(
    db,
  );
  await sql`grant select on memoid.context_record_origins, memoid.context_record_evidence_provenance,
    memoid.context_identity_endings to memoid_app`.execute(db);
  await sql`revoke all on function memoid.guard_context_history(),
    memoid.guard_context_identity_transition(),
    memoid.put_context_record(bytea,uuid,varchar,varchar,varchar,varchar,bigint,uuid,jsonb,varchar,uuid,uuid,bytea,bytea,uuid,uuid),
    memoid.end_context_identity(bytea,uuid,uuid,bigint,uuid,varchar,varchar,bytea,bytea,uuid,uuid)
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
  await sql`grant execute on function
    memoid.put_context_record(bytea,uuid,varchar,varchar,varchar,varchar,bigint,uuid,jsonb,varchar,uuid,uuid,bytea,bytea,uuid,uuid),
    memoid.end_context_identity(bytea,uuid,uuid,bigint,uuid,varchar,varchar,bytea,bytea,uuid,uuid)
    to memoid_app`.execute(db);
}

export const stage10hContextRecordsProvenanceMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await extendContextFoundation(db);
    await guards(db);
    await rlsAndIndexes(db);
    await functions(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`drop function if exists memoid.end_context_identity(bytea,uuid,uuid,bigint,uuid,varchar,varchar,bytea,bytea,uuid,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.put_context_record(bytea,uuid,varchar,varchar,varchar,varchar,bigint,uuid,jsonb,varchar,uuid,uuid,bytea,bytea,uuid,uuid)`.execute(
      db,
    );
    await sql`drop trigger if exists context_identity_transition on memoid.context_identities`.execute(
      db,
    );
    await sql`drop function if exists memoid.guard_context_identity_transition()`.execute(db);
    await sql`drop table if exists memoid.context_identity_endings`.execute(db);
    await sql`drop table if exists memoid.context_record_evidence_provenance`.execute(db);
    await sql`drop table if exists memoid.context_record_origins`.execute(db);
    await sql`create or replace function memoid.require_context_record_provenance() returns trigger
      language plpgsql as $$
      declare record_workspace_id uuid; record_project_id uuid; record_id uuid;
      begin
        if tg_table_name = 'context_records' then
          record_workspace_id := new.workspace_id; record_project_id := new.project_id; record_id := new.id;
        else
          record_workspace_id := old.workspace_id; record_project_id := old.project_id;
          record_id := old.context_record_id;
        end if;
        perform 1 from memoid.context_records where workspace_id = record_workspace_id
          and project_id = record_project_id and id = record_id for update;
        if not exists (select 1 from memoid.context_record_candidate_provenance
            where workspace_id = record_workspace_id and project_id = record_project_id
              and context_record_id = record_id)
          and not exists (select 1 from memoid.context_record_source_provenance
            where workspace_id = record_workspace_id and project_id = record_project_id
              and context_record_id = record_id)
        then raise exception 'reviewed Context Record requires Candidate or Source provenance'; end if;
        return null;
      end $$`.execute(db);
    await sql`alter table memoid.source_authority_assignments drop constraint if exists
      source_authority_assignments_stage10h_project_id_unique`.execute(db);
    await sql`drop function if exists memoid.guard_context_history()`.execute(db);
    await sql`alter table memoid.context_identities drop constraint if exists context_identities_ending_shape,
      drop constraint if exists context_identities_version_positive,
      drop constraint if exists context_identities_lifecycle,
      drop column if exists ended_at, drop column if exists version, drop column if exists lifecycle_state`.execute(
      db,
    );
    await sql`reset role`.execute(db);
  },
};
