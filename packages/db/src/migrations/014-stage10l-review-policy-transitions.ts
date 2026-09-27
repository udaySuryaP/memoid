import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const tables = ["review_policy_evaluations", "review_policy_current_states"] as const;

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.review_policy_evaluations (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    proposal_item_id uuid not null,
    project_policy_version bigint not null,
    project_policy varchar(16) not null,
    decision varchar(32) not null,
    reason_codes jsonb not null,
    protected_checks jsonb not null,
    policy_engine_version varchar(64) not null,
    evaluated_basis_hash bytea not null,
    supersedes_evaluation_id uuid,
    operation_id uuid not null,
    evaluated_by_actor_id uuid not null,
    evaluated_at timestamptz not null default clock_timestamp(),
    constraint review_policy_evaluations_id_v7 check (memoid.is_uuid_v7(id)),
    constraint review_policy_evaluations_item_fk foreign key (workspace_id,project_id,proposal_item_id) references memoid.change_proposal_items(workspace_id,project_id,id),
    constraint review_policy_evaluations_policy_fk foreign key (workspace_id,project_id,project_policy_version) references memoid.project_review_policy_versions(workspace_id,project_id,version),
    constraint review_policy_evaluations_supersedes_fk foreign key (workspace_id,project_id,supersedes_evaluation_id) references memoid.review_policy_evaluations(workspace_id,project_id,id),
    constraint review_policy_evaluations_operation_fk foreign key (workspace_id,project_id,operation_id) references memoid.operations(workspace_id,project_id,id),
    constraint review_policy_evaluations_actor_fk foreign key (workspace_id,evaluated_by_actor_id) references memoid.actors(workspace_id,id),
    constraint review_policy_evaluations_policy check (project_policy in ('MANUAL','AUTOMATIC')),
    constraint review_policy_evaluations_decision check (decision in ('MANUAL_REQUIRED','AUTOMATIC_ELIGIBLE')),
    constraint review_policy_evaluations_reasons check (jsonb_typeof(reason_codes)='array' and jsonb_array_length(reason_codes)>0),
    constraint review_policy_evaluations_checks check (jsonb_typeof(protected_checks)='object'),
    constraint review_policy_evaluations_hash check (octet_length(evaluated_basis_hash)=32),
    constraint review_policy_evaluations_project_id_unique unique (workspace_id,project_id,id),
    constraint review_policy_evaluations_replay unique (workspace_id,project_id,proposal_item_id,project_policy_version,policy_engine_version,evaluated_basis_hash)
  )`.execute(db);
  await sql`create table memoid.review_policy_current_states (
    workspace_id uuid not null,
    project_id uuid not null,
    proposal_item_id uuid not null,
    evaluation_id uuid not null,
    version bigint not null default 1,
    updated_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,proposal_item_id),
    constraint review_policy_current_item_fk foreign key (workspace_id,project_id,proposal_item_id) references memoid.change_proposal_items(workspace_id,project_id,id),
    constraint review_policy_current_evaluation_fk foreign key (workspace_id,project_id,evaluation_id) references memoid.review_policy_evaluations(workspace_id,project_id,id),
    constraint review_policy_current_version check (version>0)
  )`.execute(db);
  await sql`create index review_policy_history_idx on memoid.review_policy_evaluations(workspace_id,project_id,proposal_item_id,evaluated_at desc,id desc)`.execute(
    db,
  );
  await sql`create index review_policy_decision_idx on memoid.review_policy_evaluations(workspace_id,project_id,decision,evaluated_at desc)`.execute(
    db,
  );
}

async function guardsAndRls(db: Kysely<unknown>): Promise<void> {
  await sql`create trigger review_policy_evaluations_immutable before update or delete on memoid.review_policy_evaluations for each row execute function memoid.reject_immutable_row_change()`.execute(
    db,
  );
  await sql`create function memoid.guard_review_policy_current() returns trigger language plpgsql set search_path=pg_catalog,memoid as $$ begin
    if tg_op='DELETE' then raise exception 'Review policy current state cannot be deleted'; end if;
    if new.workspace_id<>old.workspace_id or new.project_id<>old.project_id or new.proposal_item_id<>old.proposal_item_id or new.version<>old.version+1 then raise exception 'Invalid review policy current transition'; end if;
    if not exists(select 1 from memoid.review_policy_evaluations evaluation where evaluation.workspace_id=new.workspace_id and evaluation.project_id=new.project_id and evaluation.id=new.evaluation_id and evaluation.proposal_item_id=new.proposal_item_id) then raise exception 'Review policy evaluation/item mismatch'; end if;
    return new;
  end $$`.execute(db);
  await sql`create trigger review_policy_current_guard before update or delete on memoid.review_policy_current_states for each row execute function memoid.guard_review_policy_current()`.execute(
    db,
  );
  for (const table of tables) {
    await sql.raw(`alter table memoid.${table} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${table} force row level security`).execute(db);
    await sql
      .raw(
        `create policy ${table}_tenant on memoid.${table} using (workspace_id=memoid.current_workspace_id() and project_id=memoid.current_project_id()) with check (workspace_id=memoid.current_workspace_id() and project_id=memoid.current_project_id())`,
      )
      .execute(db);
  }
}

async function functions(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.review_policy_evaluation_is_current(p_project_id uuid,p_evaluation_id uuid)
  returns boolean language sql stable security definer set search_path=pg_catalog,memoid as $$
    select exists(
      select 1 from memoid.review_policy_evaluations evaluation
      join memoid.review_policy_current_states current_state on current_state.workspace_id=evaluation.workspace_id and current_state.project_id=evaluation.project_id and current_state.proposal_item_id=evaluation.proposal_item_id and current_state.evaluation_id=evaluation.id
      join memoid.proposal_item_current_states item_state on item_state.workspace_id=evaluation.workspace_id and item_state.project_id=evaluation.project_id and item_state.proposal_item_id=evaluation.proposal_item_id
      where evaluation.workspace_id=memoid.current_workspace_id() and evaluation.project_id=p_project_id and p_project_id=memoid.current_project_id() and evaluation.id=p_evaluation_id
        and item_state.lifecycle_state='CURRENT' and memoid.proposal_item_basis_is_current(p_project_id,evaluation.proposal_item_id)
        and evaluation.project_policy_version=(select version from memoid.project_review_policy_versions policy where policy.workspace_id=evaluation.workspace_id and policy.project_id=evaluation.project_id and policy.effective_at<=clock_timestamp() order by policy.effective_at desc,policy.version desc limit 1)
        and evaluation.project_policy=(select policy from memoid.project_review_policy_versions policy where policy.workspace_id=evaluation.workspace_id and policy.project_id=evaluation.project_id and policy.effective_at<=clock_timestamp() order by policy.effective_at desc,policy.version desc limit 1)
    )
  $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.evaluate_proposal_item_review_policy(p_project_id uuid,p_proposal_item_id uuid)
  returns uuid language plpgsql security definer set search_path=pg_catalog,memoid as $$
  declare project_row memoid.projects%rowtype; actor_row memoid.actors%rowtype; item memoid.change_proposal_items%rowtype; item_state memoid.proposal_item_current_states%rowtype; policy_row memoid.project_review_policy_versions%rowtype; rec memoid.reconciliation_records%rowtype;
    prior_id uuid; result_id uuid; operation_value uuid:=uuidv7(); correlation_value uuid:=uuidv7(); reasons jsonb:='[]'::jsonb; checks jsonb; decision_value varchar(32); current_basis boolean; basis_value bytea; branch_only boolean:=false; evidence_count integer; resolved_evidence_count integer:=0;
  begin
    perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,1011));
    perform pg_advisory_xact_lock(hashtextextended(p_project_id::text||':'||p_proposal_item_id::text,1012));
    select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id() and id=p_project_id and p_project_id=memoid.current_project_id() and lifecycle_state='ACTIVE';
    if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
    select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id and id=memoid.current_actor_id();
    if not found or actor_row.actor_kind not in ('MEMOID_SYSTEM','MEMOID_WORKER','HUMAN') then raise exception 'POLICY_EVALUATION_ACTOR_FORBIDDEN'; end if;
    select * into item from memoid.change_proposal_items where workspace_id=project_row.workspace_id and project_id=project_row.id and id=p_proposal_item_id;
    if not found then raise exception 'PROPOSAL_ITEM_NOT_FOUND'; end if;
    select * into item_state from memoid.proposal_item_current_states where workspace_id=item.workspace_id and project_id=item.project_id and proposal_item_id=item.id for update;
    select * into rec from memoid.reconciliation_records where workspace_id=item.workspace_id and project_id=item.project_id and id=item.reconciliation_id;
    select * into policy_row from memoid.project_review_policy_versions where workspace_id=item.workspace_id and project_id=item.project_id and effective_at<=clock_timestamp() order by effective_at desc,version desc limit 1;
    if not found then raise exception 'EFFECTIVE_REVIEW_POLICY_MISSING'; end if;
    current_basis:=item_state.lifecycle_state='CURRENT' and memoid.proposal_item_basis_is_current(project_row.id,item.id);
    evidence_count:=jsonb_array_length(item.evidence_reference_ids);
    if evidence_count>0 then
      select count(*)::integer,coalesce(bool_and(coalesce((observation.metadata->>'IS_DEFAULT_REF')::boolean,false)=false),false) into resolved_evidence_count,branch_only
      from jsonb_array_elements_text(item.evidence_reference_ids) evidence_id
      join memoid.evidence_references evidence on evidence.workspace_id=item.workspace_id and evidence.project_id=item.project_id and evidence.id=evidence_id::uuid
      join memoid.source_observations observation on observation.workspace_id=evidence.workspace_id and observation.project_id=evidence.project_id and observation.id=evidence.source_observation_id;
    end if;
    if policy_row.policy='MANUAL' then reasons:=reasons||'"PROJECT_POLICY_MANUAL"'::jsonb; end if;
    if not current_basis then reasons:=reasons||'"PROPOSAL_STALE"'::jsonb; end if;
    if item.conflict_qualified or item.reconciliation_class='CONFLICTING' then reasons:=reasons||'"PROTECTED_CONFLICT"'::jsonb; end if;
    if item.uncertainty_qualified or item.reconciliation_class='UNCERTAIN' then reasons:=reasons||'"PROTECTED_UNCERTAINTY"'::jsonb; end if;
    if item.destructive or item.reconciliation_class='OBSOLETE' then reasons:=reasons||'"PROTECTED_DESTRUCTIVE"'::jsonb; end if;
    if rec.reason_codes ?| array['AUTHORITY_SENSITIVE','DEGRADED_AUTHORITY','SHADOWED_SOURCE'] then reasons:=reasons||'"PROTECTED_AUTHORITY"'::jsonb; end if;
    if rec.reason_codes ?| array['SECURITY_SENSITIVE','SECRET_DETECTED'] then reasons:=reasons||'"PROTECTED_SECURITY"'::jsonb; end if;
    if rec.reason_codes ?| array['TOPOLOGY_SENSITIVE','PROJECT_TOPOLOGY_CHANGED'] then reasons:=reasons||'"PROTECTED_TOPOLOGY"'::jsonb; end if;
    if evidence_count=0 or resolved_evidence_count<>evidence_count then reasons:=reasons||'"PROTECTED_INSUFFICIENT_EVIDENCE"'::jsonb; end if;
    if rec.reason_codes ?| array['LOW_CONFIDENCE','VERIFIER_DISAGREEMENT'] then reasons:=reasons||'"PROTECTED_LOW_CONFIDENCE"'::jsonb; end if;
    if branch_only or rec.reason_codes ? 'BRANCH_ONLY' then reasons:=reasons||'"PROTECTED_BRANCH_ONLY"'::jsonb; end if;
    if jsonb_array_length(reasons)=0 then decision_value:='AUTOMATIC_ELIGIBLE'; reasons:='["AUTOMATIC_ELIGIBLE"]'::jsonb; else decision_value:='MANUAL_REQUIRED'; end if;
    checks:=jsonb_build_object('CONFLICT',item.conflict_qualified,'UNCERTAINTY',item.uncertainty_qualified,'DESTRUCTIVE',item.destructive,'AUTHORITY_VERSION',item.authority_version,'EVIDENCE_COUNT',evidence_count,'RESOLVED_EVIDENCE_COUNT',resolved_evidence_count,'BRANCH_ONLY',branch_only,'PROPOSAL_BASIS_CURRENT',current_basis);
    basis_value:=sha256(item.basis_hash||convert_to('review-policy.v1|'||item_state.version::text||'|'||policy_row.version::text||'|'||policy_row.policy||'|'||rec.reason_codes::text,'UTF8'));
    select evaluation_id into prior_id from memoid.review_policy_current_states where workspace_id=item.workspace_id and project_id=item.project_id and proposal_item_id=item.id;
    select id into result_id from memoid.review_policy_evaluations where workspace_id=item.workspace_id and project_id=item.project_id and proposal_item_id=item.id and project_policy_version=policy_row.version and policy_engine_version='review-policy.v1' and evaluated_basis_hash=basis_value;
    if result_id is null then
      insert into memoid.operations(workspace_id,project_id,id,initiating_actor_id,operation_kind,state,correlation_id,attempt_count,max_attempts,terminal_at) values(item.workspace_id,item.project_id,operation_value,actor_row.id,'EVALUATE_REVIEW_POLICY','SUCCEEDED',correlation_value,1,1,clock_timestamp());
      insert into memoid.review_policy_evaluations(workspace_id,project_id,proposal_item_id,project_policy_version,project_policy,decision,reason_codes,protected_checks,policy_engine_version,evaluated_basis_hash,supersedes_evaluation_id,operation_id,evaluated_by_actor_id)
        values(item.workspace_id,item.project_id,item.id,policy_row.version,policy_row.policy,decision_value,reasons,checks,'review-policy.v1',basis_value,prior_id,operation_value,actor_row.id) returning id into result_id;
      insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,target_type,target_key,correlation_id,operation_id,outcome,metadata) values(item.workspace_id,item.project_id,actor_row.id,'DATA_INTEGRITY','REVIEW_POLICY_EVALUATED',clock_timestamp(),'CHANGE_PROPOSAL_ITEM',item.id::text,correlation_value,operation_value,'SUCCESS',jsonb_build_object('POLICY_VERSION',policy_row.version,'POLICY',policy_row.policy,'DECISION',decision_value,'REASON_CODES',reasons,'ENGINE_VERSION','review-policy.v1'));
    end if;
    insert into memoid.review_policy_current_states(workspace_id,project_id,proposal_item_id,evaluation_id) values(item.workspace_id,item.project_id,item.id,result_id)
      on conflict(workspace_id,project_id,proposal_item_id) do update set evaluation_id=excluded.evaluation_id,version=memoid.review_policy_current_states.version+1,updated_at=clock_timestamp() where memoid.review_policy_current_states.evaluation_id<>excluded.evaluation_id;
    return result_id;
  end $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.evaluate_proposal_review_policy(p_project_id uuid,p_proposal_id uuid)
  returns bigint language plpgsql security definer set search_path=pg_catalog,memoid as $$ declare item record; evaluated bigint:=0; begin
    if not exists(select 1 from memoid.change_proposals proposal where proposal.workspace_id=memoid.current_workspace_id() and proposal.project_id=p_project_id and p_project_id=memoid.current_project_id() and proposal.id=p_proposal_id) then raise exception 'PROPOSAL_NOT_FOUND'; end if;
    for item in select proposal_item.id from memoid.change_proposal_items proposal_item join memoid.proposal_item_current_states state on state.workspace_id=proposal_item.workspace_id and state.project_id=proposal_item.project_id and state.proposal_item_id=proposal_item.id where proposal_item.workspace_id=memoid.current_workspace_id() and proposal_item.project_id=p_project_id and proposal_item.proposal_id=p_proposal_id and state.lifecycle_state='CURRENT' order by proposal_item.created_at,proposal_item.id loop perform memoid.evaluate_proposal_item_review_policy(p_project_id,item.id); evaluated:=evaluated+1; end loop;
    return evaluated;
  end $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.revalidate_project_review_policy(p_project_id uuid)
  returns bigint language plpgsql security definer set search_path=pg_catalog,memoid as $$ declare item record; evaluated bigint:=0; begin
    for item in select proposal_item.id from memoid.change_proposal_items proposal_item join memoid.proposal_item_current_states state on state.workspace_id=proposal_item.workspace_id and state.project_id=proposal_item.project_id and state.proposal_item_id=proposal_item.id where proposal_item.workspace_id=memoid.current_workspace_id() and proposal_item.project_id=p_project_id and p_project_id=memoid.current_project_id() and state.lifecycle_state='CURRENT' order by proposal_item.created_at,proposal_item.id loop perform memoid.evaluate_proposal_item_review_policy(p_project_id,item.id); evaluated:=evaluated+1; end loop;
    return evaluated;
  end $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.change_project_review_policy(p_project_id uuid,p_expected_version bigint,p_policy varchar,p_effective_at timestamptz default null)
  returns table(version bigint,policy varchar,effective_at timestamptz) language plpgsql security definer set search_path=pg_catalog,memoid as $$
  declare project_row memoid.projects%rowtype; actor_row memoid.actors%rowtype; workspace_account uuid; prior memoid.project_review_policy_versions%rowtype; next_effective timestamptz:=coalesce(p_effective_at,clock_timestamp()); operation_value uuid:=uuidv7(); correlation_value uuid:=uuidv7();
  begin
    if p_policy not in ('MANUAL','AUTOMATIC') then raise exception 'INVALID_REVIEW_POLICY'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,1011));
    select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id() and id=p_project_id and p_project_id=memoid.current_project_id() and lifecycle_state='ACTIVE' for update;
    if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
    select workspace.account_id into workspace_account from memoid.workspaces workspace where workspace.id=project_row.workspace_id and workspace.account_id=memoid.current_account_id();
    select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id and id=memoid.current_actor_id() and actor_kind='HUMAN' and actor_reference='account:'||workspace_account::text;
    if not found then raise exception 'POLICY_CHANGE_REQUIRES_FIRST_PARTY_HUMAN'; end if;
    select * into prior from memoid.project_review_policy_versions where workspace_id=project_row.workspace_id and project_id=project_row.id order by version desc limit 1;
    if prior.version<>p_expected_version then raise exception 'STALE_REVIEW_POLICY_VERSION'; end if;
    if next_effective<prior.effective_at then raise exception 'REVIEW_POLICY_EFFECTIVE_TIME_REGRESSION'; end if;
    insert into memoid.project_review_policy_versions(workspace_id,project_id,version,policy,effective_at,changed_by_account_id) values(project_row.workspace_id,project_row.id,prior.version+1,p_policy,next_effective,workspace_account);
    insert into memoid.operations(workspace_id,project_id,id,initiating_actor_id,operation_kind,state,correlation_id,attempt_count,max_attempts,terminal_at) values(project_row.workspace_id,project_row.id,operation_value,actor_row.id,'CHANGE_PROJECT_REVIEW_POLICY','SUCCEEDED',correlation_value,1,1,clock_timestamp());
    insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,target_type,target_key,correlation_id,operation_id,outcome,metadata) values(project_row.workspace_id,project_row.id,actor_row.id,'PRODUCT','PROJECT_REVIEW_POLICY_CHANGED',clock_timestamp(),'PROJECT',project_row.id::text,correlation_value,operation_value,'SUCCESS',jsonb_build_object('OLD_POLICY',prior.policy,'NEW_POLICY',p_policy,'OLD_VERSION',prior.version,'NEW_VERSION',prior.version+1,'EFFECTIVE_AT',next_effective));
    if next_effective<=clock_timestamp() then perform memoid.revalidate_project_review_policy(project_row.id); end if;
    return query select prior.version+1,p_policy,next_effective;
  end $$`,
    )
    .execute(db);
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.review_policy_evaluations,memoid.review_policy_current_states from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`grant select on memoid.review_policy_evaluations,memoid.review_policy_current_states to memoid_app`.execute(
    db,
  );
  await sql`revoke all on function memoid.guard_review_policy_current(),memoid.review_policy_evaluation_is_current(uuid,uuid),memoid.evaluate_proposal_item_review_policy(uuid,uuid),memoid.evaluate_proposal_review_policy(uuid,uuid),memoid.revalidate_project_review_policy(uuid),memoid.change_project_review_policy(uuid,bigint,varchar,timestamptz) from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`grant execute on function memoid.review_policy_evaluation_is_current(uuid,uuid),memoid.evaluate_proposal_item_review_policy(uuid,uuid),memoid.evaluate_proposal_review_policy(uuid,uuid),memoid.revalidate_project_review_policy(uuid),memoid.change_project_review_policy(uuid,bigint,varchar,timestamptz) to memoid_app`.execute(
    db,
  );
}

export const stage10lReviewPolicyTransitionsMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createTables(db);
    await guardsAndRls(db);
    await functions(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`do $$ begin if exists(select 1 from memoid.review_policy_evaluations) then raise exception 'STAGE10L_ROLLBACK_REFUSED_POPULATED_POLICY_HISTORY'; end if; end $$`.execute(
      db,
    );
    await sql`set local role memoid_owner`.execute(db);
    await sql`drop function if exists memoid.change_project_review_policy(uuid,bigint,varchar,timestamptz)`.execute(
      db,
    );
    await sql`drop function if exists memoid.revalidate_project_review_policy(uuid)`.execute(db);
    await sql`drop function if exists memoid.evaluate_proposal_review_policy(uuid,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.evaluate_proposal_item_review_policy(uuid,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.review_policy_evaluation_is_current(uuid,uuid)`.execute(
      db,
    );
    await sql`drop table if exists memoid.review_policy_current_states`.execute(db);
    await sql`drop table if exists memoid.review_policy_evaluations`.execute(db);
    await sql`drop function if exists memoid.guard_review_policy_current()`.execute(db);
    await sql`reset role`.execute(db);
  },
};
