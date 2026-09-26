import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

const authenticatedMutationPrefix = `
      if session_user <> 'memoid_app' then raise exception 'INTEGRITY_CALLER_FORBIDDEN'; end if;
      select s.* into session_row from memoid.auth_sessions s
        join memoid.account_security_states security_state on security_state.account_id=s.account_id
        join memoid.account_identity_bindings binding on binding.id=s.identity_binding_id
        where s.token_hash=p_session_token_hash and s.account_id=memoid.current_account_id()
          and security_state.disabled_at is null and s.revoked_at is null
          and s.security_epoch=security_state.security_epoch and now_at<s.absolute_expires_at
          and now_at<s.idle_expires_at and now_at<s.provider_expires_at
          and binding.state='ACTIVE' and binding.email_verified for update of s,security_state,binding;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      select * into project_row from memoid.projects where workspace_id=memoid.current_workspace_id()
        and id=p_project_id and p_project_id=memoid.current_project_id() for update;
      if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
      if project_row.lifecycle_state<>'ACTIVE' then raise exception 'RESOURCE_UNAVAILABLE'; end if;
      select * into actor_row from memoid.actors where workspace_id=project_row.workspace_id
        and id=memoid.current_actor_id() and actor_kind='HUMAN'
        and actor_reference='account:' || session_row.account_id::text;
      if not found then raise exception 'ACTOR_MISMATCH'; end if;`;

