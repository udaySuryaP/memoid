import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10F migration 007", () => {
  let isolated: IsolatedTestDatabase;
  let sourceId: string;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10f_migration");
    const to006 = await createMigrator(isolated.db).migrateTo(
      "006_stage10e_github_source_provider_identity",
    );
    if (to006.error) throw to006.error;
    const accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const workspaceId = (
      await sql<{
        id: string;
      }>`insert into memoid.workspaces (account_id) values (${accountId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const projectId = (
      await sql<{
        id: string;
      }>`insert into memoid.projects (workspace_id, display_name) values (${workspaceId}::uuid, 'Stage 10F preserved project') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.project_review_policy_versions
      (workspace_id, project_id, version, policy, effective_at, changed_by_account_id)
      values (${workspaceId}::uuid, ${projectId}::uuid, 1, 'MANUAL', clock_timestamp(), ${accountId}::uuid)`.execute(
      isolated.db,
    );
    sourceId = (
      await sql<{ id: string }>`insert into memoid.sources (workspace_id, project_id, source_kind)
      values (${workspaceId}::uuid, ${projectId}::uuid, 'GITHUB') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.github_source_connections (
      workspace_id, project_id, source_id, app_id, installation_id, account_id,
      repository_id, owner_login, repository_name, full_name, html_url, visibility,
      default_branch, connection_state, verified_at
    ) values (
      ${workspaceId}::uuid, ${projectId}::uuid, ${sourceId}::uuid, '123', '456', '789',
      '987654321', 'owner', 'repo', 'owner/repo', 'https://github.com/owner/repo', 'PRIVATE',
      'main', 'ACTIVE', clock_timestamp()
    )`.execute(isolated.db);
    await sql`create table public.stage10f_migration_role_probe (
      event_id bigint generated always as identity primary key, migration_name varchar(255),
      operation text, effective_role name, session_role name
    )`.execute(isolated.db);
    await sql`create function public.capture_stage10f_migration_role() returns trigger language plpgsql as $$
      begin insert into public.stage10f_migration_role_probe
        (migration_name, operation, effective_role, session_role)
        values (case when tg_op = 'DELETE' then old.name else new.name end, tg_op, current_user, session_user);
        return null; end $$`.execute(isolated.db);
    await sql`create trigger capture_stage10f_migration_role after insert or delete on public.kysely_migration
      for each row execute function public.capture_stage10f_migration_role()`.execute(isolated.db);
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("upgrades 006 to 007 with the migration bookkeeping role restored", async () => {
    const result = await createMigrator(isolated.db).migrateTo("007_stage10f_ingestion_evidence");
    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([
      { migrationName: "007_stage10f_ingestion_evidence", direction: "Up", status: "Success" },
    ]);
    const bookkeeping = (
      await sql<{
        effectiveRole: string;
        sessionRole: string;
      }>`select effective_role as "effectiveRole", session_role as "sessionRole"
      from public.stage10f_migration_role_probe order by event_id`.execute(isolated.db)
    ).rows;
    expect(bookkeeping).toHaveLength(1);
    expect(bookkeeping[0]?.effectiveRole).toBe(bookkeeping[0]?.sessionRole);
    expect(bookkeeping[0]?.effectiveRole).not.toBe("memoid_owner");
  });

  it("creates only the bounded forced-RLS Stage 10F tables and narrow functions", async () => {
    const tables = await sql<{
      forced: boolean;
      owner: string;
      tableName: string;
    }>`select c.relname as "tableName", c.relforcerowsecurity as forced,
        pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'memoid' and c.relname in ('evidence_references','source_ingestion_dispositions')
      order by c.relname`.execute(isolated.db);
    expect(tables.rows).toEqual([
      { tableName: "evidence_references", forced: true, owner: "memoid_owner" },
      { tableName: "source_ingestion_dispositions", forced: true, owner: "memoid_owner" },
    ]);
    const exactScopeConstraints = await sql<{ name: string }>`select conname as name
      from pg_constraint where conname in (
        'source_frontier_units_stage10f_source_id_unique',
        'source_observations_stage10f_exact_id_unique',
        'evidence_references_unit_fk',
        'evidence_references_observation_fk',
        'source_ingestion_disposition_observation_fk'
      ) order by conname`.execute(isolated.db);
    expect(exactScopeConstraints.rows.map((row) => row.name)).toEqual([
      "evidence_references_observation_fk",
      "evidence_references_unit_fk",
      "source_frontier_units_stage10f_source_id_unique",
      "source_ingestion_disposition_observation_fk",
      "source_observations_stage10f_exact_id_unique",
    ]);
    const privileges = await sql<{
      appExecute: boolean;
      appWrite: boolean;
      authExecute: boolean;
      providerExecute: boolean;
    }>`select
      has_function_privilege('memoid_app', 'memoid.schedule_source_observation(uuid,uuid,uuid,uuid,character varying,character varying,character varying,boolean,timestamp with time zone,uuid,uuid)', 'EXECUTE') as "appExecute",
      has_table_privilege('memoid_app', 'memoid.evidence_references', 'INSERT,UPDATE,DELETE') as "appWrite",
      has_function_privilege('memoid_auth', 'memoid.acquire_source_ingestion(uuid,uuid,uuid,character varying,uuid,integer)', 'EXECUTE') as "authExecute",
      has_function_privilege('memoid_provider', 'memoid.acquire_source_ingestion(uuid,uuid,uuid,character varying,uuid,integer)', 'EXECUTE') as "providerExecute"`.execute(
      isolated.db,
    );
    expect(privileges.rows[0]).toEqual({
      appExecute: true,
      appWrite: false,
      authExecute: false,
      providerExecute: false,
    });
  });

  it("round-trips 007 to 006 to 007 without prior-stage data or residual-object leakage", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    expect(down.results).toEqual([
      { migrationName: "007_stage10f_ingestion_evidence", direction: "Down", status: "Success" },
    ]);
    const residual = await sql<{
      count: string;
    }>`select count(*)::text as count from information_schema.tables
      where table_schema = 'memoid' and table_name in ('evidence_references','source_ingestion_dispositions')`.execute(
      isolated.db,
    );
    expect(residual.rows[0]?.count).toBe("0");
    const residualObjects = await sql<{ count: string }>`select (
      (select count(*) from pg_constraint where conname in (
        'source_frontier_units_stage10f_source_id_unique',
        'source_observations_stage10f_exact_id_unique'
      )) +
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'memoid' and p.proname in (
          'schedule_source_observation','acquire_source_ingestion','record_evidence_reference',
          'complete_source_ingestion','retry_source_ingestion','assert_ingestion_actor',
          'guard_ingestion_disposition','guard_evidence_reference_change','is_safe_repository_path'
        ))
    )::text as count`.execute(isolated.db);
    expect(residualObjects.rows[0]?.count).toBe("0");
    expect(
      (
        await sql<{
          count: string;
        }>`select count(*)::text as count from memoid.github_source_connections
      where source_id = ${sourceId}::uuid`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("1");
    const reapplied = await createMigrator(isolated.db).migrateTo(
      "007_stage10f_ingestion_evidence",
    );
    expect(reapplied.error).toBeUndefined();
    expect(reapplied.results).toEqual([
      { migrationName: "007_stage10f_ingestion_evidence", direction: "Up", status: "Success" },
    ]);
    const bookkeeping = await sql<{
      effectiveRole: string;
      operation: string;
      sessionRole: string;
    }>`select operation, effective_role as "effectiveRole", session_role as "sessionRole"
      from public.stage10f_migration_role_probe order by event_id`.execute(isolated.db);
    expect(bookkeeping.rows.map((row) => row.operation)).toEqual(["INSERT", "DELETE", "INSERT"]);
    for (const row of bookkeeping.rows) {
      expect(row.effectiveRole).toBe(row.sessionRole);
      expect(row.effectiveRole).not.toBe("memoid_owner");
    }
  });
});
