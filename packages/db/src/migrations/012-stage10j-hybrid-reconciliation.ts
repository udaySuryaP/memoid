import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const projectTables = [
  "reconciliation_records",
  "reconciliation_current_states",
  "model_invocation_attempts",
] as const;

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.reconciliation_records (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    candidate_assertion_id uuid not null,
    context_identity_id uuid not null,
    basis_hash bytea not null,
    current_context_record_id uuid,
    current_context_version bigint not null,
    working_context_version bigint not null,
    authority_version bigint not null,
    evidence_frontier_version bigint not null,
    integrity_version bigint not null,
    engine_contract_version varchar(100) not null,
    schema_version varchar(100) not null,
    prompt_version varchar(100) not null,
    compaction_version varchar(100) not null,
    normalization_version varchar(100) not null,
    decision_path varchar(16) not null,
    classification varchar(16) not null,
    semantic_identity varchar(1024) not null,
    normalized_assertion jsonb,
    evidence_reference_ids jsonb not null default '[]'::jsonb,
    conflict_indicated boolean not null,
    uncertainty_indicated boolean not null,
    reason_codes jsonb not null,
    bounded_justification varchar(500),
    working_context_item_id uuid,
    operation_id uuid,
    recorded_by_actor_id uuid not null,
    recorded_at timestamptz not null default clock_timestamp(),
    constraint reconciliation_records_id_v7 check (memoid.is_uuid_v7(id)),
    constraint reconciliation_records_candidate_fk foreign key (workspace_id,project_id,candidate_assertion_id)
      references memoid.candidate_assertions(workspace_id,project_id,id),
    constraint reconciliation_records_identity_fk foreign key (workspace_id,project_id,context_identity_id)
      references memoid.context_identities(workspace_id,project_id,id),
    constraint reconciliation_records_context_fk foreign key (workspace_id,project_id,current_context_record_id)
      references memoid.context_records(workspace_id,project_id,id),
    constraint reconciliation_records_working_fk foreign key (workspace_id,project_id,working_context_item_id)
      references memoid.working_context_items(workspace_id,project_id,id),
    constraint reconciliation_records_operation_fk foreign key (workspace_id,project_id,operation_id)
      references memoid.operations(workspace_id,project_id,id),
    constraint reconciliation_records_actor_fk foreign key (workspace_id,recorded_by_actor_id)
      references memoid.actors(workspace_id,id),
    constraint reconciliation_records_hash check (octet_length(basis_hash)=32),
    constraint reconciliation_records_versions check (current_context_version>=0 and working_context_version>=0 and authority_version>=0 and evidence_frontier_version>=0 and integrity_version>=0),
    constraint reconciliation_records_path check (decision_path in ('DETERMINISTIC','MODEL')),
    constraint reconciliation_records_class check (classification in ('NEW','CHANGED','SUPERSEDED','CONFLICTING','OBSOLETE','UNCERTAIN','UNCHANGED')),
    constraint reconciliation_records_flags check ((classification='CONFLICTING')=conflict_indicated and (classification='UNCERTAIN')=uncertainty_indicated),
    constraint reconciliation_records_assertion check ((classification='UNCHANGED' and normalized_assertion is null and working_context_item_id is null) or (classification<>'UNCHANGED' and jsonb_typeof(normalized_assertion)='object' and octet_length(normalized_assertion::text)<=65536 and working_context_item_id is not null)),
    constraint reconciliation_records_evidence check (jsonb_typeof(evidence_reference_ids)='array'),
    constraint reconciliation_records_reasons check (jsonb_typeof(reason_codes)='array'),
    constraint reconciliation_records_identity_nonempty check (length(semantic_identity) between 1 and 1024),
    constraint reconciliation_records_basis_unique unique (workspace_id,project_id,candidate_assertion_id,basis_hash),
    constraint reconciliation_records_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);

  await sql`create table memoid.reconciliation_current_states (
    workspace_id uuid not null,
    project_id uuid not null,
    candidate_assertion_id uuid not null,
    reconciliation_id uuid not null,
    basis_hash bytea not null,
    updated_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,candidate_assertion_id),
    constraint reconciliation_current_record_fk foreign key (workspace_id,project_id,reconciliation_id)
      references memoid.reconciliation_records(workspace_id,project_id,id),
    constraint reconciliation_current_candidate_fk foreign key (workspace_id,project_id,candidate_assertion_id)
      references memoid.candidate_assertions(workspace_id,project_id,id),
    constraint reconciliation_current_hash check (octet_length(basis_hash)=32)
  )`.execute(db);

  await sql`create table memoid.model_invocation_attempts (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    candidate_assertion_id uuid not null,
    basis_hash bytea not null,
    provider_id varchar(100) not null,
    model_id varchar(200) not null,
    configuration_version varchar(100) not null,
    pricing_version varchar(100),
    attempt_number integer not null,
    input_units bigint not null,
    output_units bigint not null,
    total_units bigint not null,
    estimated_cost_microunits bigint,
    latency_ms integer not null,
    succeeded boolean not null,
    failure_code varchar(40),
    invoked_at timestamptz not null default clock_timestamp(),
    constraint model_invocation_attempts_id_v7 check (memoid.is_uuid_v7(id)),
    constraint model_invocation_attempts_candidate_fk foreign key (workspace_id,project_id,candidate_assertion_id)
      references memoid.candidate_assertions(workspace_id,project_id,id),
    constraint model_invocation_attempts_hash check (octet_length(basis_hash)=32),
    constraint model_invocation_attempts_numbers check (attempt_number>0 and input_units>=0 and output_units>=0 and total_units>=input_units+output_units and latency_ms>=0 and (estimated_cost_microunits is null or estimated_cost_microunits>=0)),
    constraint model_invocation_attempts_outcome check ((succeeded and failure_code is null) or (not succeeded and failure_code in ('TIMEOUT','TRANSPORT','RATE_LIMITED','PROVIDER_UNAVAILABLE','MALFORMED_OUTPUT','SCHEMA_VALIDATION','REFUSAL','SAFETY_REJECTION','CONTEXT_TOO_LARGE','CONFIGURATION_INVALID','BUDGET_EXCEEDED'))),
    constraint model_invocation_attempts_unique unique (workspace_id,project_id,candidate_assertion_id,basis_hash,provider_id,model_id,attempt_number),
    constraint model_invocation_attempts_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);
}

async function guardsAndRls(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.guard_reconciliation_history() returns trigger language plpgsql set search_path=pg_catalog,memoid as $$ begin raise exception 'Reconciliation history is immutable'; end $$`.execute(
    db,
  );
  for (const table of ["reconciliation_records", "model_invocation_attempts"]) {
    await sql
      .raw(
        `create trigger ${table}_immutable before update or delete on memoid.${table} for each row execute function memoid.guard_reconciliation_history()`,
      )
      .execute(db);
  }
  await sql`create function memoid.guard_reconciliation_current() returns trigger language plpgsql set search_path=pg_catalog,memoid as $$ begin
    if tg_op='DELETE' then raise exception 'Reconciliation current state cannot be deleted'; end if;
    if new.workspace_id<>old.workspace_id or new.project_id<>old.project_id or new.candidate_assertion_id<>old.candidate_assertion_id or new.reconciliation_id=old.reconciliation_id then raise exception 'Invalid reconciliation current transition'; end if;
    return new;
  end $$`.execute(db);
  await sql`create trigger reconciliation_current_guard before update or delete on memoid.reconciliation_current_states for each row execute function memoid.guard_reconciliation_current()`.execute(
    db,
  );
  for (const table of projectTables) {
    await sql.raw(`alter table memoid.${table} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${table} force row level security`).execute(db);
    await sql
      .raw(
        `create policy ${table}_tenant on memoid.${table} using (workspace_id=memoid.current_workspace_id() and project_id=memoid.current_project_id()) with check (workspace_id=memoid.current_workspace_id() and project_id=memoid.current_project_id())`,
      )
      .execute(db);
  }
}

