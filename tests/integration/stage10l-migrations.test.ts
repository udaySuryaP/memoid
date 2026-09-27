import { createMigrator } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10L migration 014", () => {
  let isolated: IsolatedTestDatabase;
  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10l_migration");
    const result = await createMigrator(isolated.db).migrateTo(
      "013_stage10k_change_proposals_backlog",
    );
    if (result.error) throw result.error;
  }, 60_000);
  afterAll(async () => isolated?.destroy(), 60_000);

  it("adds immutable history and forced-RLS current projection with narrow grants", async () => {
    const result = await createMigrator(isolated.db).migrateTo(
      "014_stage10l_review_policy_transitions",
    );
    expect(result.error).toBeUndefined();
    const tables = await sql<{
      name: string;
      forced: boolean;
      owner: string;
    }>`select c.relname name,c.relforcerowsecurity forced,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='memoid' and c.relname in ('review_policy_evaluations','review_policy_current_states') order by c.relname`.execute(
      isolated.db,
    );
    expect(tables.rows).toHaveLength(2);
    expect(tables.rows.every((row) => row.forced && row.owner === "memoid_owner")).toBe(true);
    const privileges = (
      await sql<{
        historyRead: boolean;
        historyWrite: boolean;
        authRead: boolean;
        providerRead: boolean;
      }>`select has_table_privilege('memoid_app','memoid.review_policy_evaluations','SELECT') "historyRead",has_table_privilege('memoid_app','memoid.review_policy_evaluations','INSERT,UPDATE,DELETE') "historyWrite",has_table_privilege('memoid_auth','memoid.review_policy_evaluations','SELECT') "authRead",has_table_privilege('memoid_provider','memoid.review_policy_evaluations','SELECT') "providerRead"`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(privileges).toEqual({
      historyRead: true,
      historyWrite: false,
      authRead: false,
      providerRead: false,
    });
    const functions = (
      await sql<{
        name: string;
        secure: boolean;
        searchPath: string;
      }>`select p.proname name,p.prosecdef secure,coalesce(array_to_string(p.proconfig,','),'') "searchPath" from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='memoid' and p.proname in ('evaluate_proposal_item_review_policy','evaluate_proposal_review_policy','revalidate_project_review_policy','change_project_review_policy') order by p.proname`.execute(
        isolated.db,
      )
    ).rows;
    expect(functions).toHaveLength(4);
    expect(
      functions.every(
        (fn) => fn.secure && fn.searchPath.includes("search_path=pg_catalog, memoid"),
      ),
    ).toBe(true);
  });

  it("round-trips while empty", async () => {
    const down = await createMigrator(isolated.db).migrateDown();
    expect(down.error).toBeUndefined();
    const up = await createMigrator(isolated.db).migrateTo(
      "014_stage10l_review_policy_transitions",
    );
    expect(up.error).toBeUndefined();
  });
});
