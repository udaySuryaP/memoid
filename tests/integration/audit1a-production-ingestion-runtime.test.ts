import { migrateToLatest } from "@memoid/db";
import { createBoss, enqueueSourceIngestionSignal, sourceIngestionQueue } from "@memoid/jobs";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startProductionSourceIngestionRuntime } from "../../apps/worker/src/runtime.js";
import {
  PostgresSourceIngestionRepository,
  PostgresSourceIngestionRuntimeRepository,
} from "../../packages/adapters/src/source-ingestion.js";
import {
  SourceIngestionService,
  type SourceIngestionProviderPort,
} from "../../packages/application/src/source-ingestion.js";
import { evidenceReferenceDraft } from "../../packages/domain/src/index.js";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("AUDIT-1A production ingestion runtime", () => {
  let isolated: IsolatedTestDatabase;
  let appUrl: string;
  let repository: PostgresSourceIngestionRepository;
  let runtimeRepository: PostgresSourceIngestionRuntimeRepository;
  let boss: ReturnType<typeof createBoss>;
  const repositoryId = "910000001";
  let revision = "a".repeat(40);
  let transientObservationFailures = 0;
  let sourceId: string;

  const provider: SourceIngestionProviderPort = {
    async observeRef(_connection, refKey) {
      if (transientObservationFailures > 0) {
        transientObservationFailures -= 1;
        throw new Error("synthetic transient provider failure");
      }
      return {
        externalRevision: revision,
        isDefaultRef: refKey === "refs/heads/main",
        observedAt: new Date(),
      };
    },
    async extractEvidence(input) {
      return {
        references: [
          evidenceReferenceDraft({
            kind: "FILE",
            repositoryRevision: input.targetRevision,
            path: "packages/domain/src/index.ts",
            previousPath: null,
            providerObjectId: input.targetRevision,
            byteSize: 12,
            contentSha256: Buffer.alloc(32, input.targetRevision === revision ? 1 : 2),
            structuralLocator: null,
          }),
        ],
        classifications: {},
        candidateCount: 1,
        fetchedBytes: 12,
        mode: input.baseRevision === null ? "INITIAL_TREE" : "INCREMENTAL_COMPARE",
      };
    },
  };

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "audit1a_runtime");
    await migrateToLatest(isolated.db);
    const url = new URL(isolated.connectionString);
    url.username = "memoid_app";
    url.password = "synthetic-app-password";
    appUrl = url.toString();
    const accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const workspaceId = (
      await sql<{ id: string }>`insert into memoid.workspaces(account_id)
        values(${accountId}::uuid) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const projectId = (
      await sql<{ id: string }>`insert into memoid.projects(workspace_id,display_name)
        values(${workspaceId}::uuid,'AUDIT-1A runtime') returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    sourceId = (
      await sql<{ id: string }>`insert into memoid.sources(workspace_id,project_id,source_kind)
        values(${workspaceId}::uuid,${projectId}::uuid,'GITHUB') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.github_source_connections(
      workspace_id,project_id,source_id,app_id,installation_id,account_id,repository_id,
      owner_login,repository_name,full_name,html_url,visibility,default_branch,connection_state,verified_at
    ) values(${workspaceId}::uuid,${projectId}::uuid,${sourceId}::uuid,'123','456','789',${repositoryId},
      'owner','repo','owner/repo','https://github.com/owner/repo','PRIVATE','main','ACTIVE',clock_timestamp())`.execute(
      isolated.db,
    );
    repository = new PostgresSourceIngestionRepository(appUrl, 1);
    runtimeRepository = new PostgresSourceIngestionRuntimeRepository(appUrl, 1);
    boss = createBoss(isolated.connectionString, 2);
    await boss.start();
    await startProductionSourceIngestionRuntime({
      boss,
      appId: "123",
      repository: runtimeRepository,
      service: new SourceIngestionService(repository, provider),
      logger: { info() {} },
    });
  });

  afterAll(async () => {
    await boss?.stop({ graceful: true, timeout: 5_000 });
    await repository?.close();
    await runtimeRepository?.close();
    await isolated?.destroy();
  }, 60_000);

  it("executes startup recovery and webhook enqueue through the production worker", async () => {
    await vi.waitFor(
      async () => {
        const row = (
          await sql<{ evidence: string; ingested: string }>`select
            (select count(*)::text from memoid.evidence_references where source_id=${sourceId}::uuid) evidence,
            (select max(ingested_sequence)::text from memoid.source_frontier_states) ingested`.execute(
            isolated.db,
          )
        ).rows[0]!;
        expect(row).toEqual({ evidence: "1", ingested: "1" });
      },
      { timeout: 20_000, interval: 250 },
    );

    revision = "b".repeat(40);
    await enqueueSourceIngestionSignal(boss, {
      kind: "SOURCE_INGESTION_SIGNAL",
      trigger: "GITHUB_WEBHOOK",
      appId: "123",
      installationId: "456",
      repositoryId,
      refKey: "refs/heads/main",
      deliveryId: "delivery-runtime-proof",
    });
    await vi.waitFor(
      async () => {
        const row = (
          await sql<{ evidence: string; observed: string; ingested: string }>`select
            (select count(*)::text from memoid.evidence_references where source_id=${sourceId}::uuid) evidence,
            (select max(observed_sequence)::text from memoid.source_frontier_states) observed,
            (select max(ingested_sequence)::text from memoid.source_frontier_states) ingested`.execute(
            isolated.db,
          )
        ).rows[0]!;
        expect(row).toEqual({ evidence: "2", observed: "2", ingested: "2" });
      },
      { timeout: 20_000, interval: 250 },
    );
  });

  it("uses pg-boss retry after a transient failure without advancing the frontier early", async () => {
    revision = "c".repeat(40);
    transientObservationFailures = 1;
    const signal = {
      kind: "SOURCE_INGESTION_SIGNAL" as const,
      trigger: "GITHUB_WEBHOOK" as const,
      appId: "123",
      installationId: "456",
      repositoryId,
      refKey: "refs/heads/main",
      deliveryId: "delivery-real-pg-boss-retry",
    };
    const jobId = await boss.send(sourceIngestionQueue, signal, {
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: false,
      singletonKey: `github:${signal.deliveryId}`,
      singletonSeconds: 86_400,
    });
    expect(jobId).toBeTruthy();

    await vi.waitFor(() => expect(transientObservationFailures).toBe(0), {
      timeout: 10_000,
      interval: 25,
    });
    const afterFailure = (
      await sql<{ evidence: string; observed: string; ingested: string }>`select
        (select count(*)::text from memoid.evidence_references where source_id=${sourceId}::uuid) evidence,
        (select max(observed_sequence)::text from memoid.source_frontier_states) observed,
        (select max(ingested_sequence)::text from memoid.source_frontier_states) ingested`.execute(
        isolated.db,
      )
    ).rows[0]!;
    expect(afterFailure).toEqual({ evidence: "2", observed: "2", ingested: "2" });

    await vi.waitFor(
      async () => {
        const row = (
          await sql<{
            dispositions: string;
            evidence: string;
            observed: string;
            ingested: string;
          }>`select
            (select count(*)::text from memoid.source_ingestion_dispositions) dispositions,
            (select count(*)::text from memoid.evidence_references
              where source_id=${sourceId}::uuid) evidence,
            (select max(observed_sequence)::text from memoid.source_frontier_states) observed,
            (select max(ingested_sequence)::text from memoid.source_frontier_states) ingested`.execute(
            isolated.db,
          )
        ).rows[0]!;
        expect(row).toEqual({ dispositions: "3", evidence: "3", observed: "3", ingested: "3" });
      },
      { timeout: 20_000, interval: 100 },
    );
    const completedJob = await boss.getJobById(sourceIngestionQueue, jobId!);
    expect(completedJob).toMatchObject({ state: "completed", retryCount: 1 });
    await expect(enqueueSourceIngestionSignal(boss, signal)).resolves.toBeNull();
    const duplicateSafe = (
      await sql<{ dispositions: string; evidence: string; ingested: string }>`select
        (select count(*)::text from memoid.source_ingestion_dispositions) dispositions,
        (select count(*)::text from memoid.evidence_references
          where source_id=${sourceId}::uuid) evidence,
        (select max(ingested_sequence)::text from memoid.source_frontier_states) ingested`.execute(
        isolated.db,
      )
    ).rows[0]!;
    expect(duplicateSafe).toEqual({ dispositions: "3", evidence: "3", ingested: "3" });
  });

  it("emits scheduled recovery through pg-boss into the production ingestion worker", async () => {
    const scheduleKey = "source-ingestion-recovery/123";
    expect(await boss.getSchedules(sourceIngestionQueue, scheduleKey)).toEqual([
      expect.objectContaining({
        name: sourceIngestionQueue,
        key: scheduleKey,
        cron: "*/5 * * * *",
        data: {
          kind: "SOURCE_INGESTION_SIGNAL",
          trigger: "RECOVERY_SCAN",
          appId: "123",
        },
      }),
    ]);

    revision = "d".repeat(40);
    await boss.schedule(
      sourceIngestionQueue,
      "* * * * *",
      { kind: "SOURCE_INGESTION_SIGNAL", trigger: "RECOVERY_SCAN", appId: "123" },
      { tz: "UTC", key: scheduleKey },
    );
    await vi.waitFor(
      async () => {
        const row = (
          await sql<{
            dispositions: string;
            evidence: string;
            observed: string;
            ingested: string;
          }>`select
              (select count(*)::text from memoid.source_ingestion_dispositions) dispositions,
              (select count(*)::text from memoid.evidence_references
                where source_id=${sourceId}::uuid) evidence,
              (select max(observed_sequence)::text from memoid.source_frontier_states) observed,
              (select max(ingested_sequence)::text from memoid.source_frontier_states) ingested`.execute(
            isolated.db,
          )
        ).rows[0]!;
        expect(row).toEqual({ dispositions: "4", evidence: "4", observed: "4", ingested: "4" });
      },
      { timeout: 45_000, interval: 250 },
    );
  }, 50_000);
});