async function commitFunction(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.record_model_invocation_attempt(
    p_project_id uuid,p_candidate_assertion_id uuid,p_basis_hash bytea,p_provider_id varchar,
    p_model_id varchar,p_configuration_version varchar,p_pricing_version varchar,p_attempt_number integer,
    p_input_units bigint,p_output_units bigint,p_total_units bigint,p_estimated_cost_microunits bigint,
    p_latency_ms integer,p_succeeded boolean,p_failure_code varchar
  ) returns uuid language plpgsql security definer set search_path=pg_catalog,memoid as $$
  declare project_row memoid.projects%rowtype; actor_row memoid.actors%rowtype; invocation_id uuid:=uuidv7();
  begin
    select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id() and id=p_project_id and p_project_id=memoid.current_project_id();
    if not found or project_row.lifecycle_state<>'ACTIVE' then raise exception 'RESOURCE_NOT_FOUND'; end if;
    select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id and id=memoid.current_actor_id();
    if not found or actor_row.actor_kind not in ('HUMAN','MEMOID_SYSTEM','MEMOID_WORKER') then raise exception 'ACTOR_MISMATCH'; end if;
    perform 1 from memoid.candidate_assertions where workspace_id=project_row.workspace_id and project_id=project_row.id and id=p_candidate_assertion_id;
    if not found then raise exception 'INVALID_CANDIDATE_ASSERTION'; end if;
    insert into memoid.model_invocation_attempts(workspace_id,project_id,id,candidate_assertion_id,basis_hash,provider_id,model_id,configuration_version,pricing_version,attempt_number,input_units,output_units,total_units,estimated_cost_microunits,latency_ms,succeeded,failure_code)
    values(project_row.workspace_id,project_row.id,invocation_id,p_candidate_assertion_id,p_basis_hash,p_provider_id,p_model_id,p_configuration_version,p_pricing_version,p_attempt_number,p_input_units,p_output_units,p_total_units,p_estimated_cost_microunits,p_latency_ms,p_succeeded,p_failure_code)
    on conflict (workspace_id,project_id,candidate_assertion_id,basis_hash,provider_id,model_id,attempt_number) do nothing;
    select id into invocation_id from memoid.model_invocation_attempts where workspace_id=project_row.workspace_id and project_id=project_row.id and candidate_assertion_id=p_candidate_assertion_id and basis_hash=p_basis_hash and provider_id=p_provider_id and model_id=p_model_id and attempt_number=p_attempt_number;
    return invocation_id;
  end $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.commit_reconciliation_result(
    p_project_id uuid,p_candidate_assertion_id uuid,p_context_identity_id uuid,p_basis_hash bytea,
    p_current_context_record_id uuid,p_current_context_version bigint,p_working_context_version bigint,
    p_authority_version bigint,p_evidence_frontier_version bigint,p_integrity_version bigint,
    p_engine_contract_version varchar,p_decision_path varchar,p_classification varchar,p_semantic_identity varchar,
    p_normalized_assertion jsonb,p_evidence_reference_ids jsonb,p_conflict boolean,p_uncertain boolean,
    p_reason_codes jsonb,p_justification varchar,p_operation_id uuid default null
  ) returns table(reconciliation_id uuid,working_context_item_id uuid,replayed boolean)
  language plpgsql security definer set search_path=pg_catalog,memoid as $$
  declare project_row memoid.projects%rowtype; actor_row memoid.actors%rowtype; candidate_row memoid.candidate_assertions%rowtype;
    current_row memoid.context_identity_current_records%rowtype; existing_row memoid.reconciliation_records%rowtype;
    working_id uuid; new_id uuid:=uuidv7(); actual_authority bigint; actual_frontier bigint; actual_integrity bigint; actual_working bigint;
  begin
    if octet_length(p_basis_hash)<>32 or p_decision_path not in ('DETERMINISTIC','MODEL') or p_classification not in ('NEW','CHANGED','SUPERSEDED','CONFLICTING','OBSOLETE','UNCERTAIN','UNCHANGED')
      or ((p_classification='CONFLICTING')<>p_conflict) or ((p_classification='UNCERTAIN')<>p_uncertain)
      or jsonb_typeof(p_evidence_reference_ids)<>'array' or jsonb_typeof(p_reason_codes)<>'array'
      or ((p_classification='UNCHANGED')<>(p_normalized_assertion is null)) then raise exception 'INVALID_RECONCILIATION_RESULT'; end if;
    select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id() and id=p_project_id and p_project_id=memoid.current_project_id() for update;
    if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
    if project_row.lifecycle_state<>'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
    select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id and id=memoid.current_actor_id();
    if not found or actor_row.actor_kind not in ('HUMAN','MEMOID_SYSTEM','MEMOID_WORKER') then raise exception 'ACTOR_MISMATCH'; end if;
    select * into candidate_row from memoid.candidate_assertions where workspace_id=project_row.workspace_id and project_id=project_row.id and id=p_candidate_assertion_id for share;
    if not found then raise exception 'INVALID_CANDIDATE_ASSERTION'; end if;
    perform 1 from memoid.context_identities where workspace_id=project_row.workspace_id and project_id=project_row.id and id=p_context_identity_id and lifecycle_state='ACTIVE' and version=p_current_context_version;
    if not found then raise exception 'STALE_REVIEWED_CONTEXT_BASIS'; end if;
    select * into current_row from memoid.context_identity_current_records where workspace_id=project_row.workspace_id and project_id=project_row.id and context_identity_id=p_context_identity_id;
    if (current_row.context_record_id is distinct from p_current_context_record_id) then raise exception 'STALE_REVIEWED_CONTEXT_BASIS'; end if;
    select coalesce(max(assignment_version),0),coalesce(max(ingested_sequence),0) into actual_authority,actual_frontier from memoid.source_authority_assignments a full join memoid.source_frontier_states f on false where (a.workspace_id is null or (a.workspace_id=project_row.workspace_id and a.project_id=project_row.id)) and (f.workspace_id is null or (f.workspace_id=project_row.workspace_id and f.project_id=project_row.id));
    select greatest(coalesce((select max(occurrence_version) from memoid.conflict_occurrences where workspace_id=project_row.workspace_id and project_id=project_row.id and context_identity_id=p_context_identity_id),0),coalesce((select max(occurrence_version) from memoid.uncertainty_occurrences where workspace_id=project_row.workspace_id and project_id=project_row.id and context_identity_id=p_context_identity_id),0)) into actual_integrity;
    select count(*) into actual_working from memoid.working_context_items where workspace_id=project_row.workspace_id and project_id=project_row.id and context_identity_id=p_context_identity_id;
    if actual_authority<>p_authority_version then raise exception 'STALE_AUTHORITY_BASIS'; end if;
    if actual_frontier<>p_evidence_frontier_version then raise exception 'STALE_FRONTIER_BASIS'; end if;
    if actual_integrity<>p_integrity_version then raise exception 'STALE_INTEGRITY_BASIS'; end if;
    if actual_working<>p_working_context_version then raise exception 'STALE_WORKING_CONTEXT_BASIS'; end if;
    select * into existing_row from memoid.reconciliation_records where workspace_id=project_row.workspace_id and project_id=project_row.id and candidate_assertion_id=p_candidate_assertion_id and basis_hash=p_basis_hash;
    if found then return query select existing_row.id,existing_row.working_context_item_id,true; return; end if;
    if p_classification<>'UNCHANGED' then
      select id into working_id from memoid.working_context_items where workspace_id=project_row.workspace_id and project_id=project_row.id and candidate_assertion_id=p_candidate_assertion_id for update;
      if found then update memoid.working_context_items set context_identity_id=p_context_identity_id,trust_qualification='RECONCILED_UNREVIEWED',assertion_payload=p_normalized_assertion,assertion_hash=sha256(convert_to(p_normalized_assertion::text,'UTF8')),reconciled_at=clock_timestamp() where workspace_id=project_row.workspace_id and project_id=project_row.id and id=working_id;
      else insert into memoid.working_context_items(workspace_id,project_id,context_identity_id,candidate_assertion_id,trust_qualification,assertion_payload,assertion_hash,reconciled_at) values(project_row.workspace_id,project_row.id,p_context_identity_id,p_candidate_assertion_id,'RECONCILED_UNREVIEWED',p_normalized_assertion,sha256(convert_to(p_normalized_assertion::text,'UTF8')),clock_timestamp()) returning id into working_id; end if;
    end if;
    insert into memoid.reconciliation_records(workspace_id,project_id,id,candidate_assertion_id,context_identity_id,basis_hash,current_context_record_id,current_context_version,working_context_version,authority_version,evidence_frontier_version,integrity_version,engine_contract_version,schema_version,prompt_version,compaction_version,normalization_version,decision_path,classification,semantic_identity,normalized_assertion,evidence_reference_ids,conflict_indicated,uncertainty_indicated,reason_codes,bounded_justification,working_context_item_id,operation_id,recorded_by_actor_id)
    values(project_row.workspace_id,project_row.id,new_id,p_candidate_assertion_id,p_context_identity_id,p_basis_hash,p_current_context_record_id,p_current_context_version,p_working_context_version,p_authority_version,p_evidence_frontier_version,p_integrity_version,p_engine_contract_version,'reconciliation-output.v1','reconciliation-prompt.v1','reasoning-packet.v1','semantic-normalization.v1',p_decision_path,p_classification,p_semantic_identity,p_normalized_assertion,p_evidence_reference_ids,p_conflict,p_uncertain,p_reason_codes,p_justification,working_id,p_operation_id,actor_row.id);
    insert into memoid.reconciliation_current_states(workspace_id,project_id,candidate_assertion_id,reconciliation_id,basis_hash) values(project_row.workspace_id,project_row.id,p_candidate_assertion_id,new_id,p_basis_hash) on conflict (workspace_id,project_id,candidate_assertion_id) do update set reconciliation_id=excluded.reconciliation_id,basis_hash=excluded.basis_hash,updated_at=clock_timestamp();
    insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,target_type,target_key,correlation_id,operation_id,outcome,metadata) values(project_row.workspace_id,project_row.id,actor_row.id,'DATA_INTEGRITY','RECONCILIATION_COMPLETED',clock_timestamp(),'RECONCILIATION',new_id::text,uuidv7(),p_operation_id,'SUCCESS',jsonb_build_object('PATH',p_decision_path,'CLASSIFICATION',p_classification));
    return query select new_id,working_id,false;
  end $$`,
    )
    .execute(db);
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.reconciliation_records,memoid.reconciliation_current_states,memoid.model_invocation_attempts from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`grant select on memoid.reconciliation_records,memoid.reconciliation_current_states,memoid.model_invocation_attempts to memoid_app`.execute(
    db,
  );
  await sql`revoke all on function memoid.guard_reconciliation_history(),memoid.guard_reconciliation_current(),memoid.commit_reconciliation_result(uuid,uuid,uuid,bytea,uuid,bigint,bigint,bigint,bigint,bigint,varchar,varchar,varchar,varchar,jsonb,jsonb,boolean,boolean,jsonb,varchar,uuid) from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`revoke all on function memoid.record_model_invocation_attempt(uuid,uuid,bytea,varchar,varchar,varchar,varchar,integer,bigint,bigint,bigint,bigint,integer,boolean,varchar) from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`grant execute on function memoid.commit_reconciliation_result(uuid,uuid,uuid,bytea,uuid,bigint,bigint,bigint,bigint,bigint,varchar,varchar,varchar,varchar,jsonb,jsonb,boolean,boolean,jsonb,varchar,uuid) to memoid_app`.execute(
    db,
  );
  await sql`grant execute on function memoid.record_model_invocation_attempt(uuid,uuid,bytea,varchar,varchar,varchar,varchar,integer,bigint,bigint,bigint,bigint,integer,boolean,varchar) to memoid_app`.execute(
    db,
  );
}

export const stage10jHybridReconciliationMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createTables(db);
    await guardsAndRls(db);
    await commitFunction(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`do $$ begin if exists(select 1 from memoid.reconciliation_records) or exists(select 1 from memoid.model_invocation_attempts) then raise exception 'STAGE10J_ROLLBACK_REFUSED_POPULATED_RECONCILIATION_HISTORY'; end if; end $$`.execute(
      db,
    );
    await sql`drop function if exists memoid.commit_reconciliation_result(uuid,uuid,uuid,bytea,uuid,bigint,bigint,bigint,bigint,bigint,varchar,varchar,varchar,varchar,jsonb,jsonb,boolean,boolean,jsonb,varchar,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.record_model_invocation_attempt(uuid,uuid,bytea,varchar,varchar,varchar,varchar,integer,bigint,bigint,bigint,bigint,integer,boolean,varchar)`.execute(
      db,
    );
    await sql`drop table if exists memoid.model_invocation_attempts`.execute(db);
    await sql`drop table if exists memoid.reconciliation_current_states`.execute(db);
    await sql`drop table if exists memoid.reconciliation_records`.execute(db);
    await sql`drop function if exists memoid.guard_reconciliation_current()`.execute(db);
    await sql`drop function if exists memoid.guard_reconciliation_history()`.execute(db);
    await sql`reset role`.execute(db);
  },
};
