import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10J migration 012", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10j_migration");
    const result = await createMigrator(isolated.db).migrateTo("011_stage10i_conflict_uncertainty");
    if (result.error) throw result.error;
  });
  afterAll(async () => isolated.destroy(), 60_000);

  it("adds immutable reconciliation/accounting history with forced Project RLS and narrow grants", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "012_stage10j_hybrid_reconciliation",
    );
    expect(result.error).toBeUndefined();
    const tables = await sql<{
      name: string;
      forced: boolean;
      owner: string;
    }>`select c.relname name,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='memoid' and c.relname in ('reconciliation_records','reconciliation_current_states','model_invocation_attempts') order by c.relname`.execute(
      isolated.db,
    );
    expect(tables.rows).toHaveLength(3);
    expect(tables.rows.every((row) => row.forced && row.owner === "memoid_owner")).toBe(true);
    const privileges = (
      await sql<{
        appRead: boolean;
        appWrite: boolean;
        authRead: boolean;
        providerRead: boolean;
      }>`select has_table_privilege('memoid_app','memoid.reconciliation_records','SELECT') "appRead",has_table_privilege('memoid_app','memoid.reconciliation_records','INSERT,UPDATE,DELETE') "appWrite",has_table_privilege('memoid_auth','memoid.reconciliation_records','SELECT') "authRead",has_table_privilege('memoid_provider','memoid.reconciliation_records','SELECT') "providerRead"`.execute(
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
    const up = await createMigrator(isolated.db).migrateTo("012_stage10j_hybrid_reconciliation");
    expect(up.error).toBeUndefined();
  });
});
