import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

async function createTables(db: Kysely<unknown>): Promise<void> {
  await sql`create table memoid.accounts (
    id uuid primary key default uuidv7(),
    created_at timestamptz not null default clock_timestamp(),
    constraint accounts_id_v7 check (memoid.is_uuid_v7(id))
  )`.execute(db);

  await sql`create table memoid.workspaces (
    id uuid primary key default uuidv7(),
    account_id uuid not null references memoid.accounts(id),
    created_at timestamptz not null default clock_timestamp(),
    constraint workspaces_id_v7 check (memoid.is_uuid_v7(id)),
    constraint workspaces_one_personal_per_account unique (account_id),
    constraint workspaces_id_account_unique unique (id, account_id)
  )`.execute(db);

  await sql`create table memoid.projects (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null references memoid.workspaces(id),
    created_at timestamptz not null default clock_timestamp(),
    constraint projects_id_v7 check (memoid.is_uuid_v7(id)),
    constraint projects_workspace_id_unique unique (workspace_id, id)
  )`.execute(db);

  await sql`create table memoid.project_review_policy_versions (
    workspace_id uuid not null,
    project_id uuid not null,
    version bigint not null,
    policy varchar(16) not null,
    effective_at timestamptz not null,
    recorded_at timestamptz not null default clock_timestamp(),
    changed_by_account_id uuid not null,
    primary key (workspace_id, project_id, version),
    constraint review_policy_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint review_policy_workspace_actor_fk foreign key (workspace_id, changed_by_account_id)
      references memoid.workspaces(id, account_id),
    constraint review_policy_version_positive check (version > 0),
    constraint review_policy_value check (policy in ('MANUAL', 'AUTOMATIC'))
  )`.execute(db);

  await sql`create table memoid.sources (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    source_kind varchar(64) not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint sources_id_v7 check (memoid.is_uuid_v7(id)),
    constraint sources_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint sources_kind_key check (source_kind ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint sources_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.source_frontier_units (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    source_id uuid not null,
    scope_key varchar(256) not null,
    ref_key varchar(512) not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint source_frontier_units_id_v7 check (memoid.is_uuid_v7(id)),
    constraint source_frontier_units_source_fk foreign key (workspace_id, project_id, source_id)
      references memoid.sources(workspace_id, project_id, id),
    constraint source_frontier_units_scope_key check (length(scope_key) > 0 and btrim(scope_key) = scope_key),
    constraint source_frontier_units_ref_key check (length(ref_key) > 0 and btrim(ref_key) = ref_key),
    constraint source_frontier_units_identity_unique unique (workspace_id, project_id, source_id, scope_key, ref_key),
    constraint source_frontier_units_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.source_observations (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    frontier_unit_id uuid not null,
    observation_sequence bigint not null,
    external_revision varchar(512) not null,
    observed_at timestamptz not null,
    effective_at timestamptz,
    payload_hash bytea,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default clock_timestamp(),
    constraint source_observations_id_v7 check (memoid.is_uuid_v7(id)),
    constraint source_observations_unit_fk foreign key (workspace_id, project_id, frontier_unit_id)
      references memoid.source_frontier_units(workspace_id, project_id, id),
    constraint source_observations_sequence_positive check (observation_sequence > 0),
    constraint source_observations_external_revision check (length(external_revision) > 0 and btrim(external_revision) = external_revision),
    constraint source_observations_payload_hash check (payload_hash is null or octet_length(payload_hash) = 32),
    constraint source_observations_metadata_object check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384),
    constraint source_observations_unit_sequence_unique unique (workspace_id, project_id, frontier_unit_id, observation_sequence),
    constraint source_observations_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.source_frontier_states (
    workspace_id uuid not null,
    project_id uuid not null,
    frontier_unit_id uuid not null,
    observed_sequence bigint,
    desired_sequence bigint,
    ingested_sequence bigint,
    reconciled_sequence bigint,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, frontier_unit_id),
    constraint source_frontier_state_unit_fk foreign key (workspace_id, project_id, frontier_unit_id)
      references memoid.source_frontier_units(workspace_id, project_id, id),
    constraint source_frontier_observed_fk foreign key (workspace_id, project_id, frontier_unit_id, observed_sequence)
      references memoid.source_observations(workspace_id, project_id, frontier_unit_id, observation_sequence) deferrable initially deferred,
    constraint source_frontier_desired_fk foreign key (workspace_id, project_id, frontier_unit_id, desired_sequence)
      references memoid.source_observations(workspace_id, project_id, frontier_unit_id, observation_sequence) deferrable initially deferred,
    constraint source_frontier_ingested_fk foreign key (workspace_id, project_id, frontier_unit_id, ingested_sequence)
      references memoid.source_observations(workspace_id, project_id, frontier_unit_id, observation_sequence) deferrable initially deferred,
    constraint source_frontier_reconciled_fk foreign key (workspace_id, project_id, frontier_unit_id, reconciled_sequence)
      references memoid.source_observations(workspace_id, project_id, frontier_unit_id, observation_sequence) deferrable initially deferred,
    constraint source_frontier_positive check (
      (observed_sequence is null or observed_sequence > 0) and
      (desired_sequence is null or desired_sequence > 0) and
      (ingested_sequence is null or ingested_sequence > 0) and
      (reconciled_sequence is null or reconciled_sequence > 0)
    ),
    constraint source_frontier_order check (
      (desired_sequence is null or (observed_sequence is not null and desired_sequence <= observed_sequence)) and
      (ingested_sequence is null or (desired_sequence is not null and ingested_sequence <= desired_sequence)) and
      (reconciled_sequence is null or (ingested_sequence is not null and reconciled_sequence <= ingested_sequence))
    )
  )`.execute(db);

  await sql`create table memoid.candidate_frontier_states (
    workspace_id uuid not null,
    project_id uuid not null,
    last_accepted_sequence bigint not null default 0,
    reconciled_through_sequence bigint not null default 0,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id),
    constraint candidate_frontier_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint candidate_frontier_nonnegative check (last_accepted_sequence >= 0 and reconciled_through_sequence >= 0),
    constraint candidate_frontier_order check (reconciled_through_sequence <= last_accepted_sequence)
  )`.execute(db);

  await sql`create table memoid.candidate_submissions (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    submission_sequence bigint not null,
    submitted_at timestamptz not null,
    accepted_at timestamptz not null default clock_timestamp(),
    payload_hash bytea not null,
    base_context_revision_sequence bigint,
    source_frontier_basis jsonb not null default '[]'::jsonb,
    constraint candidate_submissions_id_v7 check (memoid.is_uuid_v7(id)),
    constraint candidate_submissions_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint candidate_submissions_sequence_positive check (submission_sequence > 0),
    constraint candidate_submissions_payload_hash check (octet_length(payload_hash) = 32),
    constraint candidate_submissions_base_revision check (base_context_revision_sequence is null or base_context_revision_sequence > 0),
    constraint candidate_submissions_source_basis check (jsonb_typeof(source_frontier_basis) = 'array' and octet_length(source_frontier_basis::text) <= 16384),
    constraint candidate_submissions_project_sequence_unique unique (workspace_id, project_id, submission_sequence),
    constraint candidate_submissions_project_id_unique unique (workspace_id, project_id, id),
    constraint candidate_submissions_project_sequence_id_unique unique (workspace_id, project_id, submission_sequence, id)
  )`.execute(db);

  await sql`create table memoid.candidate_assertions (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    candidate_submission_id uuid not null,
    assertion_ordinal integer not null,
    origin_kind varchar(32) not null,
    confirmation_kind varchar(32) not null default 'NONE',
    confirmed_by_account_id uuid,
    confirmed_at timestamptz,
    assertion_payload jsonb not null,
    assertion_hash bytea not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint candidate_assertions_id_v7 check (memoid.is_uuid_v7(id)),
    constraint candidate_assertions_submission_fk foreign key (workspace_id, project_id, candidate_submission_id)
      references memoid.candidate_submissions(workspace_id, project_id, id),
    constraint candidate_assertions_confirmation_account_fk foreign key (workspace_id, confirmed_by_account_id)
      references memoid.workspaces(id, account_id),
    constraint candidate_assertions_ordinal_positive check (assertion_ordinal > 0),
    constraint candidate_assertions_origin check (origin_kind in ('USER_AUTHORED', 'AI_INFERRED', 'SOURCE_DERIVED', 'SYSTEM_DERIVED')),
    constraint candidate_assertions_confirmation check (confirmation_kind in ('NONE', 'EXPLICIT_USER')),
    constraint candidate_assertions_confirmation_basis check (
      (confirmation_kind = 'NONE' and confirmed_by_account_id is null and confirmed_at is null) or
      (confirmation_kind = 'EXPLICIT_USER' and confirmed_by_account_id is not null and confirmed_at is not null)
    ),
    constraint candidate_assertions_payload check (jsonb_typeof(assertion_payload) = 'object' and octet_length(assertion_payload::text) <= 65536),
    constraint candidate_assertions_hash check (octet_length(assertion_hash) = 32),
    constraint candidate_assertions_submission_ordinal_unique unique (workspace_id, project_id, candidate_submission_id, assertion_ordinal),
    constraint candidate_assertions_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.candidate_stable_dispositions (
    workspace_id uuid not null,
    project_id uuid not null,
    submission_sequence bigint not null,
    candidate_submission_id uuid not null,
    disposition_key varchar(64) not null,
    stable_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, submission_sequence),
    constraint candidate_stable_disposition_submission_fk foreign key (workspace_id, project_id, submission_sequence, candidate_submission_id)
      references memoid.candidate_submissions(workspace_id, project_id, submission_sequence, id),
    constraint candidate_stable_disposition_key check (disposition_key ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    constraint candidate_stable_disposition_candidate_unique unique (workspace_id, project_id, candidate_submission_id)
  )`.execute(db);

  await sql`create table memoid.context_identities (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    subject_key varchar(256) not null,
    scope_key varchar(256) not null,
    facet_key varchar(128) not null,
    predicate_key varchar(128) not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint context_identities_id_v7 check (memoid.is_uuid_v7(id)),
    constraint context_identities_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint context_identities_subject_key check (subject_key ~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'),
    constraint context_identities_scope_key check (scope_key ~ '^[a-z0-9][a-z0-9._:/-]{0,255}$'),
    constraint context_identities_facet_key check (facet_key ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
    constraint context_identities_predicate_key check (predicate_key ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
    constraint context_identities_semantic_unique unique (workspace_id, project_id, subject_key, scope_key, facet_key, predicate_key),
    constraint context_identities_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.working_context_items (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    context_identity_id uuid,
    candidate_assertion_id uuid not null,
    trust_qualification varchar(32) not null,
    assertion_payload jsonb not null,
    assertion_hash bytea not null,
    governing_review_policy_version bigint,
    recorded_at timestamptz not null default clock_timestamp(),
    reconciled_at timestamptz,
    constraint working_context_items_id_v7 check (memoid.is_uuid_v7(id)),
    constraint working_context_items_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint working_context_items_identity_fk foreign key (workspace_id, project_id, context_identity_id)
      references memoid.context_identities(workspace_id, project_id, id),
    constraint working_context_items_candidate_fk foreign key (workspace_id, project_id, candidate_assertion_id)
      references memoid.candidate_assertions(workspace_id, project_id, id),
    constraint working_context_items_policy_fk foreign key (workspace_id, project_id, governing_review_policy_version)
      references memoid.project_review_policy_versions(workspace_id, project_id, version),
    constraint working_context_items_trust check (trust_qualification in ('PENDING_UNRECONCILED', 'RECONCILED_UNREVIEWED')),
    constraint working_context_items_reconciled_time check (
      (trust_qualification = 'PENDING_UNRECONCILED' and reconciled_at is null) or
      (trust_qualification = 'RECONCILED_UNREVIEWED' and reconciled_at is not null and reconciled_at >= recorded_at)
    ),
    constraint working_context_items_payload check (jsonb_typeof(assertion_payload) = 'object' and octet_length(assertion_payload::text) <= 65536),
    constraint working_context_items_hash check (octet_length(assertion_hash) = 32),
    constraint working_context_items_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.context_revisions (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    revision_sequence bigint not null,
    review_policy_version bigint not null,
    decision_mode varchar(16) not null,
    applied_by_account_id uuid,
    applied_at timestamptz not null default clock_timestamp(),
    constraint context_revisions_id_v7 check (memoid.is_uuid_v7(id)),
    constraint context_revisions_project_fk foreign key (workspace_id, project_id)
      references memoid.projects(workspace_id, id),
    constraint context_revisions_policy_fk foreign key (workspace_id, project_id, review_policy_version)
      references memoid.project_review_policy_versions(workspace_id, project_id, version),
    constraint context_revisions_account_fk foreign key (workspace_id, applied_by_account_id)
      references memoid.workspaces(id, account_id),
    constraint context_revisions_sequence_positive check (revision_sequence > 0),
    constraint context_revisions_decision check (decision_mode in ('MANUAL', 'AUTOMATIC')),
    constraint context_revisions_manual_actor check (
      (decision_mode = 'MANUAL' and applied_by_account_id is not null) or
      (decision_mode = 'AUTOMATIC' and applied_by_account_id is null)
    ),
    constraint context_revisions_project_sequence_unique unique (workspace_id, project_id, revision_sequence),
    constraint context_revisions_project_id_unique unique (workspace_id, project_id, id)
  )`.execute(db);

  await sql`create table memoid.context_records (
    id uuid primary key default uuidv7(),
    workspace_id uuid not null,
    project_id uuid not null,
    context_identity_id uuid not null,
    context_revision_id uuid not null,
    assertion_payload jsonb not null,
    assertion_hash bytea not null,
    reviewed_at timestamptz not null,
    created_at timestamptz not null default clock_timestamp(),
    constraint context_records_id_v7 check (memoid.is_uuid_v7(id)),
    constraint context_records_identity_fk foreign key (workspace_id, project_id, context_identity_id)
      references memoid.context_identities(workspace_id, project_id, id),
    constraint context_records_revision_fk foreign key (workspace_id, project_id, context_revision_id)
      references memoid.context_revisions(workspace_id, project_id, id),
    constraint context_records_payload check (jsonb_typeof(assertion_payload) = 'object' and octet_length(assertion_payload::text) <= 65536),
    constraint context_records_hash check (octet_length(assertion_hash) = 32),
    constraint context_records_project_id_unique unique (workspace_id, project_id, id),
    constraint context_records_identity_id_unique unique (workspace_id, project_id, context_identity_id, id),
    constraint context_records_revision_identity_unique unique (workspace_id, project_id, context_revision_id, context_identity_id)
  )`.execute(db);

  await sql`create table memoid.context_identity_current_records (
    workspace_id uuid not null,
    project_id uuid not null,
    context_identity_id uuid not null,
    context_record_id uuid not null,
    established_by_revision_id uuid not null,
    established_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, context_identity_id),
    constraint current_context_record_fk foreign key (workspace_id, project_id, context_identity_id, context_record_id)
      references memoid.context_records(workspace_id, project_id, context_identity_id, id),
    constraint current_context_revision_fk foreign key (workspace_id, project_id, established_by_revision_id)
      references memoid.context_revisions(workspace_id, project_id, id),
    constraint current_context_record_unique unique (workspace_id, project_id, context_record_id)
  )`.execute(db);

  await sql`create table memoid.context_record_candidate_provenance (
    workspace_id uuid not null,
    project_id uuid not null,
    context_record_id uuid not null,
    candidate_assertion_id uuid not null,
    relation_kind varchar(16) not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, context_record_id, candidate_assertion_id, relation_kind),
    constraint context_record_candidate_record_fk foreign key (workspace_id, project_id, context_record_id)
      references memoid.context_records(workspace_id, project_id, id),
    constraint context_record_candidate_assertion_fk foreign key (workspace_id, project_id, candidate_assertion_id)
      references memoid.candidate_assertions(workspace_id, project_id, id),
    constraint context_record_candidate_relation check (relation_kind in ('ORIGINATES', 'SUPPORTS', 'CONTRADICTS'))
  )`.execute(db);

  await sql`create table memoid.context_record_source_provenance (
    workspace_id uuid not null,
    project_id uuid not null,
    context_record_id uuid not null,
    source_observation_id uuid not null,
    relation_kind varchar(16) not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, context_record_id, source_observation_id, relation_kind),
    constraint context_record_source_record_fk foreign key (workspace_id, project_id, context_record_id)
      references memoid.context_records(workspace_id, project_id, id),
    constraint context_record_source_observation_fk foreign key (workspace_id, project_id, source_observation_id)
      references memoid.source_observations(workspace_id, project_id, id),
    constraint context_record_source_relation check (relation_kind in ('ORIGINATES', 'SUPPORTS', 'CONTRADICTS'))
  )`.execute(db);

  await sql`create table memoid.context_record_source_coverage (
    workspace_id uuid not null,
    project_id uuid not null,
    context_record_id uuid not null,
    frontier_unit_id uuid not null,
    covered_observation_sequence bigint not null,
    recorded_at timestamptz not null default clock_timestamp(),
    primary key (workspace_id, project_id, context_record_id, frontier_unit_id),
    constraint context_record_coverage_record_fk foreign key (workspace_id, project_id, context_record_id)
      references memoid.context_records(workspace_id, project_id, id),
    constraint context_record_coverage_observation_fk foreign key (workspace_id, project_id, frontier_unit_id, covered_observation_sequence)
      references memoid.source_observations(workspace_id, project_id, frontier_unit_id, observation_sequence),
    constraint context_record_coverage_sequence_positive check (covered_observation_sequence > 0)
  )`.execute(db);
}

