import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`alter table memoid.source_frontier_units add constraint
    source_frontier_units_stage10f_source_id_unique
    unique (workspace_id, project_id, source_id, id)`.execute(db);
  await sql`alter table memoid.source_observations add constraint
    source_observations_stage10f_exact_id_unique
    unique (workspace_id, project_id, frontier_unit_id, observation_sequence, id)`.execute(db);
  await sql`create table memoid.evidence_references (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    source_id uuid not null,
    frontier_unit_id uuid not null,
    source_observation_id uuid not null,
    observation_sequence bigint not null,
    evidence_kind varchar(24) not null,
    repository_revision varchar(64) not null,
    repository_path varchar(1024) not null,
    previous_repository_path varchar(1024),
    provider_object_id varchar(64),
    byte_size bigint,
    content_sha256 bytea,
    structural_locator varchar(512),
    created_at timestamptz not null default clock_timestamp(),
    constraint evidence_references_id_v7 check (memoid.is_uuid_v7(id)),
    constraint evidence_references_unit_fk
      foreign key (workspace_id, project_id, source_id, frontier_unit_id)
      references memoid.source_frontier_units(workspace_id, project_id, source_id, id),
    constraint evidence_references_observation_fk foreign key (
      workspace_id, project_id, frontier_unit_id, observation_sequence, source_observation_id
    ) references memoid.source_observations(
      workspace_id, project_id, frontier_unit_id, observation_sequence, id
    ),
    constraint evidence_references_kind check (evidence_kind in ('FILE','RENAMED_FILE','DELETION')),
    constraint evidence_references_revision check (repository_revision ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
    constraint evidence_references_path check (memoid.is_safe_repository_path(repository_path)),
    constraint evidence_references_previous_path check (
      previous_repository_path is null or memoid.is_safe_repository_path(previous_repository_path)
    ),
    constraint evidence_references_object check (provider_object_id is null or provider_object_id ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
    constraint evidence_references_size check (byte_size is null or byte_size between 0 and 524288),
    constraint evidence_references_hash check (content_sha256 is null or octet_length(content_sha256) = 32),
    constraint evidence_references_locator check (
      structural_locator is null or (length(btrim(structural_locator)) between 1 and 512
        and structural_locator !~ '[[:cntrl:]]')
    ),
    constraint evidence_references_shape check (
      (evidence_kind = 'DELETION' and previous_repository_path is null and provider_object_id is null
        and byte_size is null and content_sha256 is null)
      or (evidence_kind = 'FILE' and previous_repository_path is null and provider_object_id is not null
        and byte_size is not null and content_sha256 is not null)
      or (evidence_kind = 'RENAMED_FILE' and previous_repository_path is not null and provider_object_id is not null
        and byte_size is not null and content_sha256 is not null)
    ),
    constraint evidence_references_project_id_unique unique (workspace_id, project_id, id),
    constraint evidence_references_natural_unique unique nulls not distinct (
      workspace_id, project_id, source_id, frontier_unit_id, source_observation_id,
      evidence_kind, repository_revision, repository_path, previous_repository_path,
      provider_object_id, structural_locator
    )
  )`.execute(db);

  await sql`create table memoid.source_ingestion_dispositions (
    workspace_id uuid not null,
    project_id uuid not null,
    frontier_unit_id uuid not null,
    observation_sequence bigint not null,
    source_observation_id uuid not null,
    disposition varchar(24) not null,
    covered_by_observation_id uuid,
    processed_by_actor_id uuid not null,
    lease_token uuid not null,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, frontier_unit_id, observation_sequence),
    constraint source_ingestion_disposition_observation_fk foreign key (
      workspace_id, project_id, frontier_unit_id, observation_sequence, source_observation_id
    ) references memoid.source_observations(
      workspace_id, project_id, frontier_unit_id, observation_sequence, id
    ),
    constraint source_ingestion_disposition_coverage_fk
      foreign key (workspace_id, project_id, covered_by_observation_id)
      references memoid.source_observations(workspace_id, project_id, id),
    constraint source_ingestion_disposition_actor_fk foreign key (workspace_id, processed_by_actor_id)
      references memoid.actors(workspace_id, id),
    constraint source_ingestion_disposition_value check (disposition in ('INGESTED','COALESCED','REF_DELETED')),
    constraint source_ingestion_disposition_lease check (memoid.is_uuid_v7(lease_token)),
    constraint source_ingestion_disposition_shape check (
      (disposition = 'COALESCED' and covered_by_observation_id is not null)
      or (disposition in ('INGESTED','REF_DELETED') and covered_by_observation_id is null)
    )
  )`.execute(db);
}

