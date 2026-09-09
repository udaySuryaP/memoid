import { createDatabase, createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10E migration 006", () => {
  let isolated: IsolatedTestDatabase;
  let preservedProjectId: string;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10e_migrations");
    expect(
      (await createMigrator(isolated.db).migrateTo("005_stage10d_workspace_project")).error,
    ).toBeUndefined();
    const accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const workspaceId = (
      await sql<{ id: string }>`insert into memoid.workspaces (account_id)
        values (${accountId}::uuid) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    preservedProjectId = (
      await sql<{ id: string }>`insert into memoid.projects (workspace_id, display_name)
        values (${workspaceId}::uuid, 'Preserved Stage 10D project') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.project_review_policy_versions (
        workspace_id, project_id, version, policy, effective_at, changed_by_account_id
      ) values (
        ${workspaceId}::uuid, ${preservedProjectId}::uuid, 1, 'MANUAL',
        clock_timestamp(), ${accountId}::uuid
      )`.execute(isolated.db);

    await sql`create table public.stage10e_migration_role_probe (
      event_id bigint generated always as identity primary key,
      migration_name varchar(255) not null,
      operation text not null,
      effective_role name not null,
      session_role name not null
    )`.execute(isolated.db);
    await sql`create function public.capture_stage10e_migration_role() returns trigger
      language plpgsql as $$
      begin
        insert into public.stage10e_migration_role_probe (
          migration_name, operation, effective_role, session_role
        ) values (
          case when tg_op = 'DELETE' then old.name else new.name end,
          tg_op, current_user, session_user
        );
        return null;
      end $$`.execute(isolated.db);
    await sql`create trigger capture_stage10e_migration_role
      after insert or delete on public.kysely_migration
      for each row execute function public.capture_stage10e_migration_role()`.execute(isolated.db);
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("applies 005 to 006 through the repository provider and restores the bookkeeping role", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "006_stage10e_github_source_provider_identity",
    );
    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([
      {
        migrationName: "006_stage10e_github_source_provider_identity",
        direction: "Up",
        status: "Success",
      },
    ]);
    expect(
      (await createMigrator(isolated.db).getMigrations())
        .filter((migration) => migration.executedAt !== undefined)
        .map((migration) => migration.name),
    ).toEqual([
      "001_foundation_rls",
      "002_stage10a_domain_schema",
      "003_stage10b_actor_audit_operation",
      "004_stage10c_identity_authz_rls",
      "005_stage10d_workspace_project",
      "006_stage10e_github_source_provider_identity",
    ]);
    const bookkeeping = await sql<{
      effectiveRole: string;
      migrationName: string;
      operation: string;
      sessionRole: string;
    }>`select migration_name as "migrationName", operation,
        effective_role as "effectiveRole", session_role as "sessionRole"
      from public.stage10e_migration_role_probe order by event_id`.execute(isolated.db);
    expect(bookkeeping.rows).toHaveLength(1);
    expect(bookkeeping.rows[0]).toMatchObject({
      migrationName: "006_stage10e_github_source_provider_identity",
      operation: "INSERT",
    });
    expect(bookkeeping.rows[0]?.effectiveRole).toBe(bookkeeping.rows[0]?.sessionRole);
    expect(bookkeeping.rows[0]?.effectiveRole).not.toBe("memoid_owner");
    const role = await sql<{ effectiveRole: string; sessionRole: string }>`select
      current_user::text as "effectiveRole", session_user::text as "sessionRole"`.execute(
      isolated.db,
    );
    expect(role.rows[0]?.effectiveRole).toBe(role.rows[0]?.sessionRole);
    expect(role.rows[0]?.effectiveRole).not.toBe("memoid_owner");
  });

  it("adds only the bounded provider identity tables with forced RLS", async () => {
    const rows = await sql<{
      owner: string;
      tableName: string;
      forced: boolean;
    }>`select c.relname as "tableName", c.relforcerowsecurity as forced,
        pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'memoid' and c.relname in (
        'github_connection_intents','github_provider_lifecycle_fences',
        'github_repository_candidates','github_source_connections'
      ) order by c.relname`.execute(isolated.db);
    expect(rows.rows).toEqual([
      { tableName: "github_connection_intents", forced: true, owner: "memoid_owner" },
      { tableName: "github_provider_lifecycle_fences", forced: true, owner: "memoid_owner" },
      { tableName: "github_repository_candidates", forced: true, owner: "memoid_owner" },
      { tableName: "github_source_connections", forced: true, owner: "memoid_owner" },
    ]);
    expect(
      (
        await sql<{ count: string }>`select count(*)::text as count from information_schema.tables
      where table_schema = 'memoid' and table_name like 'github_%'`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("4");
  });

  it("gives the provider role one function and no direct table privilege", async () => {
    const privileges = await sql<{
      apply: boolean;
      migrationBookkeeping: boolean;
      tableWrite: boolean;
    }>`select
      has_function_privilege('memoid_provider', 'memoid.apply_github_lifecycle_signal(character varying,character varying,character varying,character varying,character varying,bytea,timestamp with time zone)', 'EXECUTE') as apply,
      has_table_privilege('memoid_provider', 'memoid.github_source_connections', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('memoid_provider', 'memoid.github_provider_lifecycle_fences', 'INSERT,UPDATE,DELETE') as "tableWrite",
      has_table_privilege('memoid_owner', 'public.kysely_migration', 'INSERT,UPDATE,DELETE') as "migrationBookkeeping"`.execute(
      isolated.db,
    );
    expect(privileges.rows[0]).toEqual({
      apply: true,
      migrationBookkeeping: false,
      tableWrite: false,
    });
    const runtimeRoles = await sql<{
      bypassRls: boolean;
      roleName: string;
      superuser: boolean;
    }>`select rolname as "roleName", rolsuper as superuser, rolbypassrls as "bypassRls"
      from pg_roles where rolname in ('memoid_app','memoid_auth','memoid_provider')
      order by rolname`.execute(isolated.db);
    expect(runtimeRoles.rows).toEqual([
      { roleName: "memoid_app", superuser: false, bypassRls: false },
      { roleName: "memoid_auth", superuser: false, bypassRls: false },
      { roleName: "memoid_provider", superuser: false, bypassRls: false },
    ]);
    const providerUrl = new URL(isolated.connectionString);
    providerUrl.username = "memoid_provider";
    providerUrl.password = "synthetic-provider-password";
    const provider = createDatabase(providerUrl.toString(), 1);
    try {
      await expect(
        sql`select * from memoid.github_source_connections`.execute(provider),
      ).rejects.toThrow();
    } finally {
      await provider.destroy();
    }
  });

  it("round-trips 005 to 006 to 005 to 006 without role or prior-stage data leakage", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    expect(down.results).toEqual([
      {
        migrationName: "006_stage10e_github_source_provider_identity",
        direction: "Down",
        status: "Success",
      },
    ]);
    expect(
      (
        await sql<{ count: string }>`select count(*)::text as count
          from public.kysely_migration
          where name = '006_stage10e_github_source_provider_identity'`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("0");
    const downRole = await sql<{ effectiveRole: string; sessionRole: string }>`select
      current_user::text as "effectiveRole", session_user::text as "sessionRole"`.execute(
      isolated.db,
    );
    expect(downRole.rows[0]?.effectiveRole).toBe(downRole.rows[0]?.sessionRole);
    expect(downRole.rows[0]?.effectiveRole).not.toBe("memoid_owner");
    expect(
      (
        await sql<{
          exists: boolean;
        }>`select to_regclass('memoid.github_source_connections') is not null as exists`.execute(
          isolated.db,
        )
      ).rows[0]?.exists,
    ).toBe(false);
    const preserved = await sql<{ policy: string; projectName: string }>`select
      p.display_name as "projectName", v.policy
      from memoid.projects p join memoid.project_review_policy_versions v
        on v.workspace_id = p.workspace_id and v.project_id = p.id and v.version = 1
      where p.id = ${preservedProjectId}::uuid`.execute(isolated.db);
    expect(preserved.rows[0]).toEqual({
      policy: "MANUAL",
      projectName: "Preserved Stage 10D project",
    });

    const reapplied = await createMigrator(isolated.db).migrateTo(
      "006_stage10e_github_source_provider_identity",
    );
    expect(reapplied.error).toBeUndefined();
    expect(reapplied.results).toEqual([
      {
        migrationName: "006_stage10e_github_source_provider_identity",
        direction: "Up",
        status: "Success",
      },
    ]);
    const bookkeeping = await sql<{
      effectiveRole: string;
      operation: string;
      sessionRole: string;
    }>`select operation, effective_role as "effectiveRole", session_role as "sessionRole"
      from public.stage10e_migration_role_probe order by event_id`.execute(isolated.db);
    expect(bookkeeping.rows.map((event) => event.operation)).toEqual([
      "INSERT",
      "DELETE",
      "INSERT",
    ]);
    for (const event of bookkeeping.rows) {
      expect(event.effectiveRole).toBe(event.sessionRole);
      expect(event.effectiveRole).not.toBe("memoid_owner");
    }
    expect(
      (
        await sql<{ count: string }>`select count(*)::text as count
          from public.kysely_migration
          where name = '006_stage10e_github_source_provider_identity'`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("1");
  });
});
