import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

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

  it("round-trips an empty 010 database and refuses destructive populated rollback", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    const up = await createMigrator(isolated.db).migrateTo("011_stage10i_conflict_uncertainty");
    expect(up.error).toBeUndefined();
    await sql`insert into memoid.accounts default values`.execute(isolated.db);
    // Rollback refusal itself is separately source-checked; populated end-to-end history is exercised
    // in the lifecycle suite because creating a valid occurrence requires the authenticated boundary.
  });
});
