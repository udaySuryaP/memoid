import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const putContextRecordSignature =
  "(bytea,uuid,varchar,varchar,varchar,varchar,bigint,uuid,jsonb,varchar,uuid,uuid,bytea,bytea,uuid,uuid)";

async function authorityResolution(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.qualify_source_authority_assignment(
      p_workspace_id uuid, p_project_id uuid, p_assignment_id uuid,
      p_applicable_ref_key varchar default null
    ) returns varchar language plpgsql stable set search_path = pg_catalog, memoid as $$
    declare assignment_row record; target_ref varchar;
    begin
      select a.source_id, a.source_default_ref_snapshot, s.ref_selector, s.ref_key,
        c.connection_state, c.default_branch into assignment_row
      from memoid.source_authority_assignments a
      join memoid.source_authority_scopes s on s.workspace_id=a.workspace_id
        and s.project_id=a.project_id and s.id=a.authority_scope_id
      left join memoid.github_source_connections c on c.workspace_id=a.workspace_id
        and c.project_id=a.project_id and c.source_id=a.source_id
      where a.workspace_id=p_workspace_id and a.project_id=p_project_id and a.id=p_assignment_id;
      if not found or assignment_row.connection_state is distinct from 'ACTIVE'
        then return 'SOURCE_UNAVAILABLE'; end if;
      if assignment_row.ref_selector='DEFAULT_BRANCH'
        and assignment_row.source_default_ref_snapshot is distinct from
          'refs/heads/' || assignment_row.default_branch
        then return 'REVALIDATION_REQUIRED'; end if;
      target_ref := coalesce(p_applicable_ref_key,
        case assignment_row.ref_selector
          when 'EXACT_REF' then assignment_row.ref_key
          when 'DEFAULT_BRANCH' then 'refs/heads/' || assignment_row.default_branch
          else null end);
      if target_ref is null then
        if not exists (select 1 from memoid.source_observations o
          join memoid.source_frontier_units u on u.workspace_id=o.workspace_id
            and u.project_id=o.project_id and u.id=o.frontier_unit_id
          where o.workspace_id=p_workspace_id and o.project_id=p_project_id
            and u.source_id=assignment_row.source_id)
          then return 'SOURCE_UNOBSERVED'; end if;
        if not exists (select 1 from memoid.source_frontier_units u
          join memoid.source_frontier_states f on f.workspace_id=u.workspace_id
            and f.project_id=u.project_id and f.frontier_unit_id=u.id
          where u.workspace_id=p_workspace_id and u.project_id=p_project_id
            and u.source_id=assignment_row.source_id
            and exists (select 1 from memoid.source_observations o
              where o.workspace_id=u.workspace_id and o.project_id=u.project_id
                and o.frontier_unit_id=u.id)
            and coalesce(f.desired_sequence,0)<=coalesce(f.ingested_sequence,0))
          then return 'SOURCE_BEHIND'; end if;
        return 'EFFECTIVE';
      end if;
      if not exists (select 1 from memoid.source_observations o
        join memoid.source_frontier_units u on u.workspace_id=o.workspace_id
          and u.project_id=o.project_id and u.id=o.frontier_unit_id
        where o.workspace_id=p_workspace_id and o.project_id=p_project_id
          and u.source_id=assignment_row.source_id and u.ref_key=target_ref)
        then return 'SOURCE_UNOBSERVED'; end if;
      if exists (select 1 from memoid.source_frontier_units u
        join memoid.source_frontier_states f on f.workspace_id=u.workspace_id
          and f.project_id=u.project_id and f.frontier_unit_id=u.id
        where u.workspace_id=p_workspace_id and u.project_id=p_project_id
          and u.source_id=assignment_row.source_id and u.ref_key=target_ref
          and coalesce(f.desired_sequence,0)>coalesce(f.ingested_sequence,0))
        then return 'SOURCE_BEHIND'; end if;
      return 'EFFECTIVE';
    end $$`.execute(db);

  await sql`create function memoid.resolve_effective_source_authority(
      p_workspace_id uuid, p_project_id uuid, p_category_facet varchar,
      p_evidence_reference_id uuid
    ) returns table (assignment_id uuid, source_id uuid, qualification varchar)
    language plpgsql stable set search_path = pg_catalog, memoid as $$
    declare winner record; winner_count bigint;
    begin
      with target as (
        select e.repository_path, u.ref_key
        from memoid.evidence_references e
        join memoid.source_frontier_units u on u.workspace_id=e.workspace_id
          and u.project_id=e.project_id and u.id=e.frontier_unit_id
        where e.workspace_id=p_workspace_id and e.project_id=p_project_id
          and e.id=p_evidence_reference_id
      ), candidates as (
        select a.id, a.source_id, target.ref_key,
          case s.ref_selector when 'EXACT_REF' then 2
            when 'DEFAULT_BRANCH' then 1 else 0 end ref_rank,
          case when s.scope_kind='PROJECT' then 0
            else array_length(string_to_array(s.scope_key,'/'),1) end scope_rank
        from target
        join memoid.source_authority_scopes s on s.workspace_id=p_workspace_id
          and s.project_id=p_project_id
        join memoid.source_authority_assignments a on a.workspace_id=s.workspace_id
          and a.project_id=s.project_id and a.authority_scope_id=s.id
          and a.id=s.current_assignment_id
        join memoid.github_source_connections target_connection
          on target_connection.workspace_id=p_workspace_id
          and target_connection.project_id=p_project_id
        where lower(s.authority_category || ':' || s.authority_facet)=lower(p_category_facet)
          and (s.scope_kind='PROJECT' or target.repository_path=s.scope_key
            or target.repository_path like s.scope_key || '/%')
          and (s.ref_selector='ANY_REF'
            or (s.ref_selector='EXACT_REF' and s.ref_key=target.ref_key)
            or (s.ref_selector='DEFAULT_BRANCH'
              and target.ref_key='refs/heads/' || target_connection.default_branch))
      ), ranked as (
        select candidates.*, dense_rank() over (order by ref_rank desc,scope_rank desc) winner_rank
        from candidates
      )
      select ranked.*, count(*) over () into winner
      from ranked where winner_rank=1 limit 1;
      if not found then
        return query select null::uuid, null::uuid, 'MISSING'::varchar; return;
      end if;
      winner_count := winner.count;
      if winner_count <> 1 then
        return query select null::uuid, null::uuid, 'AMBIGUOUS'::varchar; return;
      end if;
      return query select winner.id, winner.source_id,
        memoid.qualify_source_authority_assignment(
          p_workspace_id,p_project_id,winner.id,winner.ref_key
        );
    end $$`.execute(db);
}

async function runtimeDiscovery(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.list_source_ingestion_runtime_targets(
      p_app_id varchar, p_installation_id varchar default null,
      p_repository_id varchar default null, p_ref_key varchar default null
    ) returns table (account_id uuid, workspace_id uuid, project_id uuid, source_id uuid,
      worker_actor_id uuid, ref_key varchar, correlation_id uuid)
    language plpgsql security definer set search_path = pg_catalog, memoid as $$
    declare target record; actor_id uuid;
    begin
      if session_user <> 'memoid_app' then raise exception 'INGESTION_RUNTIME_CALLER_FORBIDDEN'; end if;
      if p_app_id !~ '^[1-9][0-9]{0,39}$'
        or (p_installation_id is not null and p_installation_id !~ '^[1-9][0-9]{0,39}$')
        or (p_repository_id is not null and p_repository_id !~ '^[1-9][0-9]{0,39}$')
        or (p_ref_key is not null and (
          length(p_ref_key) > 1011
          or p_ref_key !~ '^refs/heads/[A-Za-z0-9._/-]+$'
          or position('..' in p_ref_key) > 0
        ))
      then raise exception 'INVALID_INGESTION_RUNTIME_TARGET'; end if;
      for target in
        select distinct w.account_id, c.workspace_id, c.project_id, c.source_id, refs.ref_key
        from memoid.github_source_connections c
        join memoid.workspaces w on w.id=c.workspace_id
        join memoid.projects p on p.workspace_id=c.workspace_id and p.id=c.project_id
        cross join lateral (
          select p_ref_key as ref_key where p_ref_key is not null
          union
          select 'refs/heads/' || c.default_branch where p_ref_key is null
          union
          select u.ref_key from memoid.source_frontier_units u
          where p_ref_key is null and u.workspace_id=c.workspace_id
            and u.project_id=c.project_id and u.source_id=c.source_id
        ) refs
        where c.app_id=p_app_id and c.connection_state='ACTIVE' and p.lifecycle_state='ACTIVE'
          and (p_installation_id is null or c.installation_id=p_installation_id)
          and (p_repository_id is null or c.repository_id=p_repository_id)
      loop
        insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label)
          values(target.workspace_id,'MEMOID_WORKER','worker:source-ingestion','Source ingestion worker')
          on conflict on constraint actors_workspace_identity_unique do nothing;
        select a.id into actor_id from memoid.actors a
          where a.workspace_id=target.workspace_id and a.actor_kind='MEMOID_WORKER'
            and a.actor_reference='worker:source-ingestion';
        return query select target.account_id,target.workspace_id,target.project_id,target.source_id,
          actor_id,target.ref_key,uuidv7();
      end loop;
    end $$`.execute(db);
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

async function contextMutation(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.put_context_record_v2(
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
      policy_version bigint; revision_sequence bigint; claim_row record; authority_resolution record;
      now_at timestamptz := clock_timestamp();
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
        select o.context_identity_id, o.context_record_id, o.identity_version, o.record_version
          into context_identity_id, context_record_id, identity_version, record_version
          from memoid.context_record_origins o
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
        select h.* into current_row from memoid.context_identity_current_records h where
          h.workspace_id=project_row.workspace_id and h.project_id=project_row.id
          and h.context_identity_id=identity_row.id for update;
        if not found or current_row.context_record_id is distinct from p_expected_current_record_id
          then raise exception 'STALE_CONTEXT_CURRENT_RECORD'; end if;
        new_identity_version := identity_row.version + 1;
        select coalesce(max(o.record_version),0)+1 into new_record_version from memoid.context_record_origins o
          where o.workspace_id=project_row.workspace_id and o.project_id=project_row.id
            and o.context_identity_id=identity_row.id;
      end if;
      if p_origin_kind = 'SOURCE_EVIDENCE' then
        select * into evidence_row from memoid.evidence_references where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=p_evidence_reference_id;
        if not found then raise exception 'INVALID_CONTEXT_EVIDENCE'; end if;
        select * into authority_resolution from memoid.resolve_effective_source_authority(
          project_row.workspace_id,project_row.id,p_facet_key,p_evidence_reference_id);
        if authority_resolution.qualification='MISSING' then raise exception 'CONTEXT_AUTHORITY_MISSING'; end if;
        if authority_resolution.qualification='AMBIGUOUS' then raise exception 'CONTEXT_AUTHORITY_AMBIGUOUS'; end if;
        if authority_resolution.qualification<>'EFFECTIVE'
          then raise exception 'CONTEXT_AUTHORITY_UNAVAILABLE'; end if;
        if authority_resolution.assignment_id is distinct from p_source_authority_assignment_id
          or authority_resolution.source_id is distinct from evidence_row.source_id
          then raise exception 'CONTEXT_AUTHORITY_NOT_WINNER'; end if;
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
        origin_kind,identity_version,record_version,supersedes_context_record_id,created_by_actor_id,idempotency_record_id,
        correlation_id,causation_id) values(project_row.workspace_id,project_row.id,new_record_id,identity_row.id,
        p_origin_kind,new_identity_version,new_record_version,current_row.context_record_id,actor_row.id,claim_row.idempotency_record_id,
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
        update memoid.context_identity_current_records as h set context_record_id=new_record_id,
          established_by_revision_id=revision_id,established_at=now_at where h.workspace_id=project_row.workspace_id
          and h.project_id=project_row.id and h.context_identity_id=identity_row.id;
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
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `revoke all on function
    memoid.qualify_source_authority_assignment(uuid,uuid,uuid,varchar),
    memoid.resolve_effective_source_authority(uuid,uuid,varchar,uuid),
    memoid.list_source_ingestion_runtime_targets(varchar,varchar,varchar,varchar),
    memoid.put_context_record_v2${putContextRecordSignature}
    from public, memoid_app, memoid_auth, memoid_provider`,
    )
    .execute(db);
  await sql
    .raw(
      `grant execute on function
    memoid.qualify_source_authority_assignment(uuid,uuid,uuid,varchar),
    memoid.resolve_effective_source_authority(uuid,uuid,varchar,uuid),
    memoid.list_source_ingestion_runtime_targets(varchar,varchar,varchar,varchar),
    memoid.put_context_record_v2${putContextRecordSignature}
    to memoid_app`,
    )
    .execute(db);
}

export const audit1aIntegrityCorrectionsMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await authorityResolution(db);
    await runtimeDiscovery(db);
    await contextMutation(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`do $$
      begin
        if exists (select 1 from memoid.context_record_origins)
          or exists (select 1 from memoid.context_record_evidence_provenance)
          or exists (select 1 from memoid.context_identity_endings)
        then
          raise exception 'STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY';
        end if;
      end $$`.execute(db);
    await sql
      .raw(`drop function if exists memoid.put_context_record_v2${putContextRecordSignature}`)
      .execute(db);
    await sql`drop function if exists memoid.list_source_ingestion_runtime_targets(varchar,varchar,varchar,varchar)`.execute(
      db,
    );
    await sql`drop function if exists memoid.resolve_effective_source_authority(uuid,uuid,varchar,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.qualify_source_authority_assignment(uuid,uuid,uuid,varchar)`.execute(
      db,
    );
    await sql`reset role`.execute(db);
  },
};