async function createHelpersAndGuards(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.is_safe_repository_path(candidate text) returns boolean
    language sql immutable strict parallel safe as $$
      select octet_length(candidate) between 1 and 4096
        and length(candidate) between 1 and 1024
        and candidate = btrim(candidate)
        and left(candidate, 1) <> '/'
        and position(E'\\\\' in candidate) = 0
        and candidate !~ '[[:cntrl:]]'
        and not exists (
          select 1 from unnest(string_to_array(candidate, '/')) segment
          where segment in ('', '.', '..')
        )
    $$`.execute(db);
}

async function createGuards(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.guard_evidence_reference_change() returns trigger
    language plpgsql as $$
    begin
      if tg_op = 'UPDATE' then raise exception 'Evidence Reference is immutable'; end if;
      if exists (
        select 1 from memoid.source_ingestion_dispositions d
        where d.workspace_id = old.workspace_id and d.project_id = old.project_id
          and d.frontier_unit_id = old.frontier_unit_id
          and d.observation_sequence = old.observation_sequence
      ) then raise exception 'completed Evidence Reference cannot be deleted'; end if;
      return old;
    end $$`.execute(db);
  await sql`create trigger evidence_reference_immutable_guard
    before update or delete on memoid.evidence_references
    for each row execute function memoid.guard_evidence_reference_change()`.execute(db);

  await sql`create function memoid.guard_ingestion_disposition() returns trigger
    language plpgsql as $$
    begin
      if tg_op <> 'INSERT' then raise exception 'ingestion disposition is immutable'; end if;
      if new.disposition = 'COALESCED' and not exists (
        select 1 from memoid.source_observations o
        where o.workspace_id = new.workspace_id and o.project_id = new.project_id
          and o.frontier_unit_id = new.frontier_unit_id and o.id = new.covered_by_observation_id
          and o.observation_sequence > new.observation_sequence
      ) then raise exception 'invalid ingestion coalescing coverage'; end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger source_ingestion_disposition_immutable_guard
    before insert or update or delete on memoid.source_ingestion_dispositions
    for each row execute function memoid.guard_ingestion_disposition()`.execute(db);

  await sql`create function memoid.assert_ingestion_actor(
      p_workspace_id uuid, p_project_id uuid, p_actor_id uuid, p_worker_only boolean
    ) returns void language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare actor_kind_value varchar;
    begin
      if memoid.current_account_id() is null
        or memoid.current_workspace_id() is distinct from p_workspace_id
        or memoid.current_project_id() is distinct from p_project_id
        or memoid.current_actor_id() is distinct from p_actor_id
        or not exists (select 1 from memoid.workspaces w
          where w.id = p_workspace_id and w.account_id = memoid.current_account_id())
        or not exists (select 1 from memoid.projects p
          where p.workspace_id = p_workspace_id and p.id = p_project_id and p.lifecycle_state = 'ACTIVE')
      then raise exception 'SOURCE_INGESTION_DENIED'; end if;
      select a.actor_kind into actor_kind_value from memoid.actors a
        where a.workspace_id = p_workspace_id and a.id = p_actor_id;
      if (p_worker_only and actor_kind_value is distinct from 'MEMOID_WORKER')
        or (not p_worker_only and actor_kind_value not in ('MEMOID_WORKER','MEMOID_SYSTEM'))
      then raise exception 'SOURCE_INGESTION_ACTOR_INVALID'; end if;
    end $$`.execute(db);
}

