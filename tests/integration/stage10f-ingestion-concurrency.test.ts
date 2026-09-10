import {
  createDatabase,
  migrateToLatest,
  withSecurityTransaction,
  type MemoidDatabase,
} from "@memoid/db";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const revision = (character: string) => character.repeat(40);

interface Fixture {
  accountId: string;
  workspaceId: string;
  projectId: string;
  sourceId: string;
  systemId: string;
  workerA: string;
  workerB: string;
}
interface Acquired {
  frontierUnitId: string;
  observationId: string;
  sequence: string;
  externalRevision: string | null;
  leaseToken: string;
}

suite("Stage 10F PostgreSQL ingestion concurrency", () => {
  let isolated: IsolatedTestDatabase;
  let app: Kysely<MemoidDatabase>;
  let repositorySequence = 900_000_000;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10f_ingestion");
    await migrateToLatest(isolated.db);
    const url = new URL(isolated.connectionString);
    url.username = "memoid_app";
    url.password = "synthetic-app-password";
    app = createDatabase(url.toString(), 8);
  });
  afterAll(async () => {
    await app.destroy();
    await isolated.destroy();
  }, 60_000);

  async function createFixture(label: string): Promise<Fixture> {
    const accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const workspaceId = (
      await sql<{
        id: string;
      }>`insert into memoid.workspaces (account_id) values (${accountId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const projectId = (
      await sql<{
        id: string;
      }>`insert into memoid.projects (workspace_id, display_name) values (${workspaceId}::uuid, ${`10F ${label}`}) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.project_review_policy_versions
      (workspace_id, project_id, version, policy, effective_at, changed_by_account_id)
      values (${workspaceId}::uuid, ${projectId}::uuid, 1, 'MANUAL', clock_timestamp(), ${accountId}::uuid)`.execute(
      isolated.db,
    );
    const sourceId = (
      await sql<{ id: string }>`insert into memoid.sources (workspace_id, project_id, source_kind)
      values (${workspaceId}::uuid, ${projectId}::uuid, 'GITHUB') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.github_source_connections (
      workspace_id, project_id, source_id, app_id, installation_id, account_id,
      repository_id, owner_login, repository_name, full_name, html_url, visibility,
      default_branch, connection_state, verified_at
    ) values (${workspaceId}::uuid, ${projectId}::uuid, ${sourceId}::uuid, '123', '456', '789',
      ${(repositorySequence++).toString()}, 'owner', 'repo', 'owner/repo',
      'https://github.com/owner/repo', 'PRIVATE', 'main', 'ACTIVE', clock_timestamp())`.execute(
      isolated.db,
    );
    const addActor = async (kind: string, reference: string) =>
      (
        await sql<{
          id: string;
        }>`insert into memoid.actors (workspace_id, actor_kind, actor_reference, display_label)
        values (${workspaceId}::uuid, ${kind}, ${reference}, ${reference}) returning id::text`.execute(
          isolated.db,
        )
      ).rows[0]!.id;
    return {
      accountId,
      workspaceId,
      projectId,
      sourceId,
      systemId: await addActor("MEMOID_SYSTEM", `system:${label}`),
      workerA: await addActor("MEMOID_WORKER", `worker:${label}:a`),
      workerB: await addActor("MEMOID_WORKER", `worker:${label}:b`),
    };
  }

  const scope = (f: Fixture, actorId: string) => ({
    accountId: f.accountId,
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    actorId,
  });
  const uuid = async () =>
    (await sql<{ id: string }>`select uuidv7()::text as id`.execute(isolated.db)).rows[0]!.id;

  async function schedule(f: Fixture, ref: string, target: string | null) {
    const correlationId = await uuid();
    return withSecurityTransaction(
      app,
      scope(f, f.systemId),
      async (trx) =>
        (
          await sql<{
            created: boolean;
            frontierUnitId: string;
            observationId: string;
            sequence: string;
          }>`select
        created, frontier_unit_id::text as "frontierUnitId", observation_id::text as "observationId",
        observation_sequence::text as sequence from memoid.schedule_source_observation(
          ${f.workspaceId}::uuid, ${f.projectId}::uuid, ${f.sourceId}::uuid, ${f.systemId}::uuid,
          'repository', ${ref}, ${target}, ${ref === "refs/heads/main"}, clock_timestamp(),
          ${correlationId}::uuid, null
        )`.execute(trx)
        ).rows[0]!,
    );
  }

  async function acquire(f: Fixture, ref: string, worker: string): Promise<Acquired | null> {
    return withSecurityTransaction(
      app,
      scope(f, worker),
      async (trx) =>
        (
          await sql<Acquired>`select frontier_unit_id::text as "frontierUnitId",
        observation_id::text as "observationId", observation_sequence::text as sequence,
        external_revision as "externalRevision", lease_token::text as "leaseToken"
        from memoid.acquire_source_ingestion(${f.workspaceId}::uuid, ${f.projectId}::uuid,
          ${f.sourceId}::uuid, ${ref}, ${worker}::uuid, 300)`.execute(trx)
        ).rows[0] ?? null,
    );
  }

  async function complete(f: Fixture, worker: string, acquired: Acquired, mode = "INITIAL_TREE") {
    return withSecurityTransaction(
      app,
      scope(f, worker),
      async (trx) =>
        (
          await sql<{ desired: string; followUp: boolean; ingested: string }>`select
        ingested_through::text as ingested, current_desired::text as desired,
        follow_up_required as "followUp" from memoid.complete_source_ingestion(
          ${f.workspaceId}::uuid, ${f.projectId}::uuid, ${f.sourceId}::uuid,
          ${acquired.frontierUnitId}::uuid, ${acquired.observationId}::uuid,
          ${worker}::uuid, ${acquired.leaseToken}::uuid, ${mode}, 0, 0, '{}'::jsonb
        )`.execute(trx)
        ).rows[0]!,
    );
  }

  it("deduplicates observations and references before atomically advancing ingestion", async () => {
    const f = await createFixture("dedupe");
    const first = await schedule(f, "refs/heads/main", revision("c"));
    const duplicate = await schedule(f, "refs/heads/main", revision("c"));
    expect(first).toMatchObject({ created: true, sequence: "1" });
    expect(duplicate).toMatchObject({ created: false, observationId: first.observationId });
    const acquired = (await acquire(f, "refs/heads/main", f.workerA))!;
    const insert = () =>
      withSecurityTransaction(app, scope(f, f.workerA), (trx) =>
        sql<{ id: string }>`select memoid.record_evidence_reference(
        ${f.workspaceId}::uuid, ${f.projectId}::uuid, ${f.sourceId}::uuid,
        ${acquired.frontierUnitId}::uuid, ${acquired.observationId}::uuid,
        ${f.workerA}::uuid, ${acquired.leaseToken}::uuid, 'FILE', ${revision("c")},
        'src/index.ts', null, ${revision("d")}, 12, ${Buffer.alloc(32, 7)}::bytea, null
      )::text as id`.execute(trx),
      );
    const [a, b] = await Promise.all([insert(), insert()]);
    expect(a.rows[0]?.id).toBe(b.rows[0]?.id);
    await expect(
      withSecurityTransaction(app, scope(f, f.workerA), (trx) =>
        sql`select memoid.record_evidence_reference(
          ${f.workspaceId}::uuid, ${f.projectId}::uuid, ${f.sourceId}::uuid,
          ${acquired.frontierUnitId}::uuid, ${acquired.observationId}::uuid,
          ${f.workerA}::uuid, ${acquired.leaseToken}::uuid, 'FILE', ${revision("c")},
          'src/index.ts', null, ${revision("d")}, 12, ${Buffer.alloc(32, 8)}::bytea, null
        )`.execute(trx),
      ),
    ).rejects.toThrow("EVIDENCE_REFERENCE_CONFLICT");
    expect(
      (
        await sql<{ count: string }>`select count(*)::text as count from memoid.evidence_references
      where source_observation_id = ${first.observationId}::uuid`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("1");
    expect(await complete(f, f.workerA, acquired)).toEqual({
      ingested: "1",
      desired: "1",
      followUp: false,
    });
    await expect(
      sql`update memoid.evidence_references set repository_path = 'changed.ts'
      where source_observation_id = ${first.observationId}::uuid`.execute(isolated.db),
    ).rejects.toThrow("immutable");
  });

  it("coalesces only an explicit contiguous range and preserves a concurrent desired update", async () => {
    const f = await createFixture("frontier");
    await schedule(f, "refs/heads/feature", revision("a"));
    await schedule(f, "refs/heads/feature", revision("b"));
    const third = await schedule(f, "refs/heads/feature", revision("c"));
    const acquired3 = (await acquire(f, "refs/heads/feature", f.workerA))!;
    await schedule(f, "refs/heads/feature", revision("d"));
    expect(await complete(f, f.workerA, acquired3)).toEqual({
      ingested: "3",
      desired: "4",
      followUp: true,
    });
    const dispositions = await sql<{
      disposition: string;
      sequence: string;
    }>`select observation_sequence::text as sequence, disposition
      from memoid.source_ingestion_dispositions where frontier_unit_id = ${third.frontierUnitId}::uuid order by observation_sequence`.execute(
      isolated.db,
    );
    expect(dispositions.rows).toEqual([
      { sequence: "1", disposition: "COALESCED" },
      { sequence: "2", disposition: "COALESCED" },
      { sequence: "3", disposition: "INGESTED" },
    ]);
    const acquired4 = (await acquire(f, "refs/heads/feature", f.workerB))!;
    await expect(complete(f, f.workerA, acquired3)).rejects.toThrow(/STALE|stale/u);
    expect(await complete(f, f.workerB, acquired4)).toEqual({
      ingested: "4",
      desired: "4",
      followUp: false,
    });
  });

  it("records default-ref changes and delete/recreate as distinct ordered observations", async () => {
    const f = await createFixture("ref-semantics");
    const initial = await schedule(f, "refs/heads/feature", revision("a"));
    const sameRevisionNowDefault = await withSecurityTransaction(
      app,
      scope(f, f.systemId),
      async (trx) =>
        (
          await sql<{ created: boolean; sequence: string }>`select created,
            observation_sequence::text as sequence from memoid.schedule_source_observation(
              ${f.workspaceId}::uuid, ${f.projectId}::uuid, ${f.sourceId}::uuid,
              ${f.systemId}::uuid, 'repository', 'refs/heads/feature', ${revision("a")}, true,
              clock_timestamp(), ${await uuid()}::uuid, null
            )`.execute(trx)
        ).rows[0]!,
    );
    expect(initial.sequence).toBe("1");
    expect(sameRevisionNowDefault).toEqual({ created: true, sequence: "2" });
    const deleted = await schedule(f, "refs/heads/feature", null);
    const deletedLease = (await acquire(f, "refs/heads/feature", f.workerA))!;
    expect(deletedLease.externalRevision).toBeNull();
    expect(await complete(f, f.workerA, deletedLease, "REF_DELETED")).toMatchObject({
      ingested: deleted.sequence,
    });
    const recreated = await schedule(f, "refs/heads/feature", revision("b"));
    expect(Number(recreated.sequence)).toBe(Number(deleted.sequence) + 1);
  });

  it("leases to exactly one concurrent worker and fences an expired owner", async () => {
    const f = await createFixture("lease");
    await schedule(f, "refs/heads/main", revision("c"));
    const raced = await Promise.all([
      acquire(f, "refs/heads/main", f.workerA),
      acquire(f, "refs/heads/main", f.workerB),
    ]);
    expect(raced.filter((value) => value !== null)).toHaveLength(1);
    const first = raced.find((value) => value !== null)!;
    const firstWorker = raced[0] ? f.workerA : f.workerB;
    const replacementWorker = firstWorker === f.workerA ? f.workerB : f.workerA;
    await sql`update memoid.processing_units set lease_expires_at = clock_timestamp() - interval '1 second'
      where lease_token = ${first.leaseToken}::uuid`.execute(isolated.db);
    const reclaimed = (await acquire(f, "refs/heads/main", replacementWorker))!;
    await expect(complete(f, firstWorker, first)).rejects.toThrow(/STALE|stale/u);
    expect(await complete(f, replacementWorker, reclaimed)).toMatchObject({ ingested: "1" });
  });

  it("fails closed for a foreign Project and access loss during processing", async () => {
    const owner = await createFixture("owner");
    const foreign = await createFixture("foreign");
    const scheduled = await schedule(owner, "refs/heads/main", revision("c"));
    const acquired = (await acquire(owner, "refs/heads/main", owner.workerA))!;
    const invisible = await withSecurityTransaction(app, scope(foreign, foreign.workerA), (trx) =>
      sql<{ count: string }>`select count(*)::text as count from memoid.source_observations
        where id = ${scheduled.observationId}::uuid`.execute(trx),
    );
    expect(invisible.rows[0]?.count).toBe("0");
    const correlationId = await uuid();
    await expect(
      withSecurityTransaction(app, scope(foreign, foreign.systemId), (trx) =>
        sql`select * from memoid.schedule_source_observation(
        ${foreign.workspaceId}::uuid, ${foreign.projectId}::uuid, ${owner.sourceId}::uuid,
        ${foreign.systemId}::uuid, 'repository', 'refs/heads/main', ${revision("d")}, true,
        clock_timestamp(), ${correlationId}::uuid, null)`.execute(trx),
      ),
    ).rejects.toThrow("SOURCE_UNAVAILABLE");
    await sql`update memoid.github_source_connections set connection_state = 'REPOSITORY_ACCESS_REMOVED'
      where source_id = ${owner.sourceId}::uuid`.execute(isolated.db);
    await expect(complete(owner, owner.workerA, acquired)).rejects.toThrow("SOURCE_UNAVAILABLE");
    expect(
      (
        await sql<{ ingested: string | null }>`select ingested_sequence::text as ingested
      from memoid.source_frontier_states where frontier_unit_id = ${scheduled.frontierUnitId}::uuid`.execute(
          isolated.db,
        )
      ).rows[0]?.ingested,
    ).toBeNull();
  });
});
