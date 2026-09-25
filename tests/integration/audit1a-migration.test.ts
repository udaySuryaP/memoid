import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("AUDIT-1A migration 010", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "audit1a_migration");
    const result = await createMigrator(isolated.db).migrateTo(
      "009_stage10h_context_records_provenance",
    );
    if (result.error) throw result.error;
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("adds shared authority resolution, runtime discovery, and the corrected mutation boundary", async () => {
    const result = await createMigrator(isolated.db).migrateTo("010_audit1a_integrity_corrections");
    expect(result.error).toBeUndefined();
    const privileges = (
      await sql<{
        appResolver: boolean;
        appRuntime: boolean;
        appPut: boolean;
        authRuntime: boolean;
        providerRuntime: boolean;
      }>`select
        has_function_privilege('memoid_app','memoid.resolve_effective_source_authority(uuid,uuid,character varying,uuid)','EXECUTE') "appResolver",
        has_function_privilege('memoid_app','memoid.list_source_ingestion_runtime_targets(character varying,character varying,character varying,character varying)','EXECUTE') "appRuntime",
        has_function_privilege('memoid_app','memoid.put_context_record_v2(bytea,uuid,character varying,character varying,character varying,character varying,bigint,uuid,jsonb,character varying,uuid,uuid,bytea,bytea,uuid,uuid)','EXECUTE') "appPut",
        has_function_privilege('memoid_auth','memoid.list_source_ingestion_runtime_targets(character varying,character varying,character varying,character varying)','EXECUTE') "authRuntime",
        has_function_privilege('memoid_provider','memoid.list_source_ingestion_runtime_targets(character varying,character varying,character varying,character varying)','EXECUTE') "providerRuntime"`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(privileges).toEqual({
      appResolver: true,
      appRuntime: true,
      appPut: true,
      authRuntime: false,
      providerRuntime: false,
    });
  });

  it("round-trips to the unchanged Stage 10H schema", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    const functions = (
      await sql<{ count: string }>`select count(*)::text count from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname='memoid'
        and p.proname in ('qualify_source_authority_assignment',
          'resolve_effective_source_authority','list_source_ingestion_runtime_targets',
          'put_context_record_v2')`.execute(isolated.db)
    ).rows[0]?.count;
    expect(functions).toBe("0");
    const up = await createMigrator(isolated.db).migrateTo("010_audit1a_integrity_corrections");
    expect(up.error).toBeUndefined();
  });
});