async function tables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.integrity_conflicts (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    context_identity_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint integrity_conflicts_id_v7 check (memoid.is_uuid_v7(id)),
    constraint integrity_conflicts_identity_fk foreign key
      (workspace_id,project_id,context_identity_id)
      references memoid.context_identities(workspace_id,project_id,id),
    constraint integrity_conflicts_semantic_unique unique
      (workspace_id,project_id,context_identity_id),
    constraint integrity_conflicts_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);

  await sql`create table memoid.conflict_occurrences (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    conflict_id uuid not null,
    context_identity_id uuid not null,
    occurrence_version bigint not null,
    lifecycle_state varchar(16) not null,
    classification_key varchar(32) not null,
    participant_set_hash bytea not null,
    ending_reason varchar(40),
    resolved_by_context_revision_id uuid,
    recorded_by_actor_id uuid not null,
    idempotency_record_id uuid not null,
    correlation_id uuid not null,
    causation_id uuid,
    occurred_at timestamptz not null default clock_timestamp(),
    constraint conflict_occurrences_id_v7 check (memoid.is_uuid_v7(id)),
    constraint conflict_occurrences_conflict_fk foreign key
      (workspace_id,project_id,conflict_id)
      references memoid.integrity_conflicts(workspace_id,project_id,id),
    constraint conflict_occurrences_identity_fk foreign key
      (workspace_id,project_id,context_identity_id)
      references memoid.context_identities(workspace_id,project_id,id),
    constraint conflict_occurrences_resolution_fk foreign key
      (workspace_id,project_id,resolved_by_context_revision_id)
      references memoid.context_revisions(workspace_id,project_id,id),
    constraint conflict_occurrences_actor_fk foreign key (workspace_id,recorded_by_actor_id)
      references memoid.actors(workspace_id,id),
    constraint conflict_occurrences_idempotency_fk foreign key
      (workspace_id,project_id,idempotency_record_id)
      references memoid.idempotency_records(workspace_id,project_id,id),
    constraint conflict_occurrences_version check (occurrence_version>0),
    constraint conflict_occurrences_lifecycle check (lifecycle_state in ('ACTIVE','ENDED')),
    constraint conflict_occurrences_classification check
      (classification_key='MATERIAL_CONTRADICTION'),
    constraint conflict_occurrences_hash check (octet_length(participant_set_hash)=32),
    constraint conflict_occurrences_ending_shape check (
      (lifecycle_state='ACTIVE' and ending_reason is null and resolved_by_context_revision_id is null) or
      (lifecycle_state='ENDED' and ending_reason in
        ('INPUTS_NO_LONGER_CONFLICT','PARTICIPANTS_SUPERSEDED','REVIEWED_RESOLUTION') and
        ((ending_reason='REVIEWED_RESOLUTION')=(resolved_by_context_revision_id is not null)))
    ),
    constraint conflict_occurrences_trace check
      (memoid.is_uuid_v7(correlation_id) and
        (causation_id is null or memoid.is_uuid_v7(causation_id))),
    constraint conflict_occurrences_version_unique unique
      (workspace_id,project_id,conflict_id,occurrence_version),
    constraint conflict_occurrences_project_conflict_id_unique unique
      (workspace_id,project_id,conflict_id,id)
  )`.execute(db);

  await sql`create table memoid.conflict_participants (
    workspace_id uuid not null,
    project_id uuid not null,
    conflict_id uuid not null,
    conflict_occurrence_id uuid not null,
    participant_ordinal smallint not null,
    participant_kind varchar(24) not null,
    evidence_reference_id uuid,
    working_context_item_id uuid,
    context_record_id uuid,
    source_id uuid,
    effective_authority_assignment_id uuid,
    source_qualification varchar(32),
    claim_fingerprint bytea not null,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,conflict_occurrence_id,participant_ordinal),
    constraint conflict_participants_occurrence_fk foreign key
      (workspace_id,project_id,conflict_id,conflict_occurrence_id)
      references memoid.conflict_occurrences(workspace_id,project_id,conflict_id,id),
    constraint conflict_participants_evidence_fk foreign key
      (workspace_id,project_id,evidence_reference_id)
      references memoid.evidence_references(workspace_id,project_id,id),
    constraint conflict_participants_working_fk foreign key
      (workspace_id,project_id,working_context_item_id)
      references memoid.working_context_items(workspace_id,project_id,id),
    constraint conflict_participants_context_fk foreign key
      (workspace_id,project_id,context_record_id)
      references memoid.context_records(workspace_id,project_id,id),
    constraint conflict_participants_source_fk foreign key
      (workspace_id,project_id,source_id) references memoid.sources(workspace_id,project_id,id),
    constraint conflict_participants_authority_fk foreign key
      (workspace_id,project_id,effective_authority_assignment_id)
      references memoid.source_authority_assignments(workspace_id,project_id,id),
    constraint conflict_participants_ordinal check (participant_ordinal between 1 and 16),
    constraint conflict_participants_fingerprint check (octet_length(claim_fingerprint)=32),
    constraint conflict_participants_shape check (
      (participant_kind='SOURCE_EVIDENCE' and evidence_reference_id is not null
        and working_context_item_id is null and context_record_id is null and source_id is not null
        and source_qualification is not null) or
      (participant_kind='WORKING_CONTEXT' and evidence_reference_id is null
        and working_context_item_id is not null and context_record_id is null and source_id is null
        and effective_authority_assignment_id is null and source_qualification is null) or
      (participant_kind='REVIEWED_CONTEXT' and evidence_reference_id is null
        and working_context_item_id is null and context_record_id is not null and source_id is null
        and effective_authority_assignment_id is null and source_qualification is null)
    ),
    constraint conflict_participants_source_qualification check
      (source_qualification is null or source_qualification in
        ('AUTHORITATIVE_CURRENT','SHADOWED','MISSING','AMBIGUOUS','SOURCE_UNAVAILABLE',
         'REVALIDATION_REQUIRED','SOURCE_UNOBSERVED','SOURCE_BEHIND'))
  )`.execute(db);

  await sql`create table memoid.conflict_current_states (
    workspace_id uuid not null,
    project_id uuid not null,
    conflict_id uuid not null,
    current_occurrence_id uuid not null,
    occurrence_version bigint not null,
    lifecycle_state varchar(16) not null,
    updated_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,conflict_id),
    constraint conflict_current_conflict_fk foreign key (workspace_id,project_id,conflict_id)
      references memoid.integrity_conflicts(workspace_id,project_id,id),
    constraint conflict_current_occurrence_fk foreign key
      (workspace_id,project_id,conflict_id,current_occurrence_id)
      references memoid.conflict_occurrences(workspace_id,project_id,conflict_id,id),
    constraint conflict_current_version check (occurrence_version>0),
    constraint conflict_current_lifecycle check (lifecycle_state in ('ACTIVE','ENDED'))
  )`.execute(db);

  await sql`create table memoid.integrity_uncertainties (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    context_identity_id uuid not null,
    target_kind varchar(24) not null,
    evidence_reference_id uuid,
    working_context_item_id uuid,
    context_record_id uuid,
    created_at timestamptz not null default clock_timestamp(),
    constraint integrity_uncertainties_id_v7 check (memoid.is_uuid_v7(id)),
    constraint integrity_uncertainties_identity_fk foreign key
      (workspace_id,project_id,context_identity_id)
      references memoid.context_identities(workspace_id,project_id,id),
    constraint integrity_uncertainties_evidence_fk foreign key
      (workspace_id,project_id,evidence_reference_id)
      references memoid.evidence_references(workspace_id,project_id,id),
    constraint integrity_uncertainties_working_fk foreign key
      (workspace_id,project_id,working_context_item_id)
      references memoid.working_context_items(workspace_id,project_id,id),
    constraint integrity_uncertainties_context_fk foreign key
      (workspace_id,project_id,context_record_id)
      references memoid.context_records(workspace_id,project_id,id),
    constraint integrity_uncertainties_target_shape check (
      (target_kind='SEMANTIC_IDENTITY' and evidence_reference_id is null
        and working_context_item_id is null and context_record_id is null) or
      (target_kind='SOURCE_EVIDENCE' and evidence_reference_id is not null
        and working_context_item_id is null and context_record_id is null) or
      (target_kind='WORKING_CONTEXT' and evidence_reference_id is null
        and working_context_item_id is not null and context_record_id is null) or
      (target_kind='REVIEWED_CONTEXT' and evidence_reference_id is null
        and working_context_item_id is null and context_record_id is not null)
    ),
    constraint integrity_uncertainties_project_id_unique unique (workspace_id,project_id,id)
  )`.execute(db);

  await sql`create table memoid.uncertainty_occurrences (
    workspace_id uuid not null,
    project_id uuid not null,
    id uuid primary key default uuidv7(),
    uncertainty_id uuid not null,
    context_identity_id uuid not null,
    occurrence_version bigint not null,
    lifecycle_state varchar(16) not null,
    reason_key varchar(40),
    basis_evidence_reference_id uuid,
    source_qualification varchar(32),
    ending_reason varchar(40),
    resolved_by_context_revision_id uuid,
    recorded_by_actor_id uuid not null,
    idempotency_record_id uuid not null,
    correlation_id uuid not null,
    causation_id uuid,
    occurred_at timestamptz not null default clock_timestamp(),
    constraint uncertainty_occurrences_id_v7 check (memoid.is_uuid_v7(id)),
    constraint uncertainty_occurrences_uncertainty_fk foreign key
      (workspace_id,project_id,uncertainty_id)
      references memoid.integrity_uncertainties(workspace_id,project_id,id),
    constraint uncertainty_occurrences_identity_fk foreign key
      (workspace_id,project_id,context_identity_id)
      references memoid.context_identities(workspace_id,project_id,id),
    constraint uncertainty_occurrences_basis_fk foreign key
      (workspace_id,project_id,basis_evidence_reference_id)
      references memoid.evidence_references(workspace_id,project_id,id),
    constraint uncertainty_occurrences_resolution_fk foreign key
      (workspace_id,project_id,resolved_by_context_revision_id)
      references memoid.context_revisions(workspace_id,project_id,id),
    constraint uncertainty_occurrences_actor_fk foreign key (workspace_id,recorded_by_actor_id)
      references memoid.actors(workspace_id,id),
    constraint uncertainty_occurrences_idempotency_fk foreign key
      (workspace_id,project_id,idempotency_record_id)
      references memoid.idempotency_records(workspace_id,project_id,id),
    constraint uncertainty_occurrences_version check (occurrence_version>0),
    constraint uncertainty_occurrences_lifecycle check (lifecycle_state in ('ACTIVE','ENDED')),
    constraint uncertainty_occurrences_reason check (reason_key is null or reason_key in
      ('INCOMPLETE_EVIDENCE','AMBIGUOUS_INTERPRETATION','WEAK_SUPPORT',
       'UNRESOLVED_SOURCE_QUALIFICATION','WORKING_CONTEXT_AMBIGUITY')),
    constraint uncertainty_occurrences_source_qualification check
      (source_qualification is null or source_qualification in
        ('AUTHORITATIVE_CURRENT','SHADOWED','MISSING','AMBIGUOUS','SOURCE_UNAVAILABLE',
         'REVALIDATION_REQUIRED','SOURCE_UNOBSERVED','SOURCE_BEHIND')),
    constraint uncertainty_occurrences_ending_shape check (
      (lifecycle_state='ACTIVE' and reason_key is not null and ending_reason is null
        and resolved_by_context_revision_id is null) or
      (lifecycle_state='ENDED' and reason_key is not null and ending_reason in
        ('EVIDENCE_STRENGTHENED','INTERPRETATION_CLARIFIED','TARGET_SUPERSEDED','REVIEWED_RESOLUTION')
        and ((ending_reason='REVIEWED_RESOLUTION')=(resolved_by_context_revision_id is not null)))
    ),
    constraint uncertainty_occurrences_trace check
      (memoid.is_uuid_v7(correlation_id) and
        (causation_id is null or memoid.is_uuid_v7(causation_id))),
    constraint uncertainty_occurrences_version_unique unique
      (workspace_id,project_id,uncertainty_id,occurrence_version),
    constraint uncertainty_occurrences_project_uncertainty_id_unique unique
      (workspace_id,project_id,uncertainty_id,id)
  )`.execute(db);

  await sql`create table memoid.uncertainty_current_states (
    workspace_id uuid not null,
    project_id uuid not null,
    uncertainty_id uuid not null,
    current_occurrence_id uuid not null,
    occurrence_version bigint not null,
    lifecycle_state varchar(16) not null,
    updated_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id,project_id,uncertainty_id),
    constraint uncertainty_current_uncertainty_fk foreign key (workspace_id,project_id,uncertainty_id)
      references memoid.integrity_uncertainties(workspace_id,project_id,id),
    constraint uncertainty_current_occurrence_fk foreign key
      (workspace_id,project_id,uncertainty_id,current_occurrence_id)
      references memoid.uncertainty_occurrences(workspace_id,project_id,uncertainty_id,id),
    constraint uncertainty_current_version check (occurrence_version>0),
    constraint uncertainty_current_lifecycle check (lifecycle_state in ('ACTIVE','ENDED'))
  )`.execute(db);
}

