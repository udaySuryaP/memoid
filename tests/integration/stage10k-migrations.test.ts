import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10K migration 013", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10k_migration");
    const result = await createMigrator(isolated.db).migrateTo(
      "012_stage10j_hybrid_reconciliation",
    );
    if (result.error) throw result.error;
  });
  afterAll(async () => isolated.destroy(), 60_000);

  it("adds immutable Proposal history and forced-RLS current projections with narrow grants", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "013_stage10k_change_proposals_backlog",
    );
    expect(result.error).toBeUndefined();
    const tables = await sql<{
      name: string;
      forced: boolean;
      owner: string;
    }>`select c.relname name,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='memoid' and c.relname in ('change_proposals','change_proposal_items','proposal_current_states','proposal_item_current_states','proposal_state_events') order by c.relname`.execute(
      isolated.db,
    );
    expect(tables.rows).toHaveLength(5);
    expect(tables.rows.every((row) => row.forced && row.owner === "memoid_owner")).toBe(true);
    const privileges = (
      await sql<{
        appRead: boolean;
        appWrite: boolean;
        authRead: boolean;
        providerRead: boolean;
      }>`select has_table_privilege('memoid_app','memoid.change_proposals','SELECT') "appRead",has_table_privilege('memoid_app','memoid.change_proposals','INSERT,UPDATE,DELETE') "appWrite",has_table_privilege('memoid_auth','memoid.change_proposals','SELECT') "authRead",has_table_privilege('memoid_provider','memoid.change_proposals','SELECT') "providerRead"`.execute(
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
    const up = await createMigrator(isolated.db).migrateTo("013_stage10k_change_proposals_backlog");
    expect(up.error).toBeUndefined();
  });
});
