import { createMigrator, migrateToLatest } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10A migrations", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10a_migrations");
  });

  afterAll(async () => isolated.destroy());

  it("applies a blank database through the deterministic latest schema", async () => {
    await migrateToLatest(isolated.db);
    const tables = await sql<{ table_name: string }>`select table_name
      from information_schema.tables where table_schema = 'memoid' order by table_name`.execute(
      isolated.db,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "accounts",
      "candidate_assertions",
      "candidate_frontier_states",
      "candidate_stable_dispositions",
      "candidate_submissions",
      "context_identities",
      "context_identity_current_records",
      "context_record_candidate_provenance",
      "context_record_source_coverage",
      "context_record_source_provenance",
      "context_records",
      "context_revisions",
      "project_review_policy_versions",
      "projects",
      "source_frontier_states",
      "source_frontier_units",
      "source_observations",
      "sources",
      "working_context_items",
      "workspaces",
    ]);
    const generated = await sql<{
      id: string;
      version: number;
    }>`insert into memoid.accounts default values
      returning id::text, uuid_extract_version(id) as version`.execute(isolated.db);
    expect(generated.rows[0]?.version).toBe(7);
  });

  it("is a no-op when migrate-to-latest is repeated", async () => {
    await expect(migrateToLatest(isolated.db)).resolves.toBeUndefined();
    const applied = await createMigrator(isolated.db).getMigrations();
    expect(applied.filter((migration) => migration.executedAt !== undefined)).toHaveLength(2);
  });

  it("round-trips down and back up without schema drift", async () => {
    const downProduct = await createMigrator(isolated.db).migrateDown();
    expect(downProduct.error).toBeUndefined();
    const productSchema = await sql<{ exists: boolean }>`select exists (
      select 1 from information_schema.schemata where schema_name = 'memoid'
    ) as exists`.execute(isolated.db);
    expect(productSchema.rows[0]?.exists).toBe(false);

    const downFoundation = await createMigrator(isolated.db).migrateDown();
    expect(downFoundation.error).toBeUndefined();
    const foundationSchema = await sql<{ exists: boolean }>`select exists (
      select 1 from information_schema.schemata where schema_name = 'foundation'
    ) as exists`.execute(isolated.db);
    expect(foundationSchema.rows[0]?.exists).toBe(false);

    await migrateToLatest(isolated.db);
    const constraints = await sql<{ count: string }>`select count(*)::text as count
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'memoid'`.execute(isolated.db);
    expect(Number(constraints.rows[0]?.count)).toBeGreaterThan(40);
  });
});