async function indexesAndGuards(db: Kysely<unknown>): Promise<void> {
  await sql`create unique index uncertainty_semantic_identity_unique
    on memoid.integrity_uncertainties(workspace_id,project_id,context_identity_id,target_kind)
    where target_kind='SEMANTIC_IDENTITY'`.execute(db);
  await sql`create unique index uncertainty_evidence_unique
    on memoid.integrity_uncertainties(workspace_id,project_id,context_identity_id,target_kind,evidence_reference_id)
    where target_kind='SOURCE_EVIDENCE'`.execute(db);
  await sql`create unique index uncertainty_working_unique
    on memoid.integrity_uncertainties(workspace_id,project_id,context_identity_id,target_kind,working_context_item_id)
    where target_kind='WORKING_CONTEXT'`.execute(db);
  await sql`create unique index uncertainty_reviewed_unique
    on memoid.integrity_uncertainties(workspace_id,project_id,context_identity_id,target_kind,context_record_id)
    where target_kind='REVIEWED_CONTEXT'`.execute(db);
  await sql`create index conflict_current_active_idx on memoid.conflict_current_states
    (workspace_id,project_id,updated_at desc) where lifecycle_state='ACTIVE'`.execute(db);
  await sql`create index uncertainty_current_active_idx on memoid.uncertainty_current_states
    (workspace_id,project_id,updated_at desc) where lifecycle_state='ACTIVE'`.execute(db);
  await sql`create index conflict_participants_evidence_idx on memoid.conflict_participants
    (workspace_id,project_id,evidence_reference_id) where evidence_reference_id is not null`.execute(
    db,
  );

  await sql`create function memoid.guard_integrity_history() returns trigger
    language plpgsql set search_path=pg_catalog,memoid as $$
    begin raise exception 'Integrity history is immutable'; end $$`.execute(db);
  for (const table of [
    "integrity_conflicts",
    "conflict_occurrences",
    "conflict_participants",
    "integrity_uncertainties",
    "uncertainty_occurrences",
  ]) {
    await sql
      .raw(
        `create trigger ${table}_immutable before update or delete on memoid.${table}
      for each row execute function memoid.guard_integrity_history()`,
      )
      .execute(db);
  }
  await sql`create function memoid.guard_integrity_projection() returns trigger
    language plpgsql set search_path=pg_catalog,memoid as $$
    begin
      if new.workspace_id<>old.workspace_id or new.project_id<>old.project_id
        or new.occurrence_version<>old.occurrence_version+1
        or new.updated_at<old.updated_at
      then raise exception 'INVALID_INTEGRITY_PROJECTION_TRANSITION'; end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger conflict_current_monotonic before update on memoid.conflict_current_states
    for each row execute function memoid.guard_integrity_projection()`.execute(db);
  await sql`create trigger uncertainty_current_monotonic before update on memoid.uncertainty_current_states
    for each row execute function memoid.guard_integrity_projection()`.execute(db);
}

async function rls(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "integrity_conflicts",
    "conflict_occurrences",
    "conflict_participants",
    "conflict_current_states",
    "integrity_uncertainties",
    "uncertainty_occurrences",
    "uncertainty_current_states",
  ]) {
    await sql.raw(`alter table memoid.${table} enable row level security`).execute(db);
    await sql.raw(`alter table memoid.${table} force row level security`).execute(db);
    await sql
      .raw(
        `create policy project_scope on memoid.${table}
      using (current_user='memoid_owner' or memoid.has_project_scope(workspace_id,project_id))
      with check (current_user='memoid_owner' or memoid.has_project_scope(workspace_id,project_id))`,
      )
      .execute(db);
  }
}