async function createSchedulingFunction(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.schedule_source_observation(
      p_workspace_id uuid, p_project_id uuid, p_source_id uuid, p_actor_id uuid,
      p_scope_key varchar, p_ref_key varchar, p_external_revision varchar,
      p_is_default_ref boolean, p_observed_at timestamptz,
      p_correlation_id uuid, p_causation_id uuid
    ) returns table (
      frontier_unit_id uuid, observation_id uuid, observation_sequence bigint,
      processing_unit_id uuid, created boolean
    ) language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      unit_id uuid;
      process_id uuid;
      next_sequence bigint;
      current_sequence bigint;
      current_ingested bigint;
      current_observation memoid.source_observations%rowtype;
      new_observation_id uuid;
      revision_value varchar := coalesce(p_external_revision, 'REF_DELETED');
      now_at timestamptz := clock_timestamp();
    begin
      perform memoid.assert_ingestion_actor(p_workspace_id, p_project_id, p_actor_id, false);
      if p_scope_key <> 'repository' or length(p_ref_key) not between 12 and 512
        or left(p_ref_key, 11) <> 'refs/heads/' or position(E'\\\\' in p_ref_key) > 0
        or p_ref_key ~ '[[:cntrl:]]'
        or p_ref_key like '%..%' or right(p_ref_key, 1) = '/'
      then raise exception 'SOURCE_REF_INVALID'; end if;
      if p_external_revision is not null and p_external_revision !~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
      then raise exception 'SOURCE_REVISION_INVALID'; end if;
      if not memoid.is_uuid_v7(p_correlation_id) or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
      then raise exception 'SOURCE_CORRELATION_INVALID'; end if;
      perform 1 from memoid.sources s join memoid.github_source_connections g
        on g.workspace_id = s.workspace_id and g.project_id = s.project_id and g.source_id = s.id
        where s.workspace_id = p_workspace_id and s.project_id = p_project_id and s.id = p_source_id
          and g.connection_state = 'ACTIVE' for update of s, g;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;

      insert into memoid.source_frontier_units (workspace_id, project_id, source_id, scope_key, ref_key)
        values (p_workspace_id, p_project_id, p_source_id, p_scope_key, p_ref_key)
        on conflict (workspace_id, project_id, source_id, scope_key, ref_key) do nothing;
      select id into unit_id from memoid.source_frontier_units
        where workspace_id = p_workspace_id and project_id = p_project_id and source_id = p_source_id
          and scope_key = p_scope_key and ref_key = p_ref_key for update;
      insert into memoid.source_frontier_states (workspace_id, project_id, frontier_unit_id)
        values (p_workspace_id, p_project_id, unit_id) on conflict do nothing;
      select observed_sequence, coalesce(ingested_sequence, 0) into current_sequence, current_ingested from memoid.source_frontier_states
        where workspace_id = p_workspace_id and project_id = p_project_id and frontier_unit_id = unit_id
        for update;
      if current_sequence is not null then
        select * into current_observation from memoid.source_observations
          where workspace_id = p_workspace_id and project_id = p_project_id
            and frontier_unit_id = unit_id and observation_sequence = current_sequence;
        if current_observation.external_revision = revision_value
          and (current_observation.metadata ->> 'REF_DELETED')::boolean = (p_external_revision is null)
          and (current_observation.metadata ->> 'IS_DEFAULT_REF')::boolean = p_is_default_ref
        then
          select id into process_id from memoid.processing_units
            where workspace_id = p_workspace_id and project_id = p_project_id
              and unit_kind = 'SOURCE_INGESTION'
              and unit_key = 'source:' || p_source_id::text || '/frontier:' || unit_id::text;
          return query select unit_id, current_observation.id, current_sequence, process_id, false;
          return;
        end if;
      end if;
      next_sequence := coalesce(current_sequence, 0) + 1;
      insert into memoid.source_observations (
        workspace_id, project_id, frontier_unit_id, observation_sequence,
        external_revision, observed_at, effective_at, metadata
      ) values (
        p_workspace_id, p_project_id, unit_id, next_sequence, revision_value,
        p_observed_at, p_observed_at,
        jsonb_build_object('REF_DELETED', p_external_revision is null, 'IS_DEFAULT_REF', p_is_default_ref)
      ) returning id into new_observation_id;
      update memoid.source_frontier_states set observed_sequence = next_sequence,
        desired_sequence = next_sequence, recorded_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id and frontier_unit_id = unit_id;
      insert into memoid.processing_units (
        workspace_id, project_id, unit_kind, unit_key, desired_sequence,
        processed_sequence, follow_up_required, correlation_id, causation_id
      ) values (
        p_workspace_id, p_project_id, 'SOURCE_INGESTION',
        'source:' || p_source_id::text || '/frontier:' || unit_id::text,
        next_sequence, current_ingested, true, p_correlation_id, p_causation_id
      ) on conflict (workspace_id, project_id, unit_kind, unit_key) do update
        set desired_sequence = excluded.desired_sequence, follow_up_required = true,
          correlation_id = excluded.correlation_id, causation_id = excluded.causation_id,
          state_changed_at = now_at
        returning id into process_id;
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at,
        target_type, target_key, correlation_id, causation_id, outcome, metadata
      ) values (
        p_workspace_id, p_project_id, p_actor_id, 'DATA_INTEGRITY',
        'SOURCE_OBSERVATION_RECORDED', now_at, 'SOURCE', p_source_id::text,
        p_correlation_id, p_causation_id, 'SUCCESS',
        jsonb_build_object('OBSERVATION_SEQUENCE', next_sequence,
          'REF_DELETED', p_external_revision is null, 'IS_DEFAULT_REF', p_is_default_ref)
      );
      return query select unit_id, new_observation_id, next_sequence, process_id, true;
    end $$`.execute(db);
}

async function createWorkerFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.acquire_source_ingestion(
      p_workspace_id uuid, p_project_id uuid, p_source_id uuid, p_ref_key varchar,
      p_worker_actor_id uuid, p_lease_seconds integer
    ) returns table (
      frontier_unit_id uuid, observation_id uuid, observation_sequence bigint,
      external_revision varchar, base_revision varchar, processing_unit_id uuid,
      lease_token uuid, app_id varchar, installation_id varchar, repository_id varchar, account_id varchar,
      owner_login varchar, repository_name varchar
    ) language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      unit_id uuid;
      process_id uuid;
      acquired record;
      target_observation memoid.source_observations%rowtype;
      base_external varchar;
      connection memoid.github_source_connections%rowtype;
    begin
      perform memoid.assert_ingestion_actor(p_workspace_id, p_project_id, p_worker_actor_id, true);
      select u.id into unit_id from memoid.source_frontier_units u
        where u.workspace_id = p_workspace_id and u.project_id = p_project_id
          and u.source_id = p_source_id and u.scope_key = 'repository' and u.ref_key = p_ref_key;
      if unit_id is null then return; end if;
      select p.id into process_id from memoid.processing_units p
        where p.workspace_id = p_workspace_id and p.project_id = p_project_id
          and p.unit_kind = 'SOURCE_INGESTION'
          and p.unit_key = 'source:' || p_source_id::text || '/frontier:' || unit_id::text;
      if process_id is null then return; end if;
      select * into acquired from memoid.acquire_processing_unit(
        p_workspace_id, p_project_id, process_id, p_worker_actor_id, p_lease_seconds
      );
      if not acquired.was_acquired then return; end if;
      select * into target_observation from memoid.source_observations o
        where o.workspace_id = p_workspace_id and o.project_id = p_project_id
          and o.frontier_unit_id = unit_id and o.observation_sequence = acquired.target_sequence;
      select o.external_revision into base_external
        from memoid.source_frontier_states f join memoid.source_observations o
          on o.workspace_id = f.workspace_id and o.project_id = f.project_id
          and o.frontier_unit_id = f.frontier_unit_id and o.observation_sequence = f.ingested_sequence
        where f.workspace_id = p_workspace_id and f.project_id = p_project_id and f.frontier_unit_id = unit_id;
      select * into connection from memoid.github_source_connections g
        where g.workspace_id = p_workspace_id and g.project_id = p_project_id
          and g.source_id = p_source_id and g.connection_state = 'ACTIVE' for update;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      return query select unit_id, target_observation.id, target_observation.observation_sequence,
        case when target_observation.external_revision = 'REF_DELETED' then null else target_observation.external_revision end,
        case when base_external = 'REF_DELETED' then null else base_external end,
        process_id, acquired.acquired_lease_token, connection.app_id, connection.installation_id,
        connection.repository_id, connection.account_id, connection.owner_login, connection.repository_name;
    end $$`.execute(db);

  await sql`create function memoid.record_evidence_reference(
      p_workspace_id uuid, p_project_id uuid, p_source_id uuid, p_frontier_unit_id uuid,
      p_observation_id uuid, p_worker_actor_id uuid, p_lease_token uuid,
      p_evidence_kind varchar, p_repository_revision varchar, p_repository_path varchar,
      p_previous_repository_path varchar, p_provider_object_id varchar, p_byte_size bigint,
      p_content_sha256 bytea, p_structural_locator varchar
    ) returns uuid language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      reference_id uuid; target_sequence bigint; process_id uuid; reference_count bigint;
      existing_byte_size bigint; existing_content_sha256 bytea;
    begin
      perform memoid.assert_ingestion_actor(p_workspace_id, p_project_id, p_worker_actor_id, true);
      perform 1 from memoid.github_source_connections g where g.workspace_id = p_workspace_id
        and g.project_id = p_project_id and g.source_id = p_source_id
        and g.connection_state = 'ACTIVE' for update;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      select o.observation_sequence into target_sequence from memoid.source_observations o
        where o.workspace_id = p_workspace_id and o.project_id = p_project_id
          and o.frontier_unit_id = p_frontier_unit_id and o.id = p_observation_id
          and o.external_revision = p_repository_revision;
      if target_sequence is null then raise exception 'EVIDENCE_OBSERVATION_INVALID'; end if;
      select p.id into process_id from memoid.processing_units p
        where p.workspace_id = p_workspace_id and p.project_id = p_project_id
          and p.unit_kind = 'SOURCE_INGESTION'
          and p.unit_key = 'source:' || p_source_id::text || '/frontier:' || p_frontier_unit_id::text
          and p.lease_token = p_lease_token and p.lease_owner_actor_id = p_worker_actor_id
          and p.lease_target_sequence = target_sequence and p.lease_expires_at > clock_timestamp()
        for update;
      if process_id is null then raise exception 'STALE_SOURCE_INGESTION_LEASE'; end if;
      select e.id, e.byte_size, e.content_sha256
        into reference_id, existing_byte_size, existing_content_sha256
        from memoid.evidence_references e
        where e.workspace_id = p_workspace_id and e.project_id = p_project_id
          and e.source_id = p_source_id and e.frontier_unit_id = p_frontier_unit_id
          and e.source_observation_id = p_observation_id and e.evidence_kind = p_evidence_kind
          and e.repository_revision = p_repository_revision and e.repository_path = p_repository_path
          and e.previous_repository_path is not distinct from p_previous_repository_path
          and e.provider_object_id is not distinct from p_provider_object_id
          and e.structural_locator is not distinct from p_structural_locator;
      if reference_id is not null then
        if existing_byte_size is distinct from p_byte_size
          or existing_content_sha256 is distinct from p_content_sha256
        then raise exception 'EVIDENCE_REFERENCE_CONFLICT'; end if;
        return reference_id;
      end if;
      select count(*) into reference_count from memoid.evidence_references e
        where e.workspace_id = p_workspace_id and e.project_id = p_project_id
          and e.source_observation_id = p_observation_id;
      if reference_count >= 2000 then raise exception 'EVIDENCE_REFERENCE_LIMIT_EXCEEDED'; end if;
      insert into memoid.evidence_references (
        workspace_id, project_id, source_id, frontier_unit_id, source_observation_id,
        observation_sequence, evidence_kind, repository_revision, repository_path,
        previous_repository_path, provider_object_id, byte_size, content_sha256, structural_locator
      ) values (
        p_workspace_id, p_project_id, p_source_id, p_frontier_unit_id, p_observation_id,
        target_sequence, p_evidence_kind, p_repository_revision, p_repository_path,
        p_previous_repository_path, p_provider_object_id, p_byte_size, p_content_sha256,
        p_structural_locator
      ) on conflict on constraint evidence_references_natural_unique do nothing
        returning id into reference_id;
      if reference_id is null then
        select e.id, e.byte_size, e.content_sha256
          into reference_id, existing_byte_size, existing_content_sha256
          from memoid.evidence_references e
          where e.workspace_id = p_workspace_id and e.project_id = p_project_id
            and e.source_id = p_source_id and e.frontier_unit_id = p_frontier_unit_id
            and e.source_observation_id = p_observation_id and e.evidence_kind = p_evidence_kind
            and e.repository_revision = p_repository_revision and e.repository_path = p_repository_path
            and e.previous_repository_path is not distinct from p_previous_repository_path
            and e.provider_object_id is not distinct from p_provider_object_id
            and e.structural_locator is not distinct from p_structural_locator;
        if existing_byte_size is distinct from p_byte_size
          or existing_content_sha256 is distinct from p_content_sha256
        then raise exception 'EVIDENCE_REFERENCE_CONFLICT'; end if;
      end if;
      return reference_id;
    end $$`.execute(db);

  await sql`create function memoid.complete_source_ingestion(
      p_workspace_id uuid, p_project_id uuid, p_source_id uuid, p_frontier_unit_id uuid,
      p_observation_id uuid, p_worker_actor_id uuid, p_lease_token uuid,
      p_mode varchar, p_candidate_count integer, p_fetched_bytes bigint, p_classifications jsonb
    ) returns table (ingested_through bigint, current_desired bigint, follow_up_required boolean)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare
      process_id uuid; target_sequence bigint; prior_ingested bigint; deleted_ref boolean;
      completion record; observation_count bigint; disposition_count bigint; now_at timestamptz := clock_timestamp();
    begin
      perform memoid.assert_ingestion_actor(p_workspace_id, p_project_id, p_worker_actor_id, true);
      perform 1 from memoid.github_source_connections g where g.workspace_id = p_workspace_id
        and g.project_id = p_project_id and g.source_id = p_source_id
        and g.connection_state = 'ACTIVE' for update;
      if not found then raise exception 'SOURCE_UNAVAILABLE'; end if;
      if p_mode not in ('INITIAL_TREE','INCREMENTAL_COMPARE','BOUNDED_TREE_FALLBACK','REF_DELETED')
        or p_candidate_count < 0 or p_candidate_count > 10000
        or p_fetched_bytes < 0 or p_fetched_bytes > 33554432
        or not memoid.is_sanitized_metadata(p_classifications)
      then raise exception 'SOURCE_INGESTION_SUMMARY_INVALID'; end if;
      select o.observation_sequence, o.external_revision = 'REF_DELETED'
        into target_sequence, deleted_ref from memoid.source_observations o
        where o.workspace_id = p_workspace_id and o.project_id = p_project_id
          and o.frontier_unit_id = p_frontier_unit_id and o.id = p_observation_id;
      select p.id into process_id from memoid.processing_units p
        where p.workspace_id = p_workspace_id and p.project_id = p_project_id
          and p.unit_kind = 'SOURCE_INGESTION'
          and p.unit_key = 'source:' || p_source_id::text || '/frontier:' || p_frontier_unit_id::text
          and p.lease_token = p_lease_token and p.lease_owner_actor_id = p_worker_actor_id
          and p.lease_target_sequence = target_sequence and p.lease_expires_at > now_at for update;
      if process_id is null then raise exception 'STALE_SOURCE_INGESTION_LEASE'; end if;
      select coalesce(f.ingested_sequence, 0) into prior_ingested from memoid.source_frontier_states f
        where f.workspace_id = p_workspace_id and f.project_id = p_project_id
          and f.frontier_unit_id = p_frontier_unit_id for update;
      if deleted_ref and p_mode <> 'REF_DELETED' then raise exception 'REF_DELETION_MODE_REQUIRED'; end if;
      if not deleted_ref and p_mode = 'REF_DELETED' then raise exception 'REF_DELETION_MODE_INVALID'; end if;
      delete from memoid.evidence_references e
        where e.workspace_id = p_workspace_id and e.project_id = p_project_id
          and e.frontier_unit_id = p_frontier_unit_id
          and e.observation_sequence > prior_ingested and e.observation_sequence < target_sequence;
      insert into memoid.source_ingestion_dispositions (
        workspace_id, project_id, frontier_unit_id, observation_sequence,
        source_observation_id, disposition, covered_by_observation_id,
        processed_by_actor_id, lease_token
      ) select p_workspace_id, p_project_id, p_frontier_unit_id, o.observation_sequence,
          o.id, 'COALESCED', p_observation_id, p_worker_actor_id, p_lease_token
        from memoid.source_observations o
        where o.workspace_id = p_workspace_id and o.project_id = p_project_id
          and o.frontier_unit_id = p_frontier_unit_id
          and o.observation_sequence > prior_ingested and o.observation_sequence < target_sequence
        on conflict do nothing;
      insert into memoid.source_ingestion_dispositions (
        workspace_id, project_id, frontier_unit_id, observation_sequence,
        source_observation_id, disposition, covered_by_observation_id,
        processed_by_actor_id, lease_token
      ) values (
        p_workspace_id, p_project_id, p_frontier_unit_id, target_sequence,
        p_observation_id, case when deleted_ref then 'REF_DELETED' else 'INGESTED' end,
        null, p_worker_actor_id, p_lease_token
      ) on conflict do nothing;
      select count(*) into observation_count from memoid.source_observations o
        where o.workspace_id = p_workspace_id and o.project_id = p_project_id
          and o.frontier_unit_id = p_frontier_unit_id
          and o.observation_sequence > prior_ingested and o.observation_sequence <= target_sequence;
      select count(*) into disposition_count from memoid.source_ingestion_dispositions d
        where d.workspace_id = p_workspace_id and d.project_id = p_project_id
          and d.frontier_unit_id = p_frontier_unit_id
          and d.observation_sequence > prior_ingested and d.observation_sequence <= target_sequence;
      if observation_count <> target_sequence - prior_ingested or disposition_count <> observation_count
      then raise exception 'SOURCE_INGESTION_FRONTIER_GAP'; end if;
      update memoid.source_frontier_states set ingested_sequence = target_sequence, recorded_at = now_at
        where workspace_id = p_workspace_id and project_id = p_project_id
          and frontier_unit_id = p_frontier_unit_id;
      select * into completion from memoid.complete_processing_unit(
        p_workspace_id, p_project_id, process_id, p_lease_token, target_sequence
      );
      insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at,
        target_type, target_key, correlation_id, causation_id, outcome, metadata
      ) select p_workspace_id, p_project_id, p_worker_actor_id, 'DATA_INTEGRITY',
        'SOURCE_INGESTION_COMPLETED', now_at, 'SOURCE', p_source_id::text,
        p.correlation_id, p.causation_id, 'SUCCESS',
        jsonb_build_object('OBSERVATION_SEQUENCE', target_sequence, 'MODE', p_mode,
          'CANDIDATE_COUNT', p_candidate_count, 'FETCHED_BYTES', p_fetched_bytes,
          'EVIDENCE_REFERENCE_COUNT', (select count(*) from memoid.evidence_references e
            where e.workspace_id = p_workspace_id and e.project_id = p_project_id
              and e.source_observation_id = p_observation_id),
          'FOLLOW_UP_REQUIRED', completion.follow_up_still_required)
        from memoid.processing_units p where p.id = process_id;
      return query select target_sequence, completion.current_desired, completion.follow_up_still_required;
    end $$`.execute(db);

  await sql`create function memoid.retry_source_ingestion(
      p_workspace_id uuid, p_project_id uuid, p_source_id uuid, p_frontier_unit_id uuid,
      p_worker_actor_id uuid, p_lease_token uuid, p_next_attempt_at timestamptz,
      p_failure_code varchar, p_failure_metadata jsonb
    ) returns boolean language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare process_id uuid;
    begin
      perform memoid.assert_ingestion_actor(p_workspace_id, p_project_id, p_worker_actor_id, true);
      select p.id into process_id from memoid.processing_units p
        where p.workspace_id = p_workspace_id and p.project_id = p_project_id
          and p.unit_kind = 'SOURCE_INGESTION'
          and p.unit_key = 'source:' || p_source_id::text || '/frontier:' || p_frontier_unit_id::text;
      if process_id is null then raise exception 'SOURCE_INGESTION_UNIT_NOT_FOUND'; end if;
      return memoid.retry_processing_unit(p_workspace_id, p_project_id, process_id,
        p_lease_token, p_next_attempt_at, p_failure_code, p_failure_metadata);
    end $$`.execute(db);
}

