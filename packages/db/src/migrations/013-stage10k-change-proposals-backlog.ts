import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const projectTables = [
  "change_proposals",
  "change_proposal_items",
  "proposal_current_states",
  "proposal_item_current_states",
  "proposal_state_events",
] as const;

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.change_proposals (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    grouping_version varchar(64) not null,
    grouping_key bytea not null,
    submission_id uuid not null,
    scope_key varchar(256) not null,
    facet_key varchar(256) not null,
    operation_id uuid not null,
    created_by_actor_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint change_proposals_id_v7 check (memoid.is_uuid_v7(id)),
    constraint change_proposals_group_hash check (octet_length(grouping_key)=32),
    constraint change_proposals_submission_fk foreign key (workspace_id,project_id,submission_id)
      references memoid.candidate_submissions(workspace_id,project_id,id),
    constraint change_proposals_operation_fk foreign key (workspace_id,project_id,operation_id)
      references memoid.operations(workspace_id,project_id,id),
    constraint change_proposals_actor_fk foreign key (workspace_id,created_by_actor_id)
      references memoid.actors(workspace_id,id),
    constraint change_proposals_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);

  await sql`create table memoid.change_proposal_items (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    proposal_id uuid not null,
    reconciliation_id uuid not null,
    candidate_assertion_id uuid not null,
    context_identity_id uuid not null,
    semantic_fingerprint bytea not null,
    semantic_identity varchar(1024) not null,
    reconciliation_class varchar(16) not null,
    normalized_assertion jsonb not null,
    current_context_record_id uuid,
    working_context_item_id uuid not null,
    evidence_reference_ids jsonb not null,
    conflict_qualified boolean not null,
    uncertainty_qualified boolean not null,
    destructive boolean not null,
    current_context_version bigint not null,
    working_context_version bigint not null,
    authority_version bigint not null,
    evidence_frontier_version bigint not null,
    integrity_version bigint not null,
    engine_contract_version varchar(100) not null,
    basis_hash bytea not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint change_proposal_items_id_v7 check (memoid.is_uuid_v7(id)),
    constraint change_proposal_items_proposal_fk foreign key (workspace_id,project_id,proposal_id)
      references memoid.change_proposals(workspace_id,project_id,id),
    constraint change_proposal_items_reconciliation_fk foreign key (workspace_id,project_id,reconciliation_id)
      references memoid.reconciliation_records(workspace_id,project_id,id),
    constraint change_proposal_items_candidate_fk foreign key (workspace_id,project_id,candidate_assertion_id)
      references memoid.candidate_assertions(workspace_id,project_id,id),
    constraint change_proposal_items_identity_fk foreign key (workspace_id,project_id,context_identity_id)
      references memoid.context_identities(workspace_id,project_id,id),
    constraint change_proposal_items_context_fk foreign key (workspace_id,project_id,current_context_record_id)
      references memoid.context_records(workspace_id,project_id,id),
    constraint change_proposal_items_working_fk foreign key (workspace_id,project_id,working_context_item_id)
      references memoid.working_context_items(workspace_id,project_id,id),
    constraint change_proposal_items_hashes check (octet_length(semantic_fingerprint)=32 and octet_length(basis_hash)=32),
    constraint change_proposal_items_class check (reconciliation_class in ('NEW','CHANGED','SUPERSEDED','CONFLICTING','OBSOLETE','UNCERTAIN')),
    constraint change_proposal_items_flags check ((reconciliation_class='CONFLICTING')=conflict_qualified and (reconciliation_class='UNCERTAIN')=uncertainty_qualified and (reconciliation_class='OBSOLETE')=destructive),
    constraint change_proposal_items_assertion check (jsonb_typeof(normalized_assertion)='object' and octet_length(normalized_assertion::text)<=65536),
    constraint change_proposal_items_evidence check (jsonb_typeof(evidence_reference_ids)='array'),
    constraint change_proposal_items_versions check (current_context_version>=0 and working_context_version>=0 and authority_version>=0 and evidence_frontier_version>=0 and integrity_version>=0),
    constraint change_proposal_items_reconciliation_unique unique (workspace_id,project_id,reconciliation_id),
    constraint change_proposal_items_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);

  await sql`create table memoid.proposal_current_states (
    workspace_id uuid not null,
    project_id uuid not null,
    proposal_id uuid not null,
    lifecycle_state varchar(16) not null,
    successor_proposal_id uuid,
    reason varchar(64),
    version bigint not null default 1,
    changed_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,proposal_id),
    constraint proposal_current_proposal_fk foreign key (workspace_id,project_id,proposal_id)
      references memoid.change_proposals(workspace_id,project_id,id),
    constraint proposal_current_successor_fk foreign key (workspace_id,project_id,successor_proposal_id)
      references memoid.change_proposals(workspace_id,project_id,id),
    constraint proposal_current_state check (lifecycle_state in ('OPEN','STALE','SUPERSEDED')),
    constraint proposal_current_shape check ((lifecycle_state='SUPERSEDED')=(successor_proposal_id is not null) and (lifecycle_state='OPEN')=(reason is null)),
    constraint proposal_current_not_self check (successor_proposal_id is null or successor_proposal_id<>proposal_id)
  )`.execute(db);

  await sql`create table memoid.proposal_item_current_states (
    workspace_id uuid not null,
    project_id uuid not null,
    proposal_item_id uuid not null,
    lifecycle_state varchar(16) not null,
    successor_item_id uuid,
    reason varchar(64),
    version bigint not null default 1,
    changed_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,proposal_item_id),
    constraint proposal_item_current_item_fk foreign key (workspace_id,project_id,proposal_item_id)
      references memoid.change_proposal_items(workspace_id,project_id,id),
    constraint proposal_item_current_successor_fk foreign key (workspace_id,project_id,successor_item_id)
      references memoid.change_proposal_items(workspace_id,project_id,id),
    constraint proposal_item_current_state check (lifecycle_state in ('CURRENT','STALE','SUPERSEDED')),
    constraint proposal_item_current_shape check ((lifecycle_state='SUPERSEDED')=(successor_item_id is not null) and (lifecycle_state='CURRENT')=(reason is null)),
    constraint proposal_item_current_not_self check (successor_item_id is null or successor_item_id<>proposal_item_id)
  )`.execute(db);

  await sql`create table memoid.proposal_state_events (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    target_kind varchar(16) not null,
    proposal_id uuid not null,
    proposal_item_id uuid,
    from_state varchar(16),
    to_state varchar(16) not null,
    reason varchar(64) not null,
    successor_proposal_id uuid,
    successor_item_id uuid,
    operation_id uuid not null,
    actor_id uuid not null,
    occurred_at timestamptz not null default clock_timestamp(),
    constraint proposal_state_events_id_v7 check (memoid.is_uuid_v7(id)),
    constraint proposal_state_events_target check ((target_kind='PROPOSAL' and proposal_item_id is null) or (target_kind='ITEM' and proposal_item_id is not null)),
    constraint proposal_state_events_proposal_fk foreign key (workspace_id,project_id,proposal_id)
      references memoid.change_proposals(workspace_id,project_id,id),
    constraint proposal_state_events_item_fk foreign key (workspace_id,project_id,proposal_item_id)
      references memoid.change_proposal_items(workspace_id,project_id,id),
    constraint proposal_state_events_successor_proposal_fk foreign key (workspace_id,project_id,successor_proposal_id)
      references memoid.change_proposals(workspace_id,project_id,id),
    constraint proposal_state_events_successor_item_fk foreign key (workspace_id,project_id,successor_item_id)
      references memoid.change_proposal_items(workspace_id,project_id,id),
    constraint proposal_state_events_operation_fk foreign key (workspace_id,project_id,operation_id)
      references memoid.operations(workspace_id,project_id,id),
    constraint proposal_state_events_actor_fk foreign key (workspace_id,actor_id)
      references memoid.actors(workspace_id,id),
    constraint proposal_state_events_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);

  await sql`create index change_proposals_grouping_idx on memoid.change_proposals(workspace_id,project_id,grouping_key,created_at,id)`.execute(
    db,
  );
  await sql`create index proposal_items_concern_idx on memoid.change_proposal_items(workspace_id,project_id,context_identity_id,created_at,id)`.execute(
    db,
  );
  await sql`create index proposal_items_fingerprint_idx on memoid.change_proposal_items(workspace_id,project_id,semantic_fingerprint)`.execute(
    db,
  );
  await sql`create index proposal_backlog_order_idx on memoid.proposal_current_states(workspace_id,project_id,lifecycle_state,changed_at,proposal_id)`.execute(
    db,
  );
}