async function conflictFunction(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.record_conflict_state(
      p_session_token_hash bytea,p_project_id uuid,p_context_identity_id uuid,p_conflict_id uuid,
      p_expected_version bigint,p_lifecycle_state varchar,p_classification_key varchar,
      p_participants jsonb,p_ending_reason varchar,p_resolved_by_context_revision_id uuid,
      p_idempotency_key_hash bytea,p_request_fingerprint bytea,
      p_correlation_id uuid,p_causation_id uuid default null
    ) returns table(conflict_id uuid,occurrence_id uuid,occurrence_version bigint,replayed boolean)
    language plpgsql security definer set search_path=pg_catalog,memoid as $$
    declare session_row memoid.auth_sessions%rowtype; project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype; identity_row memoid.context_identities%rowtype;
      conflict_row memoid.integrity_conflicts%rowtype; current_row memoid.conflict_current_states%rowtype;
      prior_row memoid.conflict_occurrences%rowtype; evidence_row memoid.evidence_references%rowtype;
      working_row memoid.working_context_items%rowtype; reviewed_row memoid.context_records%rowtype;
      authority_resolution record; claim_row record; participant jsonb; snapshot jsonb:='[]'::jsonb;
      participant_kind varchar; reference_id uuid; source_qualification varchar;
      claim_fingerprint bytea; set_hash bytea; new_occurrence_id uuid:=uuidv7();
      new_version bigint; participant_count integer:=0; distinct_claims integer; now_at timestamptz:=clock_timestamp();
    begin
      if p_ending_reason='REVIEWED_RESOLUTION'
        then raise exception 'STAGE10I_REVIEWED_RESOLUTION_REQUIRES_STAGE10M'; end if;
      if octet_length(p_session_token_hash)<>32 or octet_length(p_idempotency_key_hash)<>32
        or octet_length(p_request_fingerprint)<>32 or p_expected_version<0
        or p_lifecycle_state not in ('ACTIVE','ENDED') or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
        or not ((p_lifecycle_state='ACTIVE' and p_context_identity_id is not null and p_conflict_id is null
          and p_classification_key='MATERIAL_CONTRADICTION' and jsonb_typeof(p_participants)='array'
          and p_ending_reason is null and p_resolved_by_context_revision_id is null)
        or (p_lifecycle_state='ENDED' and p_context_identity_id is null and p_conflict_id is not null
          and p_participants is null and p_ending_reason in
            ('INPUTS_NO_LONGER_CONFLICT','PARTICIPANTS_SUPERSEDED','REVIEWED_RESOLUTION')
          and ((p_ending_reason='REVIEWED_RESOLUTION')=(p_resolved_by_context_revision_id is not null))))
      then raise exception 'INVALID_CONFLICT_REQUEST'; end if;
${authenticatedMutationPrefix}
      select * into claim_row from memoid.claim_idempotency(project_row.workspace_id,project_row.id,
        actor_row.id,'CONFLICT_STATE_RECORD',p_idempotency_key_hash,p_request_fingerprint,
        p_correlation_id,p_causation_id,60,now_at+interval '24 hours');
      if claim_row.claim_outcome='CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome='IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome='TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome='REPLAY' then
        select o.conflict_id,o.id,o.occurrence_version into conflict_id,occurrence_id,occurrence_version
          from memoid.conflict_occurrences o where o.workspace_id=project_row.workspace_id
          and o.project_id=project_row.id and o.id=claim_row.stable_result_reference::uuid;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select conflict_id,occurrence_id,occurrence_version,true; return;
      end if;
      if p_lifecycle_state='ACTIVE' then
        select * into identity_row from memoid.context_identities where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=p_context_identity_id for share;
        if not found or identity_row.lifecycle_state<>'ACTIVE' then raise exception 'INVALID_CONFLICT_IDENTITY'; end if;
        for participant in select value from jsonb_array_elements(p_participants) loop
          participant_count:=participant_count+1;
          if participant_count>16 then raise exception 'INVALID_CONFLICT_PARTICIPANTS'; end if;
          participant_kind:=participant->>'kind';
          begin reference_id:=(participant->>'referenceId')::uuid;
          exception when others then raise exception 'INVALID_CONFLICT_PARTICIPANT'; end;
          if participant_kind='SOURCE_EVIDENCE' then
            select * into evidence_row from memoid.evidence_references where workspace_id=project_row.workspace_id
              and project_id=project_row.id and id=reference_id;
            if not found then raise exception 'INVALID_CONFLICT_EVIDENCE'; end if;
            select * into authority_resolution from memoid.resolve_effective_source_authority(
              project_row.workspace_id,project_row.id,identity_row.facet_key,evidence_row.id);
            source_qualification:=case when authority_resolution.qualification='EFFECTIVE'
              and authority_resolution.source_id=evidence_row.source_id then 'AUTHORITATIVE_CURRENT'
              when authority_resolution.qualification='EFFECTIVE' then 'SHADOWED'
              else authority_resolution.qualification end;
            claim_fingerprint:=coalesce(evidence_row.content_sha256,sha256(convert_to(
              evidence_row.evidence_kind || ':' || evidence_row.repository_revision || ':' || evidence_row.repository_path,'UTF8')));
            snapshot:=snapshot||jsonb_build_array(jsonb_build_object('kind',participant_kind,
              'referenceId',reference_id,'sourceId',evidence_row.source_id,
              'authorityAssignmentId',authority_resolution.assignment_id,
              'sourceQualification',source_qualification,'fingerprint',encode(claim_fingerprint,'hex')));
          elsif participant_kind='WORKING_CONTEXT' then
            select * into working_row from memoid.working_context_items where workspace_id=project_row.workspace_id
              and project_id=project_row.id and id=reference_id and context_identity_id=identity_row.id;
            if not found then raise exception 'INVALID_CONFLICT_WORKING_CONTEXT'; end if;
            snapshot:=snapshot||jsonb_build_array(jsonb_build_object('kind',participant_kind,
              'referenceId',reference_id,'fingerprint',encode(working_row.assertion_hash,'hex')));
          elsif participant_kind='REVIEWED_CONTEXT' then
            select * into reviewed_row from memoid.context_records where workspace_id=project_row.workspace_id
              and project_id=project_row.id and id=reference_id and context_identity_id=identity_row.id
              and exists(select 1 from memoid.context_identity_current_records current_record
                where current_record.workspace_id=project_row.workspace_id
                  and current_record.project_id=project_row.id
                  and current_record.context_identity_id=identity_row.id
                  and current_record.context_record_id=reference_id);
            if not found then raise exception 'INVALID_CONFLICT_REVIEWED_CONTEXT'; end if;
            snapshot:=snapshot||jsonb_build_array(jsonb_build_object('kind',participant_kind,
              'referenceId',reference_id,'fingerprint',encode(reviewed_row.assertion_hash,'hex')));
          else raise exception 'INVALID_CONFLICT_PARTICIPANT_KIND'; end if;
        end loop;
        if participant_count<2 then raise exception 'INVALID_CONFLICT_PARTICIPANTS'; end if;
        select count(distinct item->>'fingerprint') into distinct_claims from jsonb_array_elements(snapshot) item;
        if distinct_claims<2 then raise exception 'COMPATIBLE_CONFLICT_PARTICIPANTS'; end if;
        select sha256(convert_to(string_agg(item::text,'|' order by item->>'kind',item->>'referenceId'),'UTF8'))
          into set_hash from jsonb_array_elements(snapshot) item;
        select * into conflict_row from memoid.integrity_conflicts where workspace_id=project_row.workspace_id
          and project_id=project_row.id and context_identity_id=identity_row.id for update;
        if not found then
          if p_expected_version<>0 then raise exception 'STALE_CONFLICT_VERSION'; end if;
          begin
            insert into memoid.integrity_conflicts(workspace_id,project_id,context_identity_id)
              values(project_row.workspace_id,project_row.id,identity_row.id) returning * into conflict_row;
          exception when unique_violation then
            select * into conflict_row from memoid.integrity_conflicts where workspace_id=project_row.workspace_id
              and project_id=project_row.id and context_identity_id=identity_row.id for update;
          end;
        end if;
        select current_state.* into current_row from memoid.conflict_current_states current_state
          where current_state.workspace_id=project_row.workspace_id
          and current_state.project_id=project_row.id and current_state.conflict_id=conflict_row.id for update;
        if found then
          if current_row.occurrence_version<>p_expected_version then raise exception 'STALE_CONFLICT_VERSION'; end if;
          select * into prior_row from memoid.conflict_occurrences where workspace_id=project_row.workspace_id
            and project_id=project_row.id and id=current_row.current_occurrence_id;
          if current_row.lifecycle_state='ACTIVE' and prior_row.participant_set_hash=set_hash
            then raise exception 'UNCHANGED_CONFLICT_OCCURRENCE'; end if;
        elsif p_expected_version<>0 then raise exception 'STALE_CONFLICT_VERSION'; end if;
        new_version:=p_expected_version+1;
      else
        select * into conflict_row from memoid.integrity_conflicts where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=p_conflict_id for update;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        select * into identity_row from memoid.context_identities where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=conflict_row.context_identity_id for share;
        select current_state.* into current_row from memoid.conflict_current_states current_state
          where current_state.workspace_id=project_row.workspace_id
          and current_state.project_id=project_row.id and current_state.conflict_id=conflict_row.id for update;
        if not found or current_row.occurrence_version<>p_expected_version
          then raise exception 'STALE_CONFLICT_VERSION'; end if;
        if current_row.lifecycle_state<>'ACTIVE' then raise exception 'CONFLICT_ALREADY_ENDED'; end if;
        select * into prior_row from memoid.conflict_occurrences where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=current_row.current_occurrence_id;
        if p_resolved_by_context_revision_id is not null and not exists(
          select 1 from memoid.context_records r where r.workspace_id=project_row.workspace_id
            and r.project_id=project_row.id and r.context_identity_id=identity_row.id
            and r.context_revision_id=p_resolved_by_context_revision_id)
        then raise exception 'INVALID_CONFLICT_RESOLUTION_REVISION'; end if;
        set_hash:=prior_row.participant_set_hash; p_classification_key:=prior_row.classification_key;
        new_version:=p_expected_version+1;
      end if;
      insert into memoid.conflict_occurrences(workspace_id,project_id,id,conflict_id,context_identity_id,
        occurrence_version,lifecycle_state,classification_key,participant_set_hash,ending_reason,
        resolved_by_context_revision_id,recorded_by_actor_id,idempotency_record_id,correlation_id,causation_id,occurred_at)
        values(project_row.workspace_id,project_row.id,new_occurrence_id,conflict_row.id,identity_row.id,
        new_version,p_lifecycle_state,p_classification_key,set_hash,p_ending_reason,
        p_resolved_by_context_revision_id,actor_row.id,claim_row.idempotency_record_id,p_correlation_id,p_causation_id,now_at);
      if p_lifecycle_state='ACTIVE' then
        participant_count:=0;
        for participant in select value from jsonb_array_elements(snapshot) loop
          participant_count:=participant_count+1; participant_kind:=participant->>'kind';
          reference_id:=(participant->>'referenceId')::uuid;
          insert into memoid.conflict_participants(workspace_id,project_id,conflict_id,
            conflict_occurrence_id,participant_ordinal,participant_kind,evidence_reference_id,
            working_context_item_id,context_record_id,source_id,effective_authority_assignment_id,
            source_qualification,claim_fingerprint)
          values(project_row.workspace_id,project_row.id,conflict_row.id,new_occurrence_id,
            participant_count,participant_kind,
            case when participant_kind='SOURCE_EVIDENCE' then reference_id end,
            case when participant_kind='WORKING_CONTEXT' then reference_id end,
            case when participant_kind='REVIEWED_CONTEXT' then reference_id end,
            (participant->>'sourceId')::uuid,(participant->>'authorityAssignmentId')::uuid,
            participant->>'sourceQualification',decode(participant->>'fingerprint','hex'));
        end loop;
      else
        insert into memoid.conflict_participants(workspace_id,project_id,conflict_id,
          conflict_occurrence_id,participant_ordinal,participant_kind,evidence_reference_id,
          working_context_item_id,context_record_id,source_id,effective_authority_assignment_id,
          source_qualification,claim_fingerprint)
        select prior_participant.workspace_id,prior_participant.project_id,prior_participant.conflict_id,
          new_occurrence_id,prior_participant.participant_ordinal,prior_participant.participant_kind,
          prior_participant.evidence_reference_id,prior_participant.working_context_item_id,
          prior_participant.context_record_id,prior_participant.source_id,
          prior_participant.effective_authority_assignment_id,prior_participant.source_qualification,
          prior_participant.claim_fingerprint from memoid.conflict_participants prior_participant
        where prior_participant.workspace_id=project_row.workspace_id
          and prior_participant.project_id=project_row.id
          and prior_participant.conflict_occurrence_id=current_row.current_occurrence_id;
      end if;
      insert into memoid.conflict_current_states(workspace_id,project_id,conflict_id,current_occurrence_id,
        occurrence_version,lifecycle_state,updated_at) values(project_row.workspace_id,project_row.id,
        conflict_row.id,new_occurrence_id,new_version,p_lifecycle_state,now_at)
      on conflict on constraint conflict_current_states_pkey do update set
        current_occurrence_id=excluded.current_occurrence_id,occurrence_version=excluded.occurrence_version,
        lifecycle_state=excluded.lifecycle_state,updated_at=excluded.updated_at;
      insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,
        target_type,target_key,correlation_id,causation_id,idempotency_record_id,outcome,metadata)
      values(project_row.workspace_id,project_row.id,actor_row.id,'DATA_INTEGRITY',
        case when p_lifecycle_state='ACTIVE' then 'CONFLICT_RECORDED' else 'CONFLICT_ENDED' end,
        now_at,'CONFLICT',conflict_row.id::text,p_correlation_id,p_causation_id,
        claim_row.idempotency_record_id,'SUCCESS',jsonb_build_object('VERSION',new_version,
          'LIFECYCLE_STATE',p_lifecycle_state,'PARTICIPANT_COUNT',participant_count));
      perform memoid.finish_idempotency(project_row.workspace_id,project_row.id,claim_row.idempotency_record_id,
        claim_row.active_claim_token,'COMPLETED','CONFLICT_OCCURRENCE',new_occurrence_id::text,null,
        sha256(convert_to(new_occurrence_id::text,'UTF8')),200,jsonb_build_object('REPLAYABLE',true),null,null);
      return query select conflict_row.id,new_occurrence_id,new_version,false;
    end $$`,
    )
    .execute(db);
}

async function uncertaintyFunction(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create function memoid.record_uncertainty_state(
      p_session_token_hash bytea,p_project_id uuid,p_context_identity_id uuid,p_uncertainty_id uuid,
      p_expected_version bigint,p_lifecycle_state varchar,p_target_kind varchar,p_target_reference_id uuid,
      p_reason_key varchar,p_basis_evidence_reference_id uuid,p_ending_reason varchar,
      p_resolved_by_context_revision_id uuid,p_idempotency_key_hash bytea,p_request_fingerprint bytea,
      p_correlation_id uuid,p_causation_id uuid default null
    ) returns table(uncertainty_id uuid,occurrence_id uuid,occurrence_version bigint,replayed boolean)
    language plpgsql security definer set search_path=pg_catalog,memoid as $$
    declare session_row memoid.auth_sessions%rowtype; project_row memoid.projects%rowtype;
      actor_row memoid.actors%rowtype; identity_row memoid.context_identities%rowtype;
      uncertainty_row memoid.integrity_uncertainties%rowtype;
      current_row memoid.uncertainty_current_states%rowtype; prior_row memoid.uncertainty_occurrences%rowtype;
      evidence_row memoid.evidence_references%rowtype; authority_resolution record; claim_row record;
      source_qualification varchar; new_occurrence_id uuid:=uuidv7(); new_version bigint;
      now_at timestamptz:=clock_timestamp();
    begin
      if p_ending_reason='REVIEWED_RESOLUTION'
        then raise exception 'STAGE10I_REVIEWED_RESOLUTION_REQUIRES_STAGE10M'; end if;
      if octet_length(p_session_token_hash)<>32 or octet_length(p_idempotency_key_hash)<>32
        or octet_length(p_request_fingerprint)<>32 or p_expected_version<0
        or p_lifecycle_state not in ('ACTIVE','ENDED') or not memoid.is_uuid_v7(p_correlation_id)
        or (p_causation_id is not null and not memoid.is_uuid_v7(p_causation_id))
        or not ((p_lifecycle_state='ACTIVE' and p_context_identity_id is not null and p_uncertainty_id is null
          and p_target_kind in ('SEMANTIC_IDENTITY','SOURCE_EVIDENCE','WORKING_CONTEXT','REVIEWED_CONTEXT')
          and p_target_reference_id is not null and p_reason_key in
            ('INCOMPLETE_EVIDENCE','AMBIGUOUS_INTERPRETATION','WEAK_SUPPORT',
             'UNRESOLVED_SOURCE_QUALIFICATION','WORKING_CONTEXT_AMBIGUITY')
          and p_ending_reason is null and p_resolved_by_context_revision_id is null)
        or (p_lifecycle_state='ENDED' and p_context_identity_id is null and p_uncertainty_id is not null
          and p_target_kind is null and p_target_reference_id is null and p_reason_key is null
          and p_basis_evidence_reference_id is null and p_ending_reason in
            ('EVIDENCE_STRENGTHENED','INTERPRETATION_CLARIFIED','TARGET_SUPERSEDED','REVIEWED_RESOLUTION')
          and ((p_ending_reason='REVIEWED_RESOLUTION')=(p_resolved_by_context_revision_id is not null))))
      then raise exception 'INVALID_UNCERTAINTY_REQUEST'; end if;
${authenticatedMutationPrefix}
      select * into claim_row from memoid.claim_idempotency(project_row.workspace_id,project_row.id,
        actor_row.id,'UNCERTAINTY_STATE_RECORD',p_idempotency_key_hash,p_request_fingerprint,
        p_correlation_id,p_causation_id,60,now_at+interval '24 hours');
      if claim_row.claim_outcome='CONFLICT' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if claim_row.claim_outcome='IN_PROGRESS' then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;
      if claim_row.claim_outcome='TERMINAL_FAILURE' then raise exception 'IDEMPOTENCY_TERMINAL_FAILURE'; end if;
      if claim_row.claim_outcome='REPLAY' then
        select o.uncertainty_id,o.id,o.occurrence_version into uncertainty_id,occurrence_id,occurrence_version
          from memoid.uncertainty_occurrences o where o.workspace_id=project_row.workspace_id
          and o.project_id=project_row.id and o.id=claim_row.stable_result_reference::uuid;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        return query select uncertainty_id,occurrence_id,occurrence_version,true; return;
      end if;
      if p_lifecycle_state='ACTIVE' then
        select * into identity_row from memoid.context_identities where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=p_context_identity_id for share;
        if not found or identity_row.lifecycle_state<>'ACTIVE' then raise exception 'INVALID_UNCERTAINTY_IDENTITY'; end if;
        if p_target_kind='SEMANTIC_IDENTITY' and p_target_reference_id<>identity_row.id
          then raise exception 'INVALID_UNCERTAINTY_TARGET';
        elsif p_target_kind='SOURCE_EVIDENCE' and not exists(select 1 from memoid.evidence_references
          where workspace_id=project_row.workspace_id and project_id=project_row.id and id=p_target_reference_id)
          then raise exception 'INVALID_UNCERTAINTY_TARGET';
        elsif p_target_kind='WORKING_CONTEXT' and not exists(select 1 from memoid.working_context_items
          where workspace_id=project_row.workspace_id and project_id=project_row.id
            and id=p_target_reference_id and context_identity_id=identity_row.id)
          then raise exception 'INVALID_UNCERTAINTY_TARGET';
        elsif p_target_kind='REVIEWED_CONTEXT' and not exists(select 1 from memoid.context_records
          where workspace_id=project_row.workspace_id and project_id=project_row.id
            and id=p_target_reference_id and context_identity_id=identity_row.id
            and exists(select 1 from memoid.context_identity_current_records current_record
              where current_record.workspace_id=project_row.workspace_id
                and current_record.project_id=project_row.id
                and current_record.context_identity_id=identity_row.id
                and current_record.context_record_id=p_target_reference_id))
          then raise exception 'INVALID_UNCERTAINTY_TARGET'; end if;
        if p_target_kind='SOURCE_EVIDENCE' and p_basis_evidence_reference_id is null
          then p_basis_evidence_reference_id:=p_target_reference_id; end if;
        if p_basis_evidence_reference_id is not null then
          select * into evidence_row from memoid.evidence_references where workspace_id=project_row.workspace_id
            and project_id=project_row.id and id=p_basis_evidence_reference_id;
          if not found then raise exception 'INVALID_UNCERTAINTY_EVIDENCE'; end if;
          select * into authority_resolution from memoid.resolve_effective_source_authority(
            project_row.workspace_id,project_row.id,identity_row.facet_key,evidence_row.id);
          source_qualification:=case when authority_resolution.qualification='EFFECTIVE'
            and authority_resolution.source_id=evidence_row.source_id then 'AUTHORITATIVE_CURRENT'
            when authority_resolution.qualification='EFFECTIVE' then 'SHADOWED'
            else authority_resolution.qualification end;
        end if;
        select * into uncertainty_row from memoid.integrity_uncertainties
          where workspace_id=project_row.workspace_id and project_id=project_row.id
          and context_identity_id=identity_row.id and target_kind=p_target_kind
          and evidence_reference_id is not distinct from case when p_target_kind='SOURCE_EVIDENCE' then p_target_reference_id end
          and working_context_item_id is not distinct from case when p_target_kind='WORKING_CONTEXT' then p_target_reference_id end
          and context_record_id is not distinct from case when p_target_kind='REVIEWED_CONTEXT' then p_target_reference_id end
          for update;
        if not found then
          if p_expected_version<>0 then raise exception 'STALE_UNCERTAINTY_VERSION'; end if;
          begin
            insert into memoid.integrity_uncertainties(workspace_id,project_id,context_identity_id,target_kind,
              evidence_reference_id,working_context_item_id,context_record_id)
            values(project_row.workspace_id,project_row.id,identity_row.id,p_target_kind,
              case when p_target_kind='SOURCE_EVIDENCE' then p_target_reference_id end,
              case when p_target_kind='WORKING_CONTEXT' then p_target_reference_id end,
              case when p_target_kind='REVIEWED_CONTEXT' then p_target_reference_id end)
            returning * into uncertainty_row;
          exception when unique_violation then raise exception 'STALE_UNCERTAINTY_VERSION'; end;
        end if;
        select current_state.* into current_row from memoid.uncertainty_current_states current_state
          where current_state.workspace_id=project_row.workspace_id
          and current_state.project_id=project_row.id
          and current_state.uncertainty_id=uncertainty_row.id for update;
        if found then
          if current_row.occurrence_version<>p_expected_version then raise exception 'STALE_UNCERTAINTY_VERSION'; end if;
          select * into prior_row from memoid.uncertainty_occurrences where workspace_id=project_row.workspace_id
            and project_id=project_row.id and id=current_row.current_occurrence_id;
          if current_row.lifecycle_state='ACTIVE' and prior_row.reason_key=p_reason_key
            and prior_row.basis_evidence_reference_id is not distinct from p_basis_evidence_reference_id
            and prior_row.source_qualification is not distinct from source_qualification
          then raise exception 'UNCHANGED_UNCERTAINTY_OCCURRENCE'; end if;
        elsif p_expected_version<>0 then raise exception 'STALE_UNCERTAINTY_VERSION'; end if;
        new_version:=p_expected_version+1;
      else
        select * into uncertainty_row from memoid.integrity_uncertainties where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=p_uncertainty_id for update;
        if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
        select * into identity_row from memoid.context_identities where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=uncertainty_row.context_identity_id for share;
        select current_state.* into current_row from memoid.uncertainty_current_states current_state
          where current_state.workspace_id=project_row.workspace_id
          and current_state.project_id=project_row.id
          and current_state.uncertainty_id=uncertainty_row.id for update;
        if not found or current_row.occurrence_version<>p_expected_version
          then raise exception 'STALE_UNCERTAINTY_VERSION'; end if;
        if current_row.lifecycle_state<>'ACTIVE' then raise exception 'UNCERTAINTY_ALREADY_ENDED'; end if;
        select * into prior_row from memoid.uncertainty_occurrences where workspace_id=project_row.workspace_id
          and project_id=project_row.id and id=current_row.current_occurrence_id;
        if p_resolved_by_context_revision_id is not null and not exists(
          select 1 from memoid.context_records r where r.workspace_id=project_row.workspace_id
            and r.project_id=project_row.id and r.context_identity_id=identity_row.id
            and r.context_revision_id=p_resolved_by_context_revision_id)
        then raise exception 'INVALID_UNCERTAINTY_RESOLUTION_REVISION'; end if;
        p_reason_key:=prior_row.reason_key; p_basis_evidence_reference_id:=prior_row.basis_evidence_reference_id;
        source_qualification:=prior_row.source_qualification; new_version:=p_expected_version+1;
      end if;
      insert into memoid.uncertainty_occurrences(workspace_id,project_id,id,uncertainty_id,
        context_identity_id,occurrence_version,lifecycle_state,reason_key,basis_evidence_reference_id,
        source_qualification,ending_reason,resolved_by_context_revision_id,recorded_by_actor_id,
        idempotency_record_id,correlation_id,causation_id,occurred_at)
      values(project_row.workspace_id,project_row.id,new_occurrence_id,uncertainty_row.id,identity_row.id,
        new_version,p_lifecycle_state,p_reason_key,p_basis_evidence_reference_id,source_qualification,
        p_ending_reason,p_resolved_by_context_revision_id,actor_row.id,claim_row.idempotency_record_id,
        p_correlation_id,p_causation_id,now_at);
      insert into memoid.uncertainty_current_states(workspace_id,project_id,uncertainty_id,
        current_occurrence_id,occurrence_version,lifecycle_state,updated_at)
      values(project_row.workspace_id,project_row.id,uncertainty_row.id,new_occurrence_id,new_version,
        p_lifecycle_state,now_at) on conflict on constraint uncertainty_current_states_pkey do update set
        current_occurrence_id=excluded.current_occurrence_id,occurrence_version=excluded.occurrence_version,
        lifecycle_state=excluded.lifecycle_state,updated_at=excluded.updated_at;
      insert into memoid.audit_events(workspace_id,project_id,actor_id,category,event_type,occurred_at,
        target_type,target_key,correlation_id,causation_id,idempotency_record_id,outcome,metadata)
      values(project_row.workspace_id,project_row.id,actor_row.id,'DATA_INTEGRITY',
        case when p_lifecycle_state='ACTIVE' then 'UNCERTAINTY_RECORDED' else 'UNCERTAINTY_ENDED' end,
        now_at,'UNCERTAINTY',uncertainty_row.id::text,p_correlation_id,p_causation_id,
        claim_row.idempotency_record_id,'SUCCESS',jsonb_build_object('VERSION',new_version,
          'LIFECYCLE_STATE',p_lifecycle_state,'REASON_KEY',p_reason_key));
      perform memoid.finish_idempotency(project_row.workspace_id,project_row.id,claim_row.idempotency_record_id,
        claim_row.active_claim_token,'COMPLETED','UNCERTAINTY_OCCURRENCE',new_occurrence_id::text,null,
        sha256(convert_to(new_occurrence_id::text,'UTF8')),200,jsonb_build_object('REPLAYABLE',true),null,null);
      return query select uncertainty_row.id,new_occurrence_id,new_version,false;
    end $$`,
    )
    .execute(db);
}

