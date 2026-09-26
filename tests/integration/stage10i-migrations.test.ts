import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

async function addPopulatedUncertaintyHistory(db: IsolatedTestDatabase["db"]) {
  const account = (
    await sql<{
      id: string;
    }>`insert into memoid.accounts default values returning id::text`.execute(db)
  ).rows[0]!.id;
  const workspace = (
    await sql<{ id: string }>`insert into memoid.workspaces(account_id) values(${account}::uuid)
      returning id::text`.execute(db)
  ).rows[0]!.id;
  const project = (
    await sql<{ id: string }>`insert into memoid.projects(workspace_id) values(${workspace}::uuid)
      returning id::text`.execute(db)
  ).rows[0]!.id;
  const actor = (
    await sql<{ id: string }>`insert into memoid.actors
      (workspace_id,actor_kind,actor_reference,display_label)
      values(${workspace}::uuid,'HUMAN','stage10i-rollback-proof','Stage 10I rollback proof')
      returning id::text`.execute(db)
  ).rows[0]!.id;
  const identity = (
    await sql<{ id: string }>`insert into memoid.context_identities
      (workspace_id,project_id,subject_key,scope_key,facet_key,predicate_key)
      values(${workspace}::uuid,${project}::uuid,'project','architecture',
        'implementation_state:code','database') returning id::text`.execute(db)
  ).rows[0]!.id;
  const idempotency = (
    await sql<{ id: string }>`insert into memoid.idempotency_records
      (workspace_id,project_id,actor_id,action_key,idempotency_key_hash,request_fingerprint,
        state,claim_token,claim_expires_at,expires_at)
      values(${workspace}::uuid,${project}::uuid,${actor}::uuid,'UNCERTAINTY_STATE_RECORD',
        decode(repeat('41',32),'hex'),decode(repeat('42',32),'hex'),'IN_PROGRESS',uuidv7(),
        clock_timestamp()+interval '1 hour',clock_timestamp()+interval '24 hours')
      returning id::text`.execute(db)
  ).rows[0]!.id;
  const uncertainty = (
    await sql<{ id: string }>`insert into memoid.integrity_uncertainties
      (workspace_id,project_id,context_identity_id,target_kind)
      values(${workspace}::uuid,${project}::uuid,${identity}::uuid,'SEMANTIC_IDENTITY')
      returning id::text`.execute(db)
  ).rows[0]!.id;
  const occurrence = (
    await sql<{ id: string }>`insert into memoid.uncertainty_occurrences
      (workspace_id,project_id,uncertainty_id,context_identity_id,occurrence_version,
        lifecycle_state,reason_key,recorded_by_actor_id,idempotency_record_id,correlation_id)
      values(${workspace}::uuid,${project}::uuid,${uncertainty}::uuid,${identity}::uuid,1,
        'ACTIVE','INCOMPLETE_EVIDENCE',${actor}::uuid,${idempotency}::uuid,uuidv7())
      returning id::text`.execute(db)
  ).rows[0]!.id;
  await sql`insert into memoid.uncertainty_current_states
    (workspace_id,project_id,uncertainty_id,current_occurrence_id,occurrence_version,lifecycle_state)
    values(${workspace}::uuid,${project}::uuid,${uncertainty}::uuid,${occurrence}::uuid,1,'ACTIVE')`.execute(
    db,
  );
  return { uncertainty, occurrence };
}

suite("Stage 10I migration 011", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10i_migration");
    const result = await createMigrator(isolated.db).migrateTo("010_audit1a_integrity_corrections");
    if (result.error) throw result.error;
  });
  afterAll(async () => isolated.destroy(), 60_000);

  it("adds append-only Conflict and Uncertainty history with forced Project RLS", async () => {
    const result = await createMigrator(isolated.db).migrateTo("011_stage10i_conflict_uncertainty");
    expect(result.error).toBeUndefined();
    const tables = await sql<{ name: string; forced: boolean; owner: string }>`select
      c.relname name,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='memoid' and c.relname in ('integrity_conflicts','conflict_occurrences',
        'conflict_participants','conflict_current_states','integrity_uncertainties',
        'uncertainty_occurrences','uncertainty_current_states') order by c.relname`.execute(
      isolated.db,
    );
    expect(tables.rows).toHaveLength(7);
    expect(tables.rows.every((row) => row.forced && row.owner === "memoid_owner")).toBe(true);
    const privileges = (
      await sql<{
        appConflict: boolean;
        appUncertainty: boolean;
        appWrite: boolean;
        authConflict: boolean;
      }>`select
        has_function_privilege('memoid_app','memoid.record_conflict_state(bytea,uuid,uuid,uuid,bigint,character varying,character varying,jsonb,character varying,uuid,bytea,bytea,uuid,uuid)','EXECUTE') "appConflict",
        has_function_privilege('memoid_app','memoid.record_uncertainty_state(bytea,uuid,uuid,uuid,bigint,character varying,character varying,uuid,character varying,uuid,character varying,uuid,bytea,bytea,uuid,uuid)','EXECUTE') "appUncertainty",
        has_table_privilege('memoid_app','memoid.conflict_occurrences','INSERT,UPDATE,DELETE') "appWrite",
        has_function_privilege('memoid_auth','memoid.record_conflict_state(bytea,uuid,uuid,uuid,bigint,character varying,character varying,jsonb,character varying,uuid,bytea,bytea,uuid,uuid)','EXECUTE') "authConflict"`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(privileges).toEqual({
      appConflict: true,
      appUncertainty: true,
      appWrite: false,
      authConflict: false,
    });
  });

  it("round-trips empty 010→011→010→011 and preserves populated history on refused rollback", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    const up = await createMigrator(isolated.db).migrateTo("011_stage10i_conflict_uncertainty");
    expect(up.error).toBeUndefined();
    const history = await addPopulatedUncertaintyHistory(isolated.db);

    const populatedDown = await createMigrator(isolated.db).migrateDown();
    expect(populatedDown.error).toBeDefined();
    expect(String(populatedDown.error)).toContain(
      "STAGE10I_ROLLBACK_REFUSED_POPULATED_INTEGRITY_HISTORY",
    );

    const preserved = await sql<{
      occurrenceId: string;
      lifecycleState: string;
      version: string;
    }>`select o.id::text as "occurrenceId",s.lifecycle_state as "lifecycleState",
      s.occurrence_version::text as version
      from memoid.uncertainty_occurrences o
      join memoid.uncertainty_current_states s on s.workspace_id=o.workspace_id
        and s.project_id=o.project_id and s.uncertainty_id=o.uncertainty_id
        and s.current_occurrence_id=o.id
      where o.uncertainty_id=${history.uncertainty}::uuid`.execute(isolated.db);
    expect(preserved.rows).toEqual([
      { occurrenceId: history.occurrence, lifecycleState: "ACTIVE", version: "1" },
    ]);
    const tables = await sql<{ count: string }>`select count(*)::text count
      from information_schema.tables where table_schema='memoid' and table_name in
      ('integrity_uncertainties','uncertainty_occurrences','uncertainty_current_states')`.execute(
      isolated.db,
    );
    expect(tables.rows[0]?.count).toBe("3");
  });
});
