import { createDatabase, createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10E migration 006", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10e_migrations");
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("adds only the bounded provider identity tables and forced tenant RLS", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "006_stage10e_github_source_provider_identity",
    );
    expect(result.error).toBeUndefined();
    const rows = await sql<{
      tableName: string;
      forced: boolean;
    }>`select c.relname as "tableName", c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'memoid' and c.relname in (
        'github_connection_intents','github_repository_candidates','github_source_connections'
      ) order by c.relname`.execute(isolated.db);
    expect(rows.rows).toEqual([
      { tableName: "github_connection_intents", forced: true },
      { tableName: "github_repository_candidates", forced: true },
      { tableName: "github_source_connections", forced: true },
    ]);
    expect(
      (
        await sql<{ count: string }>`select count(*)::text as count from information_schema.tables
      where table_schema = 'memoid' and table_name like 'github_%'`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("4");
  });

  it("gives the provider role one function and no direct table privilege", async () => {
    const privileges = await sql<{ apply: boolean; tableWrite: boolean }>`select
      has_function_privilege('memoid_provider', 'memoid.apply_github_lifecycle_signal(character varying,character varying,character varying,character varying,character varying,bytea,timestamp with time zone)', 'EXECUTE') as apply,
      has_table_privilege('memoid_provider', 'memoid.github_source_connections', 'INSERT,UPDATE,DELETE') as "tableWrite"`.execute(
      isolated.db,
    );
    expect(privileges.rows[0]).toEqual({ apply: true, tableWrite: false });
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

  it("round-trips 006 to 005 and reapplies", async () => {
    expect((await createMigrator(isolated.db).migrateDown()).error).toBeUndefined();
    expect(
      (
        await sql<{
          exists: boolean;
        }>`select to_regclass('memoid.github_source_connections') is not null as exists`.execute(
          isolated.db,
        )
      ).rows[0]?.exists,
    ).toBe(false);
    expect(
      (await createMigrator(isolated.db).migrateTo("006_stage10e_github_source_provider_identity"))
        .error,
    ).toBeUndefined();
  });
});
