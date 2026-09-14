import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10H migration 009", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10h_migration");
    const result = await createMigrator(isolated.db).migrateTo("008_stage10g_source_authority");
    if (result.error) throw result.error;
  });
  afterAll(async () => isolated.destroy(), 60_000);

  it("upgrades 008 to append-only, forced-RLS Context history", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "009_stage10h_context_records_provenance",
    );
    expect(result.error).toBeUndefined();
    const rows = await sql<{
      name: string;
      forced: boolean;
      owner: string;
    }>`select c.relname as name,
      c.relforcerowsecurity as forced,pg_get_userbyid(c.relowner) as owner from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='memoid' and c.relname in
      ('context_identity_endings','context_record_evidence_provenance','context_record_origins')
      order by c.relname`.execute(isolated.db);
    expect(rows.rows).toEqual([
      { name: "context_identity_endings", forced: true, owner: "memoid_owner" },
      { name: "context_record_evidence_provenance", forced: true, owner: "memoid_owner" },
      { name: "context_record_origins", forced: true, owner: "memoid_owner" },
    ]);
    const privileges = (
      await sql<{ appExecute: boolean; appWrite: boolean; authExecute: boolean }>`select
      has_function_privilege('memoid_app','memoid.put_context_record(bytea,uuid,character varying,character varying,character varying,character varying,bigint,uuid,jsonb,character varying,uuid,uuid,bytea,bytea,uuid,uuid)','EXECUTE') as "appExecute",
      has_table_privilege('memoid_app','memoid.context_record_origins','INSERT,UPDATE,DELETE') as "appWrite",
      has_function_privilege('memoid_auth','memoid.put_context_record(bytea,uuid,character varying,character varying,character varying,character varying,bigint,uuid,jsonb,character varying,uuid,uuid,bytea,bytea,uuid,uuid)','EXECUTE') as "authExecute"`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(privileges).toEqual({ appExecute: true, appWrite: false, authExecute: false });
  });

  it("round-trips an empty database through 008 -> 009 -> 008 -> 009", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    expect(
      (
        await sql<{ count: string }>`select count(*)::text as count from information_schema.tables
      where table_schema='memoid' and table_name in ('context_record_origins','context_record_evidence_provenance','context_identity_endings')`.execute(
          isolated.db,
        )
      ).rows[0]?.count,
    ).toBe("0");
    const up = await createMigrator(isolated.db).migrateTo(
      "009_stage10h_context_records_provenance",
    );
    expect(up.error).toBeUndefined();
  });
});