async function guardsAndRls(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.guard_proposal_history() returns trigger language plpgsql set search_path=pg_catalog,memoid as $$ begin raise exception 'Proposal history is immutable'; end $$`.execute(
    db,
  );
  for (const table of ["change_proposals", "change_proposal_items", "proposal_state_events"])
    await sql
      .raw(
        `create trigger ${table}_immutable before update or delete on memoid.${table} for each row execute function memoid.guard_proposal_history()`,
      )
      .execute(db);
  await sql`create function memoid.guard_proposal_current() returns trigger language plpgsql set search_path=pg_catalog,memoid as $$ begin
    if tg_op='DELETE' then raise exception 'Proposal current state cannot be deleted'; end if;
    if new.workspace_id<>old.workspace_id or new.project_id<>old.project_id or new.version<>old.version+1 then raise exception 'Invalid proposal current transition'; end if;
    if tg_table_name='proposal_current_states' then
      if new.proposal_id<>old.proposal_id or old.lifecycle_state<>'OPEN' or new.lifecycle_state not in ('STALE','SUPERSEDED') then raise exception 'Invalid proposal lifecycle transition'; end if;
      if new.successor_proposal_id is not null and exists(with recursive lineage(id) as (
        select new.successor_proposal_id union all select state.successor_proposal_id from memoid.proposal_current_states state join lineage on state.proposal_id=lineage.id where state.workspace_id=new.workspace_id and state.project_id=new.project_id and state.successor_proposal_id is not null
      ) select 1 from lineage where id=new.proposal_id) then raise exception 'Proposal successor cycle'; end if;
    else
      if new.proposal_item_id<>old.proposal_item_id or old.lifecycle_state<>'CURRENT' or new.lifecycle_state not in ('STALE','SUPERSEDED') then raise exception 'Invalid proposal item lifecycle transition'; end if;
      if new.successor_item_id is not null and exists(with recursive lineage(id) as (
        select new.successor_item_id union all select state.successor_item_id from memoid.proposal_item_current_states state join lineage on state.proposal_item_id=lineage.id where state.workspace_id=new.workspace_id and state.project_id=new.project_id and state.successor_item_id is not null
      ) select 1 from lineage where id=new.proposal_item_id) then raise exception 'Proposal Item successor cycle'; end if;
    end if;
    return new;
  end $$`.execute(db);
  await sql`create trigger proposal_current_guard before update or delete on memoid.proposal_current_states for each row execute function memoid.guard_proposal_current()`.execute(
    db,
  );
  await sql`create trigger proposal_item_current_guard before update or delete on memoid.proposal_item_current_states for each row execute function memoid.guard_proposal_current()`.execute(
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

async function functions(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.proposal_item_basis_is_current(p_project_id uuid,p_proposal_item_id uuid)
  returns boolean language sql stable security definer set search_path=pg_catalog,memoid as $$
    select exists(
      select 1 from memoid.change_proposal_items item
      join memoid.context_identities identity on identity.workspace_id=item.workspace_id and identity.project_id=item.project_id and identity.id=item.context_identity_id
      left join memoid.context_identity_current_records current_context on current_context.workspace_id=item.workspace_id and current_context.project_id=item.project_id and current_context.context_identity_id=item.context_identity_id
      where item.workspace_id=memoid.current_workspace_id() and item.project_id=p_project_id and p_project_id=memoid.current_project_id() and item.id=p_proposal_item_id
        and current_context.context_record_id is not distinct from item.current_context_record_id and identity.version=item.current_context_version
        and item.authority_version=(select coalesce(sum(version),0) from memoid.source_authority_scopes authority where authority.workspace_id=item.workspace_id and authority.project_id=item.project_id)
        and item.evidence_frontier_version=(select coalesce(sum(coalesce(observed_sequence,0)+coalesce(desired_sequence,0)+coalesce(ingested_sequence,0)+coalesce(reconciled_sequence,0)),0) from memoid.source_frontier_states frontier where frontier.workspace_id=item.workspace_id and frontier.project_id=item.project_id)
        and item.integrity_version=(coalesce((select sum(conflict_state.occurrence_version) from memoid.integrity_conflicts conflict join memoid.conflict_current_states conflict_state on conflict_state.workspace_id=conflict.workspace_id and conflict_state.project_id=conflict.project_id and conflict_state.conflict_id=conflict.id where conflict.workspace_id=item.workspace_id and conflict.project_id=item.project_id and conflict.context_identity_id=item.context_identity_id),0)+coalesce((select sum(uncertainty_state.occurrence_version) from memoid.integrity_uncertainties uncertainty join memoid.uncertainty_current_states uncertainty_state on uncertainty_state.workspace_id=uncertainty.workspace_id and uncertainty_state.project_id=uncertainty.project_id and uncertainty_state.uncertainty_id=uncertainty.id where uncertainty.workspace_id=item.workspace_id and uncertainty.project_id=item.project_id and uncertainty.context_identity_id=item.context_identity_id),0))
        and exists(select 1 from memoid.reconciliation_current_states reconciliation_state where reconciliation_state.workspace_id=item.workspace_id and reconciliation_state.project_id=item.project_id and reconciliation_state.candidate_assertion_id=item.candidate_assertion_id and reconciliation_state.reconciliation_id=item.reconciliation_id)
    )
  $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.materialize_change_proposal(p_project_id uuid,p_reconciliation_id uuid)
  returns table(proposal_id uuid,proposal_item_id uuid,replayed boolean)
  language plpgsql security definer set search_path=pg_catalog,memoid as $$
  declare project_row memoid.projects%rowtype; actor_row memoid.actors%rowtype; rec memoid.reconciliation_records%rowtype;
    submission uuid; scope_value varchar; facet_value varchar; group_hash bytea; fingerprint bytea;
    selected_proposal uuid; selected_item uuid; predecessor_item uuid; predecessor_proposal uuid; operation_value uuid:=uuidv7();
    actual_context uuid; actual_context_version bigint; actual_authority bigint; actual_frontier bigint; actual_integrity bigint;
  begin
    select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id() and id=p_project_id and p_project_id=memoid.current_project_id() for share;
    if not found or project_row.lifecycle_state<>'ACTIVE' then raise exception 'RESOURCE_NOT_FOUND'; end if;
    select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id and id=memoid.current_actor_id();
    if not found or actor_row.actor_kind not in ('MEMOID_SYSTEM','MEMOID_WORKER') then raise exception 'PROPOSAL_MATERIALIZATION_REQUIRES_SYSTEM_ACTOR'; end if;
    select * into rec from memoid.reconciliation_records where workspace_id=project_row.workspace_id and project_id=project_row.id and id=p_reconciliation_id;
    if not found then raise exception 'RECONCILIATION_NOT_FOUND'; end if;
    if rec.classification='UNCHANGED' then return; end if;
    perform 1 from memoid.reconciliation_current_states where workspace_id=project_row.workspace_id and project_id=project_row.id and candidate_assertion_id=rec.candidate_assertion_id and reconciliation_id=rec.id;
    if not found then raise exception 'RECONCILIATION_NOT_CURRENT'; end if;
    perform pg_advisory_xact_lock(hashtextextended(project_row.id::text||':'||rec.context_identity_id::text,0));
    select current_state.context_record_id,identity.version into actual_context,actual_context_version
      from memoid.context_identities identity left join memoid.context_identity_current_records current_state
        on current_state.workspace_id=identity.workspace_id and current_state.project_id=identity.project_id and current_state.context_identity_id=identity.id
      where identity.workspace_id=project_row.workspace_id and identity.project_id=project_row.id and identity.id=rec.context_identity_id;
    select coalesce(sum(version),0) into actual_authority from memoid.source_authority_scopes where workspace_id=project_row.workspace_id and project_id=project_row.id;
    select coalesce(sum(coalesce(observed_sequence,0)+coalesce(desired_sequence,0)+coalesce(ingested_sequence,0)+coalesce(reconciled_sequence,0)),0) into actual_frontier from memoid.source_frontier_states where workspace_id=project_row.workspace_id and project_id=project_row.id;
    select coalesce((select sum(state.occurrence_version) from memoid.integrity_conflicts conflict join memoid.conflict_current_states state on state.workspace_id=conflict.workspace_id and state.project_id=conflict.project_id and state.conflict_id=conflict.id where conflict.workspace_id=project_row.workspace_id and conflict.project_id=project_row.id and conflict.context_identity_id=rec.context_identity_id),0)
      +coalesce((select sum(state.occurrence_version) from memoid.integrity_uncertainties uncertainty join memoid.uncertainty_current_states state on state.workspace_id=uncertainty.workspace_id and state.project_id=uncertainty.project_id and state.uncertainty_id=uncertainty.id where uncertainty.workspace_id=project_row.workspace_id and uncertainty.project_id=project_row.id and uncertainty.context_identity_id=rec.context_identity_id),0) into actual_integrity;
    if actual_context is distinct from rec.current_context_record_id or actual_context_version<>rec.current_context_version or actual_authority<>rec.authority_version or actual_frontier<>rec.evidence_frontier_version or actual_integrity<>rec.integrity_version then raise exception 'STALE_PROPOSAL_BASIS'; end if;
    select a.candidate_submission_id,i.scope_key,i.facet_key into submission,scope_value,facet_value
      from memoid.candidate_assertions a join memoid.context_identities i on i.workspace_id=a.workspace_id and i.project_id=a.project_id and i.id=rec.context_identity_id
      where a.workspace_id=project_row.workspace_id and a.project_id=project_row.id and a.id=rec.candidate_assertion_id;
    group_hash:=sha256(convert_to('proposal-grouping.v1|'||project_row.id::text||'|'||submission::text||'|'||scope_value||'|'||facet_value,'UTF8'));
    fingerprint:=sha256(convert_to('proposal-item-identity.v1|'||project_row.id::text||'|'||rec.context_identity_id::text||'|'||rec.classification||'|'||rec.normalized_assertion::text||'|'||coalesce(rec.current_context_record_id::text,'')||'|'||rec.evidence_reference_ids::text||'|'||rec.authority_version::text||'|'||rec.evidence_frontier_version::text||'|'||rec.integrity_version::text,'UTF8'));
    select item.id,item.proposal_id into selected_item,selected_proposal from memoid.change_proposal_items item
      join memoid.proposal_item_current_states state on state.workspace_id=item.workspace_id and state.project_id=item.project_id and state.proposal_item_id=item.id
      where item.workspace_id=project_row.workspace_id and item.project_id=project_row.id and item.semantic_fingerprint=fingerprint and state.lifecycle_state='CURRENT'
      order by item.created_at,item.id limit 1;
    if found then return query select selected_proposal,selected_item,true; return; end if;
    select item.id,item.proposal_id into predecessor_item,predecessor_proposal from memoid.change_proposal_items item
      join memoid.proposal_item_current_states state on state.workspace_id=item.workspace_id and state.project_id=item.project_id and state.proposal_item_id=item.id
      where item.workspace_id=project_row.workspace_id and item.project_id=project_row.id and item.context_identity_id=rec.context_identity_id and state.lifecycle_state='CURRENT'
      order by item.created_at desc,item.id desc limit 1 for update of state;
    if predecessor_item is null then
      select proposal.id into selected_proposal from memoid.change_proposals proposal join memoid.proposal_current_states state on state.workspace_id=proposal.workspace_id and state.project_id=proposal.project_id and state.proposal_id=proposal.id
        where proposal.workspace_id=project_row.workspace_id and proposal.project_id=project_row.id and proposal.grouping_key=group_hash and state.lifecycle_state='OPEN'
        order by proposal.created_at,proposal.id limit 1 for update of state;
    end if;
    insert into memoid.operations(workspace_id,project_id,id,initiating_actor_id,operation_kind,state,attempt_count,max_attempts,terminal_at)
      values(project_row.workspace_id,project_row.id,operation_value,actor_row.id,'MATERIALIZE_CHANGE_PROPOSAL','SUCCEEDED',1,1,clock_timestamp());
    if selected_proposal is null then
      insert into memoid.change_proposals(workspace_id,project_id,grouping_version,grouping_key,submission_id,scope_key,facet_key,operation_id,created_by_actor_id)
        values(project_row.workspace_id,project_row.id,'proposal-grouping.v1',group_hash,submission,scope_value,facet_value,operation_value,actor_row.id) returning id into selected_proposal;
      insert into memoid.proposal_current_states(workspace_id,project_id,proposal_id,lifecycle_state) values(project_row.workspace_id,project_row.id,selected_proposal,'OPEN');
      insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,to_state,reason,operation_id,actor_id)
        values(project_row.workspace_id,project_row.id,'PROPOSAL',selected_proposal,'OPEN','MATERIALIZED',operation_value,actor_row.id);
    end if;
    insert into memoid.change_proposal_items(workspace_id,project_id,proposal_id,reconciliation_id,candidate_assertion_id,context_identity_id,semantic_fingerprint,semantic_identity,reconciliation_class,normalized_assertion,current_context_record_id,working_context_item_id,evidence_reference_ids,conflict_qualified,uncertainty_qualified,destructive,current_context_version,working_context_version,authority_version,evidence_frontier_version,integrity_version,engine_contract_version,basis_hash)
      values(project_row.workspace_id,project_row.id,selected_proposal,rec.id,rec.candidate_assertion_id,rec.context_identity_id,fingerprint,rec.semantic_identity,rec.classification,rec.normalized_assertion,rec.current_context_record_id,rec.working_context_item_id,rec.evidence_reference_ids,rec.conflict_indicated,rec.uncertainty_indicated,rec.classification='OBSOLETE',rec.current_context_version,rec.working_context_version,rec.authority_version,rec.evidence_frontier_version,rec.integrity_version,rec.engine_contract_version,rec.basis_hash)
      on conflict (workspace_id,project_id,reconciliation_id) do nothing returning id into selected_item;
    if selected_item is null then select id,proposal_id into selected_item,selected_proposal from memoid.change_proposal_items where workspace_id=project_row.workspace_id and project_id=project_row.id and reconciliation_id=rec.id; return query select selected_proposal,selected_item,true; return; end if;
    insert into memoid.proposal_item_current_states(workspace_id,project_id,proposal_item_id,lifecycle_state) values(project_row.workspace_id,project_row.id,selected_item,'CURRENT');
    insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,proposal_item_id,to_state,reason,operation_id,actor_id)
      values(project_row.workspace_id,project_row.id,'ITEM',selected_proposal,selected_item,'CURRENT','MATERIALIZED',operation_value,actor_row.id);
    if predecessor_item is not null then
      update memoid.proposal_item_current_states set lifecycle_state='SUPERSEDED',successor_item_id=selected_item,reason='NEWER_RECONCILIATION',version=version+1,changed_at=clock_timestamp()
        where workspace_id=project_row.workspace_id and project_id=project_row.id and proposal_item_id=predecessor_item and lifecycle_state='CURRENT';
      insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,proposal_item_id,from_state,to_state,reason,successor_proposal_id,successor_item_id,operation_id,actor_id)
        values(project_row.workspace_id,project_row.id,'ITEM',predecessor_proposal,predecessor_item,'CURRENT','SUPERSEDED','NEWER_RECONCILIATION',selected_proposal,selected_item,operation_value,actor_row.id);
      if not exists(select 1 from memoid.change_proposal_items item join memoid.proposal_item_current_states state on state.workspace_id=item.workspace_id and state.project_id=item.project_id and state.proposal_item_id=item.id where item.workspace_id=project_row.workspace_id and item.project_id=project_row.id and item.proposal_id=predecessor_proposal and state.lifecycle_state='CURRENT') then
        update memoid.proposal_current_states set lifecycle_state='SUPERSEDED',successor_proposal_id=selected_proposal,reason='ALL_ITEMS_SUPERSEDED',version=version+1,changed_at=clock_timestamp()
          where workspace_id=project_row.workspace_id and project_id=project_row.id and proposal_id=predecessor_proposal and lifecycle_state='OPEN';
        insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,from_state,to_state,reason,successor_proposal_id,operation_id,actor_id)
          values(project_row.workspace_id,project_row.id,'PROPOSAL',predecessor_proposal,'OPEN','SUPERSEDED','ALL_ITEMS_SUPERSEDED',selected_proposal,operation_value,actor_row.id);
      end if;
    end if;
    insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,target_type,target_key,correlation_id,operation_id,outcome,metadata)
      values(project_row.workspace_id,project_row.id,actor_row.id,'DATA_INTEGRITY','CHANGE_PROPOSAL_MATERIALIZED',clock_timestamp(),'CHANGE_PROPOSAL',selected_proposal::text,uuidv7(),operation_value,'SUCCESS',jsonb_build_object('RECONCILIATION_ID',rec.id::text,'RECONCILIATION_CLASS',rec.classification));
    return query select selected_proposal,selected_item,false;
  end $$`,
    )
    .execute(db);

  await sql
    .raw(
      `create function memoid.refresh_change_proposal_backlog(p_project_id uuid)
  returns bigint language plpgsql security definer set search_path=pg_catalog,memoid as $$
  declare project_row memoid.projects%rowtype; actor_row memoid.actors%rowtype; changed bigint:=0; item record; operation_value uuid;
  begin
    select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id() and id=p_project_id and p_project_id=memoid.current_project_id();
    if not found or project_row.lifecycle_state<>'ACTIVE' then raise exception 'RESOURCE_NOT_FOUND'; end if;
    select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id and id=memoid.current_actor_id();
    if not found or actor_row.actor_kind not in ('MEMOID_SYSTEM','MEMOID_WORKER') then raise exception 'PROPOSAL_REFRESH_REQUIRES_SYSTEM_ACTOR'; end if;
    for item in select proposal_item.id,proposal_item.proposal_id from memoid.change_proposal_items proposal_item
      join memoid.proposal_item_current_states state on state.workspace_id=proposal_item.workspace_id and state.project_id=proposal_item.project_id and state.proposal_item_id=proposal_item.id
      where proposal_item.workspace_id=project_row.workspace_id and proposal_item.project_id=project_row.id and state.lifecycle_state='CURRENT'
        and not memoid.proposal_item_basis_is_current(project_row.id,proposal_item.id)
      for update of state
    loop
      if operation_value is null then
        operation_value:=uuidv7();
        insert into memoid.operations(workspace_id,project_id,id,initiating_actor_id,operation_kind,state,attempt_count,max_attempts,terminal_at) values(project_row.workspace_id,project_row.id,operation_value,actor_row.id,'REFRESH_CHANGE_PROPOSAL_BACKLOG','SUCCEEDED',1,1,clock_timestamp());
      end if;
      update memoid.proposal_item_current_states set lifecycle_state='STALE',reason='BASIS_ADVANCED',version=version+1,changed_at=clock_timestamp() where workspace_id=project_row.workspace_id and project_id=project_row.id and proposal_item_id=item.id;
      insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,proposal_item_id,from_state,to_state,reason,operation_id,actor_id) values(project_row.workspace_id,project_row.id,'ITEM',item.proposal_id,item.id,'CURRENT','STALE','BASIS_ADVANCED',operation_value,actor_row.id);
      changed:=changed+1;
    end loop;
    if operation_value is not null then
      for item in select proposal_state.proposal_id from memoid.proposal_current_states proposal_state
        where proposal_state.workspace_id=project_row.workspace_id and proposal_state.project_id=project_row.id and proposal_state.lifecycle_state='OPEN'
          and not exists(select 1 from memoid.change_proposal_items proposal_item join memoid.proposal_item_current_states item_state on item_state.workspace_id=proposal_item.workspace_id and item_state.project_id=proposal_item.project_id and item_state.proposal_item_id=proposal_item.id where proposal_item.workspace_id=proposal_state.workspace_id and proposal_item.project_id=proposal_state.project_id and proposal_item.proposal_id=proposal_state.proposal_id and item_state.lifecycle_state='CURRENT')
        for update
      loop
        update memoid.proposal_current_states set lifecycle_state='STALE',reason='NO_CURRENT_ITEMS',version=version+1,changed_at=clock_timestamp() where workspace_id=project_row.workspace_id and project_id=project_row.id and proposal_id=item.proposal_id;
        insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,from_state,to_state,reason,operation_id,actor_id) values(project_row.workspace_id,project_row.id,'PROPOSAL',item.proposal_id,'OPEN','STALE','NO_CURRENT_ITEMS',operation_value,actor_row.id);
      end loop;
    end if;
    return changed;
  end $$`,
    )
    .execute(db);
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.change_proposals,memoid.change_proposal_items,memoid.proposal_current_states,memoid.proposal_item_current_states,memoid.proposal_state_events from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`grant select on memoid.change_proposals,memoid.change_proposal_items,memoid.proposal_current_states,memoid.proposal_item_current_states,memoid.proposal_state_events to memoid_app`.execute(
    db,
  );
  await sql`revoke all on function memoid.guard_proposal_history(),memoid.guard_proposal_current(),memoid.proposal_item_basis_is_current(uuid,uuid),memoid.materialize_change_proposal(uuid,uuid),memoid.refresh_change_proposal_backlog(uuid) from public,memoid_app,memoid_auth,memoid_provider`.execute(
    db,
  );
  await sql`grant execute on function memoid.proposal_item_basis_is_current(uuid,uuid),memoid.materialize_change_proposal(uuid,uuid),memoid.refresh_change_proposal_backlog(uuid) to memoid_app`.execute(
    db,
  );
}

export const stage10kChangeProposalsBacklogMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await createTables(db);
    await guardsAndRls(db);
    await functions(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`do $$ begin if exists(select 1 from memoid.change_proposals) then raise exception 'STAGE10K_ROLLBACK_REFUSED_POPULATED_PROPOSAL_HISTORY'; end if; end $$`.execute(
      db,
    );
    await sql`drop function if exists memoid.refresh_change_proposal_backlog(uuid)`.execute(db);
    await sql`drop function if exists memoid.materialize_change_proposal(uuid,uuid)`.execute(db);
    await sql`drop function if exists memoid.proposal_item_basis_is_current(uuid,uuid)`.execute(db);
    await sql`drop table if exists memoid.proposal_state_events`.execute(db);
    await sql`drop table if exists memoid.proposal_item_current_states`.execute(db);
    await sql`drop table if exists memoid.proposal_current_states`.execute(db);
    await sql`drop table if exists memoid.change_proposal_items`.execute(db);
    await sql`drop table if exists memoid.change_proposals`.execute(db);
    await sql`drop function if exists memoid.guard_proposal_current()`.execute(db);
    await sql`drop function if exists memoid.guard_proposal_history()`.execute(db);
    await sql`reset role`.execute(db);
  },
};