async function permissions(db: Kysely<unknown>): Promise<void> {
  await sql`revoke all on memoid.integrity_conflicts,memoid.conflict_occurrences,
    memoid.conflict_participants,memoid.conflict_current_states,memoid.integrity_uncertainties,
    memoid.uncertainty_occurrences,memoid.uncertainty_current_states
    from public,memoid_app,memoid_auth,memoid_provider`.execute(db);
  await sql`grant select on memoid.integrity_conflicts,memoid.conflict_occurrences,
    memoid.conflict_participants,memoid.conflict_current_states,memoid.integrity_uncertainties,
    memoid.uncertainty_occurrences,memoid.uncertainty_current_states to memoid_app`.execute(db);
  await sql`revoke all on function memoid.guard_integrity_history(),memoid.guard_integrity_projection(),
    memoid.record_conflict_state(bytea,uuid,uuid,uuid,bigint,varchar,varchar,jsonb,varchar,uuid,bytea,bytea,uuid,uuid),
    memoid.record_uncertainty_state(bytea,uuid,uuid,uuid,bigint,varchar,varchar,uuid,varchar,uuid,varchar,uuid,bytea,bytea,uuid,uuid)
    from public,memoid_app,memoid_auth,memoid_provider`.execute(db);
  await sql`grant execute on function
    memoid.record_conflict_state(bytea,uuid,uuid,uuid,bigint,varchar,varchar,jsonb,varchar,uuid,bytea,bytea,uuid,uuid),
    memoid.record_uncertainty_state(bytea,uuid,uuid,uuid,bigint,varchar,varchar,uuid,varchar,uuid,varchar,uuid,bytea,bytea,uuid,uuid)
    to memoid_app`.execute(db);
}

