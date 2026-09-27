import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10K migration 013", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10k_migration");
    const result = await createMigrator(isolated.db).migrateTo(
      "012_stage10j_hybrid_reconciliation",
    );
    if (result.error) throw result.error;
  });
  afterAll(async () => isolated.destroy(), 60_000);

  it("adds immutable Proposal history and forced-RLS current projections with narrow grants", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "013_stage10k_change_proposals_backlog",
    );
    expect(result.error).toBeUndefined();
    const tables = await sql<{
      name: string;
      forced: boolean;
      owner: string;
    }>`select c.relname name,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='memoid' and c.relname in ('change_proposals','change_proposal_items','proposal_current_states','proposal_item_current_states','proposal_state_events') order by c.relname`.execute(
      isolated.db,
    );
    expect(tables.rows).toHaveLength(5);
    expect(tables.rows.every((row) => row.forced && row.owner === "memoid_owner")).toBe(true);
    const privileges = (
      await sql<{
        appRead: boolean;
        appWrite: boolean;
        authRead: boolean;
        providerRead: boolean;
      }>`select has_table_privilege('memoid_app','memoid.change_proposals','SELECT') "appRead",has_table_privilege('memoid_app','memoid.change_proposals','INSERT,UPDATE,DELETE') "appWrite",has_table_privilege('memoid_auth','memoid.change_proposals','SELECT') "authRead",has_table_privilege('memoid_provider','memoid.change_proposals','SELECT') "providerRead"`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(privileges).toEqual({
      appRead: true,
      appWrite: false,
      authRead: false,
      providerRead: false,
    });
  });

  it("round-trips an empty additive migration", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    const up = await createMigrator(isolated.db).migrateTo("013_stage10k_change_proposals_backlog");
    expect(up.error).toBeUndefined();
  });

  it("refuses populated rollback and preserves Proposal history intact", async () => {
    const accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const workspaceId = (
      await sql<{
        id: string;
      }>`insert into memoid.workspaces(account_id) values(${accountId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const projectId = (
      await sql<{
        id: string;
      }>`insert into memoid.projects(workspace_id,display_name) values(${workspaceId}::uuid,'Populated rollback proof') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const actorId = (
      await sql<{
        id: string;
      }>`insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label) values(${workspaceId}::uuid,'MEMOID_WORKER','worker:rollback-proof','Rollback proof worker') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const submissionId = (
      await sql<{
        id: string;
      }>`insert into memoid.candidate_submissions(workspace_id,project_id,submission_sequence,submitted_at,payload_hash) values(${workspaceId}::uuid,${projectId}::uuid,1,clock_timestamp(),sha256(convert_to('rollback-submission','UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const candidateId = (
      await sql<{
        id: string;
      }>`insert into memoid.candidate_assertions(workspace_id,project_id,candidate_submission_id,assertion_ordinal,origin_kind,assertion_payload,assertion_hash) values(${workspaceId}::uuid,${projectId}::uuid,${submissionId}::uuid,1,'AI_INFERRED','{"value":"candidate"}'::jsonb,sha256(convert_to('{"value":"candidate"}'::jsonb::text,'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const identityId = (
      await sql<{
        id: string;
      }>`insert into memoid.context_identities(workspace_id,project_id,subject_key,scope_key,facet_key,predicate_key) values(${workspaceId}::uuid,${projectId}::uuid,'project','architecture','implementation_state:code','rollback') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const workingId = (
      await sql<{
        id: string;
      }>`insert into memoid.working_context_items(workspace_id,project_id,context_identity_id,candidate_assertion_id,trust_qualification,assertion_payload,assertion_hash,reconciled_at) values(${workspaceId}::uuid,${projectId}::uuid,${identityId}::uuid,${candidateId}::uuid,'RECONCILED_UNREVIEWED','{"value":"candidate"}'::jsonb,sha256(convert_to('{"value":"candidate"}'::jsonb::text,'UTF8')),clock_timestamp()) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const reconciliationId = (
      await sql<{
        id: string;
      }>`insert into memoid.reconciliation_records(workspace_id,project_id,candidate_assertion_id,context_identity_id,basis_hash,current_context_version,working_context_version,authority_version,evidence_frontier_version,integrity_version,engine_contract_version,schema_version,prompt_version,compaction_version,normalization_version,decision_path,classification,semantic_identity,normalized_assertion,evidence_reference_ids,conflict_indicated,uncertainty_indicated,reason_codes,working_context_item_id,recorded_by_actor_id) values(${workspaceId}::uuid,${projectId}::uuid,${candidateId}::uuid,${identityId}::uuid,sha256(convert_to('rollback-basis','UTF8')),1,0,0,0,0,'stage10j.v1','reconciliation-output.v1','reconciliation-prompt.v1','reasoning-packet.v1','semantic-normalization.v1','DETERMINISTIC','CHANGED','project/architecture/implementation_state:code/rollback','{"value":"candidate"}'::jsonb,'[]'::jsonb,false,false,'[]'::jsonb,${workingId}::uuid,${actorId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.reconciliation_current_states(workspace_id,project_id,candidate_assertion_id,reconciliation_id,basis_hash) values(${workspaceId}::uuid,${projectId}::uuid,${candidateId}::uuid,${reconciliationId}::uuid,sha256(convert_to('rollback-basis','UTF8')))`.execute(
      isolated.db,
    );
    const operationId = (
      await sql<{
        id: string;
      }>`insert into memoid.operations(workspace_id,project_id,initiating_actor_id,operation_kind,state,correlation_id,attempt_count,max_attempts,terminal_at) values(${workspaceId}::uuid,${projectId}::uuid,${actorId}::uuid,'MATERIALIZE_CHANGE_PROPOSAL','SUCCEEDED',uuidv7(),1,1,clock_timestamp()) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const proposalId = (
      await sql<{
        id: string;
      }>`insert into memoid.change_proposals(workspace_id,project_id,grouping_version,grouping_key,submission_id,scope_key,facet_key,operation_id,created_by_actor_id) values(${workspaceId}::uuid,${projectId}::uuid,'proposal-grouping.v1',sha256(convert_to('rollback-group','UTF8')),${submissionId}::uuid,'architecture','implementation_state:code',${operationId}::uuid,${actorId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const proposalItemId = (
      await sql<{
        id: string;
      }>`insert into memoid.change_proposal_items(workspace_id,project_id,proposal_id,reconciliation_id,candidate_assertion_id,context_identity_id,semantic_fingerprint,semantic_identity,reconciliation_class,normalized_assertion,working_context_item_id,evidence_reference_ids,conflict_qualified,uncertainty_qualified,destructive,current_context_version,working_context_version,authority_version,evidence_frontier_version,integrity_version,engine_contract_version,basis_hash) values(${workspaceId}::uuid,${projectId}::uuid,${proposalId}::uuid,${reconciliationId}::uuid,${candidateId}::uuid,${identityId}::uuid,sha256(convert_to('rollback-fingerprint','UTF8')),'project/architecture/implementation_state:code/rollback','CHANGED','{"value":"candidate"}'::jsonb,${workingId}::uuid,'[]'::jsonb,false,false,false,1,0,0,0,0,'stage10j.v1',sha256(convert_to('rollback-basis','UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.proposal_current_states(workspace_id,project_id,proposal_id,lifecycle_state) values(${workspaceId}::uuid,${projectId}::uuid,${proposalId}::uuid,'OPEN')`.execute(
      isolated.db,
    );
    await sql`insert into memoid.proposal_item_current_states(workspace_id,project_id,proposal_item_id,lifecycle_state) values(${workspaceId}::uuid,${projectId}::uuid,${proposalItemId}::uuid,'CURRENT')`.execute(
      isolated.db,
    );
    await sql`insert into memoid.proposal_state_events(workspace_id,project_id,target_kind,proposal_id,proposal_item_id,to_state,reason,operation_id,actor_id) values(${workspaceId}::uuid,${projectId}::uuid,'ITEM',${proposalId}::uuid,${proposalItemId}::uuid,'CURRENT','MATERIALIZED',${operationId}::uuid,${actorId}::uuid)`.execute(
      isolated.db,
    );

    const down = await createMigrator(isolated.db).migrateDown();
    expect(String(down.error)).toContain("STAGE10K_ROLLBACK_REFUSED_POPULATED_PROPOSAL_HISTORY");
    const preserved = (
      await sql<{ proposals: string; items: string; events: string }>`select
        (select count(*)::text from memoid.change_proposals where id=${proposalId}::uuid) proposals,
        (select count(*)::text from memoid.change_proposal_items where id=${proposalItemId}::uuid) items,
        (select count(*)::text from memoid.proposal_state_events where proposal_item_id=${proposalItemId}::uuid) events`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(preserved).toEqual({ proposals: "1", items: "1", events: "1" });
  });
});