async function createSecurityBoundary(db: Kysely<unknown>): Promise<void> {
  for (const tableName of ["evidence_references", "source_ingestion_dispositions"]) {
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
  await sql`create index evidence_references_observation_idx
    on memoid.evidence_references (workspace_id, project_id, source_observation_id, repository_path)`.execute(
    db,
  );
  await sql`create index evidence_references_content_idx
    on memoid.evidence_references (workspace_id, project_id, content_sha256)
    where content_sha256 is not null`.execute(db);
  await sql`create index source_ingestion_dispositions_observation_idx
    on memoid.source_ingestion_dispositions (workspace_id, project_id, source_observation_id)`.execute(
    db,
  );
  await sql`revoke all on memoid.evidence_references, memoid.source_ingestion_dispositions
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
  await sql`grant select on memoid.evidence_references, memoid.source_ingestion_dispositions to memoid_app`.execute(
    db,
  );
  await sql`revoke all on function
      memoid.schedule_source_observation(uuid,uuid,uuid,uuid,varchar,varchar,varchar,boolean,timestamptz,uuid,uuid),
      memoid.acquire_source_ingestion(uuid,uuid,uuid,varchar,uuid,integer),
      memoid.record_evidence_reference(uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,bytea,varchar),
      memoid.complete_source_ingestion(uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,integer,bigint,jsonb),
      memoid.retry_source_ingestion(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,varchar,jsonb),
      memoid.assert_ingestion_actor(uuid,uuid,uuid,boolean)
    from public, memoid_app, memoid_auth, memoid_provider`.execute(db);
  await sql`grant execute on function
      memoid.schedule_source_observation(uuid,uuid,uuid,uuid,varchar,varchar,varchar,boolean,timestamptz,uuid,uuid),
      memoid.acquire_source_ingestion(uuid,uuid,uuid,varchar,uuid,integer),
      memoid.record_evidence_reference(uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,bytea,varchar),
      memoid.complete_source_ingestion(uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,integer,bigint,jsonb),
      memoid.retry_source_ingestion(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,varchar,jsonb)
    to memoid_app`.execute(db);
  await sql`comment on table memoid.evidence_references is
    'Bounded immutable revision-qualified repository evidence identity; contains no repository contents'`.execute(
    db,
  );
  await sql`comment on table memoid.source_ingestion_dispositions is
    'Explicit immutable gap-preserving Source observation ingestion outcomes'`.execute(db);
}

export const stage10fIngestionEvidenceMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createHelpersAndGuards(db);
    await createTables(db);
    await createGuards(db);
    await createSchedulingFunction(db);
    await createWorkerFunctions(db);
    await createSecurityBoundary(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`drop function if exists
      memoid.retry_source_ingestion(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,varchar,jsonb),
      memoid.complete_source_ingestion(uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,integer,bigint,jsonb),
      memoid.record_evidence_reference(uuid,uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar,varchar,varchar,varchar,bigint,bytea,varchar),
      memoid.acquire_source_ingestion(uuid,uuid,uuid,varchar,uuid,integer),
      memoid.schedule_source_observation(uuid,uuid,uuid,uuid,varchar,varchar,varchar,boolean,timestamptz,uuid,uuid),
      memoid.assert_ingestion_actor(uuid,uuid,uuid,boolean)`.execute(db);
    await sql`drop table if exists memoid.source_ingestion_dispositions`.execute(db);
    await sql`drop table if exists memoid.evidence_references`.execute(db);
    await sql`alter table memoid.source_observations drop constraint if exists
      source_observations_stage10f_exact_id_unique`.execute(db);
    await sql`alter table memoid.source_frontier_units drop constraint if exists
      source_frontier_units_stage10f_source_id_unique`.execute(db);
    await sql`drop function if exists memoid.guard_ingestion_disposition(),
      memoid.guard_evidence_reference_change(), memoid.is_safe_repository_path(text)`.execute(db);
    await sql`reset role`.execute(db);
  },
};
