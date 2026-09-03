import { createDatabase, createMigrator, withSecurityTransaction } from "@memoid/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

async function stage10cProject(db: IsolatedTestDatabase["db"]) {
  const account = (
    await sql<{
      id: string;
    }>`insert into memoid.accounts default values returning id::text`.execute(db)
  ).rows[0]!.id;
  const workspace = (
    await sql<{
      id: string;
    }>`insert into memoid.workspaces (account_id) values (${account}::uuid) returning id::text`.execute(
      db,
    )
  ).rows[0]!.id;
  const project = (
    await sql<{
      id: string;
    }>`insert into memoid.projects (workspace_id) values (${workspace}::uuid) returning id::text`.execute(
      db,
    )
  ).rows[0]!.id;
  return { account, workspace, project };
}

suite("Stage 10D migration 005", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10d_migrations");
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("applies blank through migration 005 with the deterministic provider", async () => {
    const result = await createMigrator(isolated.db).migrateTo("005_stage10d_workspace_project");
    expect(result.error).toBeUndefined();
    const schema = await sql<{
      createFunction: boolean;
      lifecycleColumn: boolean;
      updateFunction: boolean;
    }>`select
      to_regprocedure('memoid.create_project(bytea,text,text,character varying,bytea,bytea,uuid,uuid)') is not null as "createFunction",
      to_regprocedure('memoid.update_project_metadata(bytea,uuid,bigint,text,text,uuid)') is not null as "updateFunction",
      exists (select 1 from information_schema.columns where table_schema = 'memoid' and table_name = 'projects' and column_name = 'lifecycle_state') as "lifecycleColumn"`.execute(
      isolated.db,
    );
    expect(schema.rows[0]).toEqual({
      createFunction: true,
      updateFunction: true,
      lifecycleColumn: true,
    });
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
    ]);
  });

  it("upgrades populated Stage 10C data and establishes the missing initial policy", async () => {
    const upgrade = await createIsolatedTestDatabase(adminUrl!, "10d_upgrade");
    try {
      expect(
        (await createMigrator(upgrade.db).migrateTo("004_stage10c_identity_authz_rls")).error,
      ).toBeUndefined();
      const fixture = await stage10cProject(upgrade.db);
      expect(
        (await createMigrator(upgrade.db).migrateTo("005_stage10d_workspace_project")).error,
      ).toBeUndefined();
      const proof = await sql<{
        displayName: string;
        lifecycleState: string;
        policy: string;
        version: string;
      }>`select
        p.display_name as "displayName", p.lifecycle_state as "lifecycleState", p.version::text as version,
        v.policy from memoid.projects p join memoid.project_review_policy_versions v
          on v.workspace_id = p.workspace_id and v.project_id = p.id and v.version = 1
        where p.id = ${fixture.project}::uuid`.execute(upgrade.db);
      expect(proof.rows[0]).toEqual({
        displayName: "Untitled project",
        lifecycleState: "ACTIVE",
        policy: "MANUAL",
        version: "1",
      });
    } finally {
      await upgrade.destroy();
    }
  });

  it("round-trips populated 005 to the exact 004 shape and reapplies without data loss", async () => {
    const roundTrip = await createIsolatedTestDatabase(adminUrl!, "10d_roundtrip");
    try {
      expect(
        (await createMigrator(roundTrip.db).migrateTo("004_stage10c_identity_authz_rls")).error,
      ).toBeUndefined();
      const fixture = await stage10cProject(roundTrip.db);
      expect(
        (await createMigrator(roundTrip.db).migrateTo("005_stage10d_workspace_project")).error,
      ).toBeUndefined();
      await sql`update memoid.projects set display_name = 'Preserved project' where id = ${fixture.project}::uuid`.execute(
        roundTrip.db,
      );
      const actor = (
        await sql<{ id: string }>`insert into memoid.actors
          (workspace_id, actor_kind, actor_reference, display_label)
          values (${fixture.workspace}::uuid, 'HUMAN', ${`account:${fixture.account}`}, 'Owner')
          returning id::text`.execute(roundTrip.db)
      ).rows[0]!.id;
      await sql`insert into memoid.idempotency_records (
          workspace_id, project_id, actor_id, action_key, idempotency_key_hash,
          request_fingerprint, state, result_kind, result_reference,
          response_fingerprint, result_status_code, expires_at
        ) values (
          ${fixture.workspace}::uuid, null, ${actor}::uuid, 'PROJECT_CREATE',
          decode(repeat('41', 32), 'hex'), decode(repeat('42', 32), 'hex'),
          'COMPLETED', 'PROJECT', ${fixture.project}, decode(repeat('43', 32), 'hex'),
          201, clock_timestamp() + interval '1 day'
        )`.execute(roundTrip.db);
      const down = await createMigrator(roundTrip.db).migrateDown();
      expect(down.error).toBeUndefined();
      const boundary = await sql<{
        createFunction: boolean;
        idempotencyProjectId: string;
        lifecycleColumn: boolean;
        projectCount: string;
      }>`select
        to_regprocedure('memoid.create_project(bytea,text,text,character varying,bytea,bytea,uuid,uuid)') is not null as "createFunction",
        exists (select 1 from information_schema.columns where table_schema = 'memoid' and table_name = 'projects' and column_name = 'lifecycle_state') as "lifecycleColumn",
        (select count(*)::text from memoid.projects where id = ${fixture.project}::uuid) as "projectCount",
        (select project_id::text from memoid.idempotency_records where action_key = 'PROJECT_CREATE') as "idempotencyProjectId"`.execute(
        roundTrip.db,
      );
      expect(boundary.rows[0]).toEqual({
        createFunction: false,
        idempotencyProjectId: fixture.project,
        lifecycleColumn: false,
        projectCount: "1",
      });
      expect(
        (await createMigrator(roundTrip.db).migrateTo("005_stage10d_workspace_project")).error,
      ).toBeUndefined();
      const restored = await sql<{
        count: string;
        idempotencyWorkspaceScoped: boolean;
        policy: string;
      }>`select
        (select count(*)::text from memoid.projects where id = ${fixture.project}::uuid) as count,
        (select policy from memoid.project_review_policy_versions where project_id = ${fixture.project}::uuid and version = 1) as policy,
        (select project_id is null from memoid.idempotency_records where action_key = 'PROJECT_CREATE') as "idempotencyWorkspaceScoped"`.execute(
        roundTrip.db,
      );
      expect(restored.rows[0]).toEqual({
        count: "1",
        idempotencyWorkspaceScoped: true,
        policy: "MANUAL",
      });
    } finally {
      await roundTrip.destroy();
    }
  });

  it("does not grant direct Project writes to the product role", async () => {
    const appUrl = new URL(isolated.connectionString);
    appUrl.username = "memoid_app";
    appUrl.password = "synthetic-app-password";
    const app = createDatabase(appUrl.toString(), 1);
    try {
      await expect(
        withSecurityTransaction(
          app,
          {
            accountId: "019c1234-1234-7123-8123-123456789abc",
            workspaceId: "019c1234-1234-7123-8123-123456789abd",
          },
          (trx) =>
            sql`insert into memoid.projects (workspace_id, display_name) values ('019c1234-1234-7123-8123-123456789abd', 'forbidden')`.execute(
              trx,
            ),
        ),
      ).rejects.toThrow();
    } finally {
      await app.destroy();
    }
  });
});
