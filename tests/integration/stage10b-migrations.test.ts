import { createDatabase, createMigrator, migrateToLatest } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const stage10bTables = [
  "actors",
  "audit_events",
  "idempotency_records",
  "operation_attempts",
  "operations",
  "processing_units",
  "provider_event_receipts",
];

async function addStage10aData(db: IsolatedTestDatabase["db"]): Promise<string> {
  const account = await sql<{
    id: string;
  }>`insert into memoid.accounts default values returning id::text`.execute(db);
  const workspace = await sql<{ id: string }>`insert into memoid.workspaces (account_id)
    values (${account.rows[0]!.id}::uuid) returning id::text`.execute(db);
  const project = await sql<{ id: string }>`insert into memoid.projects (workspace_id)
    values (${workspace.rows[0]!.id}::uuid) returning id::text`.execute(db);
  await sql`insert into memoid.candidate_submissions
    (workspace_id, project_id, submission_sequence, submitted_at, payload_hash)
    values (${workspace.rows[0]!.id}::uuid, ${project.rows[0]!.id}::uuid, 1,
      clock_timestamp(), decode(repeat('31', 32), 'hex'))`.execute(db);
  return project.rows[0]!.id;
}

suite("Stage 10B migrations", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10b_migrations");
  });

  afterAll(async () => isolated.destroy());

  it("applies blank to latest with the actual deterministic migration provider", async () => {
    await migrateToLatest(isolated.db);
    const tables = await sql<{
      table_name: string;
    }>`select table_name from information_schema.tables
      where table_schema = 'memoid' and table_name = any(${stage10bTables}::text[])
      order by table_name`.execute(isolated.db);
    expect(tables.rows.map((row) => row.table_name)).toEqual(stage10bTables);
    const functions = await sql<{ name: string }>`select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'memoid' and p.proname = any(array[
        'claim_idempotency', 'acquire_operation', 'register_provider_event_receipt',
        'acquire_processing_unit', 'complete_processing_unit'
      ]) order by p.proname`.execute(isolated.db);
    expect(functions.rows.map((row) => row.name)).toEqual([
      "acquire_operation",
      "acquire_processing_unit",
      "claim_idempotency",
      "complete_processing_unit",
      "register_provider_event_receipt",
    ]);
    expect(
      (await createMigrator(isolated.db).getMigrations())
        .filter((migration) => migration.executedAt !== undefined)
        .map((migration) => migration.name),
    ).toEqual([
      "001_foundation_rls",
      "002_stage10a_domain_schema",
      "003_stage10b_actor_audit_operation",
    ]);
  });

  it("upgrades a populated Stage 10A database without changing accepted data", async () => {
    const upgrade = await createIsolatedTestDatabase(adminUrl!, "10b_upgrade_10a");
    try {
      const through10a = await createMigrator(upgrade.db).migrateTo("002_stage10a_domain_schema");
      expect(through10a.error).toBeUndefined();
      const projectId = await addStage10aData(upgrade.db);
      const to10b = await createMigrator(upgrade.db).migrateTo(
        "003_stage10b_actor_audit_operation",
      );
      expect(to10b.error).toBeUndefined();
      const preserved = await sql<{ candidateCount: string; projectCount: string }>`select
        (select count(*)::text from memoid.projects where id = ${projectId}::uuid) as "projectCount",
        (select count(*)::text from memoid.candidate_submissions where project_id = ${projectId}::uuid) as "candidateCount"`.execute(
        upgrade.db,
      );
      expect(preserved.rows[0]).toEqual({ projectCount: "1", candidateCount: "1" });
    } finally {
      await upgrade.destroy();
    }
  });

  it("rolls latest down to the exact Stage 10A boundary and re-applies 10B", async () => {
    const roundTrip = await createIsolatedTestDatabase(adminUrl!, "10b_down_up");
    try {
      const through10a = await createMigrator(roundTrip.db).migrateTo("002_stage10a_domain_schema");
      expect(through10a.error).toBeUndefined();
      const projectId = await addStage10aData(roundTrip.db);
      const to10b = await createMigrator(roundTrip.db).migrateTo(
        "003_stage10b_actor_audit_operation",
      );
      expect(to10b.error).toBeUndefined();
      const down = await createMigrator(roundTrip.db).migrateDown();
      expect(down.error).toBeUndefined();
      const boundary = await sql<{
        actorTable: boolean;
        candidateCount: string;
        projectCount: string;
      }>`select
        to_regclass('memoid.actors') is not null as "actorTable",
        (select count(*)::text from memoid.projects where id = ${projectId}::uuid) as "projectCount",
        (select count(*)::text from memoid.candidate_submissions where project_id = ${projectId}::uuid) as "candidateCount"`.execute(
        roundTrip.db,
      );
      expect(boundary.rows[0]).toEqual({
        actorTable: false,
        projectCount: "1",
        candidateCount: "1",
      });
      const residualFunctions = await sql<{ count: string }>`select count(*)::text as count
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'memoid' and p.proname in (
          'claim_idempotency', 'acquire_operation', 'register_provider_event_receipt',
          'acquire_processing_unit', 'complete_processing_unit', 'is_sanitized_metadata'
        )`.execute(roundTrip.db);
      expect(residualFunctions.rows[0]?.count).toBe("0");
      const up = await createMigrator(roundTrip.db).migrateTo("003_stage10b_actor_audit_operation");
      expect(up.error).toBeUndefined();
      expect(
        (
          await sql<{
            exists: boolean;
          }>`select to_regclass('memoid.audit_events') is not null as exists`.execute(roundTrip.db)
        ).rows[0]?.exists,
      ).toBe(true);
    } finally {
      await roundTrip.destroy();
    }
  });

  it("does not widen product-schema access before Stage 10C", async () => {
    const appUrl = new URL(isolated.connectionString);
    appUrl.username = "memoid_app";
    appUrl.password = "synthetic-app-password";
    const app = createDatabase(appUrl.toString(), 1);
    try {
      await expect(sql`select id from memoid.actors`.execute(app)).rejects.toThrow();
      await expect(
        sql`select * from memoid.claim_idempotency(null,null,null,null,null,null,null,null,1,clock_timestamp())`.execute(
          app,
        ),
      ).rejects.toThrow();
    } finally {
      await app.destroy();
    }
  });
});
