import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10G migration 008", () => {
  let isolated: IsolatedTestDatabase;
  let sourceId: string;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10g_migration");
    const to007 = await createMigrator(isolated.db).migrateTo("007_stage10f_ingestion_evidence");
    if (to007.error) throw to007.error;
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
      await sql<{ id: string }>`insert into memoid.projects (workspace_id, display_name)
        values (${workspaceId}::uuid, 'Stage 10G preserved project') returning id::text`.execute(
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
        values (${workspaceId}::uuid, ${projectId}::uuid, 'GITHUB_REPOSITORY') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.github_source_connections (
      workspace_id, project_id, source_id, app_id, installation_id, account_id,
      repository_id, owner_login, repository_name, full_name, html_url, visibility,
      default_branch, connection_state, verified_at
    ) values (${workspaceId}::uuid, ${projectId}::uuid, ${sourceId}::uuid, '123', '456', '789',
      '1001', 'owner', 'repo', 'owner/repo', 'https://github.com/owner/repo', 'PRIVATE',
      'main', 'ACTIVE', clock_timestamp())`.execute(isolated.db);
    await sql`create table public.stage10g_migration_role_probe (
      event_id bigint generated always as identity primary key, migration_name varchar(255),
      operation text, effective_role name, session_role name
    )`.execute(isolated.db);
    await sql`create function public.capture_stage10g_migration_role() returns trigger language plpgsql as $$
      begin insert into public.stage10g_migration_role_probe
        (migration_name, operation, effective_role, session_role)
        values (case when tg_op = 'DELETE' then old.name else new.name end, tg_op, current_user, session_user);
        return null; end $$`.execute(isolated.db);
    await sql`create trigger capture_stage10g_migration_role after insert or delete on public.kysely_migration
      for each row execute function public.capture_stage10g_migration_role()`.execute(isolated.db);
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("upgrades 007 to 008 with migration bookkeeping role restored", async () => {
    const result = await createMigrator(isolated.db).migrateTo("008_stage10g_source_authority");
    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([
      { migrationName: "008_stage10g_source_authority", direction: "Up", status: "Success" },
    ]);
    const role = (
      await sql<{ effective: string; session: string }>`select effective_role as effective,
        session_role as session from public.stage10g_migration_role_probe order by event_id`.execute(
        isolated.db,
      )
    ).rows[0]!;
    expect(role.effective).toBe(role.session);
    expect(role.effective).not.toBe("memoid_owner");
  });

  it("creates append-only forced-RLS tables and narrow runtime privileges", async () => {
    const tables = await sql<{
      name: string;
      forced: boolean;
      owner: string;
    }>`select c.relname as name,
      c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'memoid' and c.relname in (
        'source_authority_scopes','source_authority_assignments','source_authority_assignment_endings')
      order by c.relname`.execute(isolated.db);
    expect(tables.rows).toEqual([
      { name: "source_authority_assignment_endings", forced: true, owner: "memoid_owner" },
      { name: "source_authority_assignments", forced: true, owner: "memoid_owner" },
      { name: "source_authority_scopes", forced: true, owner: "memoid_owner" },
    ]);
    const privileges = (
      await sql<{
        appExecute: boolean;
        appWrite: boolean;
        authExecute: boolean;
        providerExecute: boolean;
      }>`select
        has_function_privilege('memoid_app', 'memoid.set_source_authority(bytea,uuid,uuid,character varying,character varying,character varying,character varying,character varying,bigint,character varying,character varying,bytea,bytea,uuid,uuid)', 'EXECUTE') as "appExecute",
        has_table_privilege('memoid_app', 'memoid.source_authority_assignments', 'INSERT,UPDATE,DELETE') as "appWrite",
        has_function_privilege('memoid_auth', 'memoid.set_source_authority(bytea,uuid,uuid,character varying,character varying,character varying,character varying,character varying,bigint,character varying,character varying,bytea,bytea,uuid,uuid)', 'EXECUTE') as "authExecute",
        has_function_privilege('memoid_provider', 'memoid.set_source_authority(bytea,uuid,uuid,character varying,character varying,character varying,character varying,character varying,bigint,character varying,character varying,bytea,bytea,uuid,uuid)', 'EXECUTE') as "providerExecute"`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(privileges).toEqual({
      appExecute: true,
      appWrite: false,
      authExecute: false,
      providerExecute: false,
    });
  });

  it("round-trips exactly to 007 and reapplies without prior-stage loss", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    expect(down.results).toEqual([
      { migrationName: "008_stage10g_source_authority", direction: "Down", status: "Success" },
    ]);
    const residual = (
      await sql<{ count: string }>`select count(*)::text as count from information_schema.tables
        where table_schema = 'memoid' and table_name like 'source_authority%'`.execute(isolated.db)
    ).rows[0]?.count;
    expect(residual).toBe("0");
    expect(
      (
        await sql<{
          count: string;
        }>`select count(*)::text as count from memoid.github_source_connections
      where source_id = ${sourceId}::uuid`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("1");
    const up = await createMigrator(isolated.db).migrateTo("008_stage10g_source_authority");
    expect(up.error).toBeUndefined();
    expect(
      (
        await sql<{ operation: string }>`select operation from public.stage10g_migration_role_probe
      order by event_id`.execute(isolated.db)
      ).rows.map((row) => row.operation),
    ).toEqual(["INSERT", "DELETE", "INSERT"]);
  });
});