export const stage10iConflictUncertaintyMigration: Migration = {
  async up(db) {
    await sql`set local role memoid_owner`.execute(db);
    await tables(db);
    await indexesAndGuards(db);
    await rls(db);
    await conflictFunction(db);
    await uncertaintyFunction(db);
    await permissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`set local role memoid_owner`.execute(db);
    await sql`do $$ begin
      if exists(select 1 from memoid.conflict_occurrences)
        or exists(select 1 from memoid.uncertainty_occurrences)
      then raise exception 'STAGE10I_ROLLBACK_REFUSED_POPULATED_INTEGRITY_HISTORY'; end if;
      if exists(select 1 from memoid.context_record_origins)
        or exists(select 1 from memoid.context_record_evidence_provenance)
        or exists(select 1 from memoid.context_identity_endings)
      then raise exception 'STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY'; end if;
    end $$`.execute(db);
    await sql`drop function if exists memoid.record_uncertainty_state(bytea,uuid,uuid,uuid,bigint,varchar,varchar,uuid,varchar,uuid,varchar,uuid,bytea,bytea,uuid,uuid)`.execute(
      db,
    );
    await sql`drop function if exists memoid.record_conflict_state(bytea,uuid,uuid,uuid,bigint,varchar,varchar,jsonb,varchar,uuid,bytea,bytea,uuid,uuid)`.execute(
      db,
    );
    await sql`drop table if exists memoid.uncertainty_current_states`.execute(db);
    await sql`drop table if exists memoid.uncertainty_occurrences`.execute(db);
    await sql`drop table if exists memoid.integrity_uncertainties`.execute(db);
    await sql`drop table if exists memoid.conflict_current_states`.execute(db);
    await sql`drop table if exists memoid.conflict_participants`.execute(db);
    await sql`drop table if exists memoid.conflict_occurrences`.execute(db);
    await sql`drop table if exists memoid.integrity_conflicts`.execute(db);
    await sql`drop function if exists memoid.guard_integrity_projection()`.execute(db);
    await sql`drop function if exists memoid.guard_integrity_history()`.execute(db);
    await sql`reset role`.execute(db);
  },
};