async function createPolicyAndFrontierFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function memoid.reject_immutable_row_change() returns trigger
    language plpgsql as $$
    begin
      raise exception 'immutable history row %.% cannot be updated in place', tg_table_schema, tg_table_name;
    end $$`.execute(db);
  await sql`do $$
    declare
      table_name text;
    begin
      foreach table_name in array array[
        'project_review_policy_versions',
        'source_observations',
        'candidate_submissions',
        'candidate_assertions',
        'candidate_stable_dispositions',
        'context_revisions',
        'context_records',
        'context_record_candidate_provenance',
        'context_record_source_provenance',
        'context_record_source_coverage'
      ] loop
        execute format(
          'create trigger %I before update on memoid.%I for each row execute function memoid.reject_immutable_row_change()',
          table_name || '_immutable_guard',
          table_name
        );
      end loop;
    end $$`.execute(db);

  await sql`create function memoid.require_context_record_provenance() returns trigger
    language plpgsql as $$
    declare
      record_workspace_id uuid;
      record_project_id uuid;
      record_id uuid;
    begin
      if tg_table_name = 'context_records' then
        record_workspace_id := new.workspace_id;
        record_project_id := new.project_id;
        record_id := new.id;
      else
        record_workspace_id := old.workspace_id;
        record_project_id := old.project_id;
        record_id := old.context_record_id;
      end if;
      perform 1 from memoid.context_records
        where workspace_id = record_workspace_id and project_id = record_project_id and id = record_id
        for update;
      if not exists (
        select 1 from memoid.context_record_candidate_provenance
          where workspace_id = record_workspace_id and project_id = record_project_id and context_record_id = record_id
      ) and not exists (
        select 1 from memoid.context_record_source_provenance
          where workspace_id = record_workspace_id and project_id = record_project_id and context_record_id = record_id
      ) then
        raise exception 'reviewed Context Record requires Candidate or Source provenance';
      end if;
      return null;
    end $$`.execute(db);
  await sql`create constraint trigger context_records_require_provenance
    after insert on memoid.context_records deferrable initially deferred
    for each row execute function memoid.require_context_record_provenance()`.execute(db);
  await sql`create constraint trigger candidate_provenance_preserves_record_provenance
    after delete on memoid.context_record_candidate_provenance deferrable initially deferred
    for each row execute function memoid.require_context_record_provenance()`.execute(db);
  await sql`create constraint trigger source_provenance_preserves_record_provenance
    after delete on memoid.context_record_source_provenance deferrable initially deferred
    for each row execute function memoid.require_context_record_provenance()`.execute(db);

  await sql`create function memoid.enforce_review_policy_sequence() returns trigger
    language plpgsql as $$
    declare
      prior_version bigint;
      prior_effective_at timestamptz;
    begin
      perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 1011));
      select version, effective_at into prior_version, prior_effective_at
        from memoid.project_review_policy_versions
        where workspace_id = new.workspace_id and project_id = new.project_id
        order by version desc limit 1;
      if prior_version is null then
        if new.version <> 1 then raise exception 'review policy version must start at 1'; end if;
      else
        if new.version <> prior_version + 1 then raise exception 'review policy version must advance exactly by one'; end if;
        if new.effective_at < prior_effective_at then raise exception 'review policy effective time cannot move backwards'; end if;
      end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger project_review_policy_sequence_guard
    before insert on memoid.project_review_policy_versions
    for each row execute function memoid.enforce_review_policy_sequence()`.execute(db);

  await sql`create function memoid.initialize_project_candidate_frontier() returns trigger
    language plpgsql as $$
    begin
      insert into memoid.candidate_frontier_states (workspace_id, project_id)
      values (new.workspace_id, new.id);
      return new;
    end $$`.execute(db);
  await sql`create trigger projects_initialize_candidate_frontier
    after insert on memoid.projects
    for each row execute function memoid.initialize_project_candidate_frontier()`.execute(db);

  await sql`create function memoid.guard_source_frontier_update() returns trigger
    language plpgsql as $$
    begin
      if (old.observed_sequence is not null and (new.observed_sequence is null or new.observed_sequence < old.observed_sequence)) or
         (old.desired_sequence is not null and (new.desired_sequence is null or new.desired_sequence < old.desired_sequence)) or
         (old.ingested_sequence is not null and (new.ingested_sequence is null or new.ingested_sequence < old.ingested_sequence)) or
         (old.reconciled_sequence is not null and (new.reconciled_sequence is null or new.reconciled_sequence < old.reconciled_sequence)) then
        raise exception 'source frontier stages cannot move backwards';
      end if;
      new.recorded_at := clock_timestamp();
      return new;
    end $$`.execute(db);
  await sql`create trigger source_frontier_update_guard
    before update on memoid.source_frontier_states
    for each row execute function memoid.guard_source_frontier_update()`.execute(db);

  await sql`create function memoid.guard_candidate_frontier_update() returns trigger
    language plpgsql as $$
    declare
      accepted_count bigint;
      stable_count bigint;
    begin
      if new.last_accepted_sequence < old.last_accepted_sequence then
        raise exception 'candidate accepted frontier cannot move backwards';
      end if;
      if new.reconciled_through_sequence < old.reconciled_through_sequence then
        raise exception 'candidate reconciled frontier cannot move backwards';
      end if;
      if new.last_accepted_sequence > old.last_accepted_sequence then
        select count(*) into accepted_count from memoid.candidate_submissions
          where workspace_id = new.workspace_id and project_id = new.project_id
            and submission_sequence > old.last_accepted_sequence
            and submission_sequence <= new.last_accepted_sequence;
        if accepted_count <> new.last_accepted_sequence - old.last_accepted_sequence then
          raise exception 'candidate accepted frontier cannot skip a submission';
        end if;
      end if;
      if new.reconciled_through_sequence > old.reconciled_through_sequence then
        select count(*) into stable_count from memoid.candidate_stable_dispositions
          where workspace_id = new.workspace_id and project_id = new.project_id
            and submission_sequence > old.reconciled_through_sequence
            and submission_sequence <= new.reconciled_through_sequence;
        if stable_count <> new.reconciled_through_sequence - old.reconciled_through_sequence then
          raise exception 'candidate reconciled frontier cannot cross an unstable gap';
        end if;
      end if;
      new.recorded_at := clock_timestamp();
      return new;
    end $$`.execute(db);
  await sql`create trigger candidate_frontier_update_guard
    before update on memoid.candidate_frontier_states
    for each row execute function memoid.guard_candidate_frontier_update()`.execute(db);

  await sql`create function memoid.advance_candidate_accepted_frontier() returns trigger
    language plpgsql as $$
    declare
      current_sequence bigint;
    begin
      select last_accepted_sequence into current_sequence
        from memoid.candidate_frontier_states
        where workspace_id = new.workspace_id and project_id = new.project_id
        for update;
      if new.submission_sequence <> current_sequence + 1 then
        raise exception 'candidate submission sequence must be the next contiguous accepted sequence';
      end if;
      update memoid.candidate_frontier_states
        set last_accepted_sequence = new.submission_sequence
        where workspace_id = new.workspace_id and project_id = new.project_id;
      return new;
    end $$`.execute(db);
  await sql`create trigger candidate_submissions_advance_accepted_frontier
    after insert on memoid.candidate_submissions
    for each row execute function memoid.advance_candidate_accepted_frontier()`.execute(db);

  await sql`create function memoid.refresh_candidate_reconciled_frontier(p_workspace_id uuid, p_project_id uuid)
    returns bigint language plpgsql as $$
    declare
      current_reconciled bigint;
      current_accepted bigint;
      first_unstable bigint;
      next_watermark bigint;
    begin
      select reconciled_through_sequence, last_accepted_sequence
        into current_reconciled, current_accepted
        from memoid.candidate_frontier_states
        where workspace_id = p_workspace_id and project_id = p_project_id
        for update;
      if not found then raise exception 'candidate frontier does not exist for Project'; end if;
      select min(c.submission_sequence) into first_unstable
        from memoid.candidate_submissions c
        left join memoid.candidate_stable_dispositions d
          on d.workspace_id = c.workspace_id and d.project_id = c.project_id
          and d.submission_sequence = c.submission_sequence
        where c.workspace_id = p_workspace_id and c.project_id = p_project_id
          and c.submission_sequence > current_reconciled
          and c.submission_sequence <= current_accepted
          and d.submission_sequence is null;
      next_watermark := coalesce(first_unstable - 1, current_accepted);
      if next_watermark > current_reconciled then
        update memoid.candidate_frontier_states
          set reconciled_through_sequence = next_watermark
          where workspace_id = p_workspace_id and project_id = p_project_id;
      end if;
      return greatest(current_reconciled, next_watermark);
    end $$`.execute(db);

  await sql`create function memoid.refresh_candidate_frontier_after_disposition() returns trigger
    language plpgsql as $$
    begin
      perform memoid.refresh_candidate_reconciled_frontier(new.workspace_id, new.project_id);
      return new;
    end $$`.execute(db);
  await sql`create trigger candidate_disposition_refreshes_reconciled_frontier
    after insert on memoid.candidate_stable_dispositions
    for each row execute function memoid.refresh_candidate_frontier_after_disposition()`.execute(
    db,
  );
}

async function createIndexesAndPermissions(db: Kysely<unknown>): Promise<void> {
  await sql`create index source_observations_project_observed_idx
    on memoid.source_observations (workspace_id, project_id, observed_at desc)`.execute(db);
  await sql`create index candidate_submissions_project_accepted_idx
    on memoid.candidate_submissions (workspace_id, project_id, accepted_at desc)`.execute(db);
  await sql`create index working_context_identity_recorded_idx
    on memoid.working_context_items (workspace_id, project_id, context_identity_id, recorded_at desc)`.execute(
    db,
  );
  await sql`create index context_records_identity_reviewed_idx
    on memoid.context_records (workspace_id, project_id, context_identity_id, reviewed_at desc)`.execute(
    db,
  );
  await sql`create index context_records_revision_idx
    on memoid.context_records (workspace_id, project_id, context_revision_id)`.execute(db);

  await sql`comment on schema memoid is 'Stage 10A product persistence foundation; runtime authorization and RLS are deferred to Stage 10C'`.execute(
    db,
  );
  await sql`comment on table memoid.candidate_submissions is 'Immutable Candidate Submission intake envelopes; checkpoint consent is not assertion confirmation'`.execute(
    db,
  );
  await sql`comment on table memoid.candidate_stable_dispositions is 'Stable Candidate processing dispositions kept separate from immutable intake'`.execute(
    db,
  );
  await sql`comment on table memoid.context_identity_current_records is 'Single current reviewed record pointer per semantic Context Identity; record payload history remains immutable-compatible'`.execute(
    db,
  );
  await sql`revoke all on schema memoid from public, memoid_app`.execute(db);
  await sql`revoke all on all tables in schema memoid from public, memoid_app`.execute(db);
  await sql`revoke all on all sequences in schema memoid from public, memoid_app`.execute(db);
  await sql`revoke all on all functions in schema memoid from public, memoid_app`.execute(db);
}

export const stage10aDomainSchemaMigration: Migration = {
  async up(db) {
    await sql`create schema memoid authorization memoid_owner`.execute(db);
    await sql`set local role memoid_owner`.execute(db);
    await sql`create function memoid.is_uuid_v7(value uuid) returns boolean
      language sql immutable strict parallel safe
      return uuid_extract_version(value) = 7`.execute(db);
    await createTables(db);
    await createPolicyAndFrontierFunctions(db);
    await createIndexesAndPermissions(db);
    await sql`reset role`.execute(db);
  },
  async down(db) {
    await sql`drop schema if exists memoid cascade`.execute(db);
  },
};
