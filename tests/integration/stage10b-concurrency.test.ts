import { migrateToLatest, type MemoidDatabase } from "@memoid/db";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

interface Scope {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

const hash = (byte: number): Buffer => Buffer.alloc(32, byte);

async function uuidv7(db: Kysely<MemoidDatabase>): Promise<string> {
  return (await sql<{ id: string }>`select uuidv7()::text as id`.execute(db)).rows[0]!.id;
}

async function createProject(db: Kysely<MemoidDatabase>): Promise<Scope> {
  const account = await sql<{
    id: string;
  }>`insert into memoid.accounts default values returning id::text`.execute(db);
  const workspace = await sql<{ id: string }>`insert into memoid.workspaces (account_id)
    values (${account.rows[0]!.id}::uuid) returning id::text`.execute(db);
  const project = await sql<{ id: string }>`insert into memoid.projects (workspace_id)
    values (${workspace.rows[0]!.id}::uuid) returning id::text`.execute(db);
  return {
    accountId: account.rows[0]!.id,
    workspaceId: workspace.rows[0]!.id,
    projectId: project.rows[0]!.id,
  };
}

async function createAdditionalProject(db: Kysely<MemoidDatabase>, scope: Scope): Promise<Scope> {
  const project = await sql<{ id: string }>`insert into memoid.projects (workspace_id)
    values (${scope.workspaceId}::uuid) returning id::text`.execute(db);
  return { ...scope, projectId: project.rows[0]!.id };
}

async function addActor(
  db: Kysely<MemoidDatabase>,
  scope: Scope,
  kind: string,
  reference: string,
  label = reference,
): Promise<string> {
  return (
    await sql<{ id: string }>`insert into memoid.actors
      (workspace_id, actor_kind, actor_reference, display_label)
      values (${scope.workspaceId}::uuid, ${kind}, ${reference}, ${label}) returning id::text`.execute(
      db,
    )
  ).rows[0]!.id;
}

async function addOperation(
  db: Kysely<MemoidDatabase>,
  scope: Scope,
  actorId: string,
  kind = "TEST_OPERATION",
  maxAttempts = 3,
  correlationId?: string,
  causationId?: string | null,
): Promise<{ correlationId: string; id: string }> {
  const inserted = await sql<{ correlationId: string; id: string }>`insert into memoid.operations
    (workspace_id, project_id, initiating_actor_id, operation_kind, max_attempts, correlation_id, causation_id)
    values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid, ${kind}, ${maxAttempts},
      coalesce(${correlationId ?? null}::uuid, uuidv7()), ${causationId ?? null}::uuid)
    returning id::text, correlation_id::text as "correlationId"`.execute(db);
  return inserted.rows[0]!;
}

async function claimIdempotency(
  db: Kysely<MemoidDatabase>,
  scope: Scope,
  actorId: string,
  keyHash: Buffer,
  requestHash: Buffer,
  correlationId: string,
) {
  return (
    await sql<{
      activeClaimToken: string | null;
      claimOutcome: string;
      idempotencyRecordId: string;
      recordState: string;
      stableResultReference: string | null;
    }>`select claim_outcome as "claimOutcome", idempotency_record_id::text as "idempotencyRecordId",
      active_claim_token::text as "activeClaimToken", record_state as "recordState",
      stable_result_reference as "stableResultReference"
      from memoid.claim_idempotency(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
        'TEST_ACTION', ${keyHash}, ${requestHash}, ${correlationId}::uuid, null, 60,
        clock_timestamp() + interval '1 day'
      )`.execute(db)
  ).rows[0]!;
}

suite("Stage 10B PostgreSQL concurrency and integrity", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10b_concurrency");
    await migrateToLatest(isolated.db);
  });

  afterAll(async () => isolated.destroy(), 60_000);

  it("derives immutable Audit Event attribution snapshots and rejects cross-Project/correlation forgery", async () => {
    const scope = await createProject(isolated.db);
    const actorId = await addActor(
      isolated.db,
      scope,
      "MEMOID_SYSTEM",
      "memoid:policy",
      "Memoid policy engine",
    );
    const operation = await addOperation(isolated.db, scope, actorId);
    const event = await sql<{ id: string }>`insert into memoid.audit_events (
      workspace_id, project_id, actor_id, actor_kind_snapshot, actor_reference_snapshot,
      actor_label_snapshot, category, event_type, occurred_at, target_type, target_key,
      correlation_id, causation_id, operation_id, outcome, metadata
    ) values (
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
      'HUMAN', 'forged', 'forged', 'OPERATION', 'OPERATION_CREATED', clock_timestamp(),
      'OPERATION', ${operation.id}, ${operation.correlationId}::uuid, ${operation.id}::uuid,
      ${operation.id}::uuid, 'SUCCESS', '{"STATE_FROM":"NONE","STATE_TO":"PENDING"}'::jsonb
    ) returning id::text`.execute(isolated.db);
    const snapshot = await sql<{
      actorKind: string;
      actorLabel: string;
      actorReference: string;
    }>`select actor_kind_snapshot as "actorKind", actor_reference_snapshot as "actorReference",
      actor_label_snapshot as "actorLabel" from memoid.audit_events where id = ${event.rows[0]!.id}::uuid`.execute(
      isolated.db,
    );
    expect(snapshot.rows[0]).toEqual({
      actorKind: "MEMOID_SYSTEM",
      actorReference: "memoid:policy",
      actorLabel: "Memoid policy engine",
    });
    await expect(
      sql`update memoid.audit_events set target_key = 'changed' where id = ${event.rows[0]!.id}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable history row");
    await expect(
      sql`delete from memoid.audit_events where id = ${event.rows[0]!.id}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable history row");
    await expect(
      sql`update memoid.actors set display_label = 'rewritten' where id = ${actorId}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable history row");
    const other = await createAdditionalProject(isolated.db, scope);
    const wrongCorrelation = await uuidv7(isolated.db);
    await expect(
      sql`insert into memoid.audit_events (
      workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type, target_key,
      correlation_id, operation_id, outcome
    ) values (${scope.workspaceId}::uuid, ${other.projectId}::uuid, ${actorId}::uuid,
      'OPERATION', 'FORGED_LINK', clock_timestamp(), 'OPERATION', 'other',
      ${operation.correlationId}::uuid, ${operation.id}::uuid, 'DENIED')`.execute(isolated.db),
    ).rejects.toThrow();
    await expect(
      sql`insert into memoid.audit_events (
      workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type, target_key,
      correlation_id, operation_id, outcome
    ) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
      'OPERATION', 'FORGED_CORRELATION', clock_timestamp(), 'OPERATION', ${operation.id},
      ${wrongCorrelation}::uuid, ${operation.id}::uuid, 'DENIED')`.execute(isolated.db),
    ).rejects.toThrow("correlation mismatch");
  });

  it("rejects secret-bearing or unbounded metadata and exposes no raw payload column", async () => {
    const scope = await createProject(isolated.db);
    const actorId = await addActor(isolated.db, scope, "HUMAN", "account:test-user");
    const correlationId = await uuidv7(isolated.db);
    await expect(
      sql`insert into memoid.audit_events (
      workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type,
      target_key, correlation_id, outcome, metadata
    ) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
      'SECURITY', 'UNSAFE_METADATA', clock_timestamp(), 'PROJECT', ${scope.projectId},
      ${correlationId}::uuid, 'FAILURE', '{"ACCESS_TOKEN":"synthetic"}'::jsonb)`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
    await expect(
      sql`insert into memoid.audit_events (
      workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type,
      target_key, correlation_id, outcome, metadata
    ) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
      'SECURITY', 'NESTED_METADATA', clock_timestamp(), 'PROJECT', ${scope.projectId},
      ${correlationId}::uuid, 'FAILURE', '{"SAFE":{"NESTED":true}}'::jsonb)`.execute(isolated.db),
    ).rejects.toThrow();
    const forbiddenColumns = await sql<{ count: string }>`select count(*)::text as count
      from information_schema.columns where table_schema = 'memoid'
        and table_name in ('audit_events', 'provider_event_receipts')
        and column_name in ('raw_payload', 'payload', 'prompt', 'transcript', 'exception')`.execute(
      isolated.db,
    );
    expect(forbiddenColumns.rows[0]?.count).toBe("0");
  });

  it("deduplicates provider receipts by canonical scope without semantic mutation", async () => {
    const scope = await createProject(isolated.db);
    const sourceActor = await addActor(isolated.db, scope, "SOURCE_SYSTEM", "provider:generic");
    const correlationId = await uuidv7(isolated.db);
    const register = (project: Scope, scopeKey: string, payloadHash: Buffer) =>
      sql<{ outcome: string; receiptId: string }>`select registration_outcome as outcome,
        receipt_id::text as "receiptId" from memoid.register_provider_event_receipt(
          ${project.workspaceId}::uuid, ${project.projectId}::uuid, ${sourceActor}::uuid,
          'generic', ${scopeKey}, 'delivery-42', ${payloadHash}, 'UNVALIDATED',
          clock_timestamp() - interval '2 hours', clock_timestamp(), ${correlationId}::uuid,
          null, '{"EVENT_TYPE":"push"}'::jsonb
        )`.execute(isolated.db);
    const before = await sql<{ reviewed: string; sources: string; working: string }>`select
      (select count(*)::text from memoid.sources) as sources,
      (select count(*)::text from memoid.working_context_items) as working,
      (select count(*)::text from memoid.context_records) as reviewed`.execute(isolated.db);
    const first = (await register(scope, "source:primary", hash(1))).rows[0]!;
    const duplicate = (await register(scope, "source:primary", hash(1))).rows[0]!;
    const conflict = (await register(scope, "source:primary", hash(2))).rows[0]!;
    const separate = (await register(scope, "source:secondary", hash(2))).rows[0]!;
    expect(first.outcome).toBe("CREATED");
    expect(duplicate).toEqual({ outcome: "DUPLICATE", receiptId: first.receiptId });
    expect(conflict).toEqual({ outcome: "CONFLICT", receiptId: first.receiptId });
    expect(separate.outcome).toBe("CREATED");
    expect(separate.receiptId).not.toBe(first.receiptId);
    const delayedReceipt = await sql<{
      providerOccurredAt: Date;
      receivedAt: Date;
    }>`select provider_occurred_at as "providerOccurredAt", received_at as "receivedAt"
      from memoid.provider_event_receipts where id = ${first.receiptId}::uuid`.execute(isolated.db);
    expect(delayedReceipt.rows[0]!.providerOccurredAt.getTime()).toBeLessThan(
      delayedReceipt.rows[0]!.receivedAt.getTime(),
    );
    await expect(
      sql`select * from memoid.register_provider_event_receipt(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${sourceActor}::uuid,
        'generic', 'source:bounded', 'delivery-short-hash', ${Buffer.alloc(31)}, 'UNVALIDATED',
        clock_timestamp(), clock_timestamp(), ${correlationId}::uuid, null, '{}'::jsonb
      )`.execute(isolated.db),
    ).rejects.toThrow();
    await expect(
      sql`select * from memoid.register_provider_event_receipt(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${sourceActor}::uuid,
        'generic', 'source:bounded', 'delivery-unsafe-metadata', ${hash(3)}, 'UNVALIDATED',
        clock_timestamp(), clock_timestamp(), ${correlationId}::uuid, null,
        '{"RAW_PAYLOAD":"forbidden"}'::jsonb
      )`.execute(isolated.db),
    ).rejects.toThrow();
    const after = await sql<{ reviewed: string; sources: string; working: string }>`select
      (select count(*)::text from memoid.sources) as sources,
      (select count(*)::text from memoid.working_context_items) as working,
      (select count(*)::text from memoid.context_records) as reviewed`.execute(isolated.db);
    expect(after.rows[0]).toEqual(before.rows[0]);
    await sql`update memoid.provider_event_receipts set disposition = 'FAILED_RETRYABLE',
      next_attempt_at = clock_timestamp() + interval '1 minute', attempt_count = 1,
      failure_code = 'PROVIDER_UNAVAILABLE' where id = ${first.receiptId}::uuid`.execute(
      isolated.db,
    );
    await sql`update memoid.provider_event_receipts set disposition = 'PROCESSING',
      next_attempt_at = null, attempt_count = 2 where id = ${first.receiptId}::uuid`.execute(
      isolated.db,
    );
    await sql`update memoid.provider_event_receipts set disposition = 'PROCESSED'
      where id = ${first.receiptId}::uuid`.execute(isolated.db);
    expect(
      (
        await sql<{
          count: string;
        }>`select count(*)::text as count from memoid.provider_event_receipts
      where provider_key = 'generic' and external_delivery_id = 'delivery-42'`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("2");
  });

  it("gives one concurrent idempotency claimant, conflicts on another request, and replays completion", async () => {
    const scope = await createProject(isolated.db);
    const actorId = await addActor(isolated.db, scope, "INTEGRATION", "integration:test");
    const correlationId = await uuidv7(isolated.db);
    const claims = await Promise.all([
      claimIdempotency(isolated.db, scope, actorId, hash(10), hash(11), correlationId),
      claimIdempotency(isolated.db, scope, actorId, hash(10), hash(11), correlationId),
    ]);
    expect(claims.filter((claim) => claim.claimOutcome === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.claimOutcome === "IN_PROGRESS")).toHaveLength(1);
    const winner = claims.find((claim) => claim.claimOutcome === "CLAIMED")!;
    const conflict = await claimIdempotency(
      isolated.db,
      scope,
      actorId,
      hash(10),
      hash(12),
      correlationId,
    );
    expect(conflict.claimOutcome).toBe("CONFLICT");
    await sql`select memoid.finish_idempotency(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${winner.idempotencyRecordId}::uuid,
      ${winner.activeClaimToken}::uuid, 'COMPLETED', 'OPERATION_HANDLE', 'operation:test-1',
      null, ${hash(13)}, 202, '{"SAFE_RESULT":"accepted"}'::jsonb, null, null
    )`.execute(isolated.db);
    const replay = await claimIdempotency(
      isolated.db,
      scope,
      actorId,
      hash(10),
      hash(11),
      correlationId,
    );
    expect(replay).toMatchObject({
      claimOutcome: "REPLAY",
      stableResultReference: "operation:test-1",
    });
    const otherProject = await createAdditionalProject(isolated.db, scope);
    const separated = await claimIdempotency(
      isolated.db,
      otherProject,
      actorId,
      hash(10),
      hash(11),
      await uuidv7(isolated.db),
    );
    expect(separated.claimOutcome).toBe("CLAIMED");
  });

  it("reclaims expired/retryable idempotency claims and keeps terminal failure stable", async () => {
    const scope = await createProject(isolated.db);
    const actorId = await addActor(isolated.db, scope, "DEVELOPER_CLIENT", "developer:test");
    const correlationId = await uuidv7(isolated.db);
    const first = await claimIdempotency(
      isolated.db,
      scope,
      actorId,
      hash(14),
      hash(15),
      correlationId,
    );
    await sql`select memoid.finish_idempotency(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${first.idempotencyRecordId}::uuid,
      ${first.activeClaimToken}::uuid, 'FAILED_RETRYABLE', null, null, null, null, null,
      '{"RETRY_CLASS":"TRANSIENT"}'::jsonb, 'TRANSIENT_PROVIDER', clock_timestamp() + interval '1 minute'
    )`.execute(isolated.db);
    await sql`update memoid.idempotency_records set next_retry_at = clock_timestamp() - interval '1 second'
      where id = ${first.idempotencyRecordId}::uuid`.execute(isolated.db);
    const retry = await claimIdempotency(
      isolated.db,
      scope,
      actorId,
      hash(14),
      hash(15),
      correlationId,
    );
    expect(retry.claimOutcome).toBe("RETRY_CLAIMED");
    await expect(
      sql`select memoid.finish_idempotency(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${first.idempotencyRecordId}::uuid,
      ${first.activeClaimToken}::uuid, 'FAILED_TERMINAL', null, null, null, null, null,
      '{}'::jsonb, 'STALE_OWNER', null
    )`.execute(isolated.db),
    ).rejects.toThrow("stale idempotency claim");
    await sql`select memoid.finish_idempotency(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${retry.idempotencyRecordId}::uuid,
      ${retry.activeClaimToken}::uuid, 'FAILED_TERMINAL', null, null, null, null, null,
      '{"FAILURE_CLASS":"PERMANENT"}'::jsonb, 'PERMANENT_FAILURE', null
    )`.execute(isolated.db);
    expect(
      (await claimIdempotency(isolated.db, scope, actorId, hash(14), hash(15), correlationId))
        .claimOutcome,
    ).toBe("TERMINAL_FAILURE");

    const expiring = await claimIdempotency(
      isolated.db,
      scope,
      actorId,
      hash(16),
      hash(17),
      correlationId,
    );
    await sql`update memoid.idempotency_records set claim_expires_at = clock_timestamp() - interval '1 second'
      where id = ${expiring.idempotencyRecordId}::uuid`.execute(isolated.db);
    const reclaimed = await claimIdempotency(
      isolated.db,
      scope,
      actorId,
      hash(16),
      hash(17),
      correlationId,
    );
    expect(reclaimed.claimOutcome).toBe("RETRY_CLAIMED");
    expect(reclaimed.activeClaimToken).not.toBe(expiring.activeClaimToken);
  });

  it("propagates one opaque correlation across receipt, Operation, and Audit Event", async () => {
    const scope = await createProject(isolated.db);
    const sourceActor = await addActor(isolated.db, scope, "SOURCE_SYSTEM", "provider:correlation");
    const worker = await addActor(isolated.db, scope, "MEMOID_WORKER", "worker:correlation");
    const correlationId = await uuidv7(isolated.db);
    const receipt = await sql<{ id: string }>`select receipt_id::text as id
      from memoid.register_provider_event_receipt(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${sourceActor}::uuid,
        'generic', 'source:correlation', 'delivery-correlation', ${hash(18)}, 'AUTHENTICATED',
        clock_timestamp(), clock_timestamp(), ${correlationId}::uuid, null, '{}'::jsonb
      )`.execute(isolated.db);
    const operation = await addOperation(
      isolated.db,
      scope,
      worker,
      "RECEIPT_PROCESSING",
      3,
      correlationId,
      receipt.rows[0]!.id,
    );
    await sql`update memoid.provider_event_receipts set operation_id = ${operation.id}::uuid
      where id = ${receipt.rows[0]!.id}::uuid`.execute(isolated.db);
    const event = await sql<{ id: string }>`insert into memoid.audit_events (
      workspace_id, project_id, actor_id, category, event_type, occurred_at, target_type,
      target_key, correlation_id, causation_id, operation_id, provider_event_receipt_id, outcome
    ) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${worker}::uuid,
      'INTEGRATION', 'RECEIPT_OPERATION_CREATED', clock_timestamp(), 'PROVIDER_RECEIPT',
      ${receipt.rows[0]!.id}, ${correlationId}::uuid, ${operation.id}::uuid,
      ${operation.id}::uuid, ${receipt.rows[0]!.id}::uuid, 'SUCCESS') returning id::text`.execute(
      isolated.db,
    );
    const chain = await sql<{
      auditCorrelation: string;
      operationCorrelation: string;
      receiptCorrelation: string;
    }>`select
      a.correlation_id::text as "auditCorrelation", o.correlation_id::text as "operationCorrelation",
      r.correlation_id::text as "receiptCorrelation"
      from memoid.audit_events a join memoid.operations o on o.id = a.operation_id
      join memoid.provider_event_receipts r on r.id = a.provider_event_receipt_id
      where a.id = ${event.rows[0]!.id}::uuid`.execute(isolated.db);
    expect(chain.rows[0]).toEqual({
      auditCorrelation: correlationId,
      operationCorrelation: correlationId,
      receiptCorrelation: correlationId,
    });
  });

  it("rolls back claim, mutation, and result together across a simulated crash", async () => {
    const scope = await createProject(isolated.db);
    const actorId = await addActor(isolated.db, scope, "HUMAN", "account:crash-test");
    const correlationId = await uuidv7(isolated.db);
    await expect(
      isolated.db.transaction().execute(async (trx) => {
        const claim = await claimIdempotency(
          trx,
          scope,
          actorId,
          hash(20),
          hash(21),
          correlationId,
        );
        await sql`insert into memoid.audit_events (
          workspace_id, project_id, actor_id, category, event_type, occurred_at,
          target_type, target_key, correlation_id, idempotency_record_id, outcome
        ) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
          'DATA_INTEGRITY', 'SEMANTIC_MUTATION', clock_timestamp(), 'TEST_EFFECT', 'crash-once',
          ${correlationId}::uuid, ${claim.idempotencyRecordId}::uuid, 'SUCCESS')`.execute(trx);
        throw new Error("simulated process crash before commit");
      }),
    ).rejects.toThrow("simulated process crash");
    const rolledBack = await sql<{ audits: string; records: string }>`select
      (select count(*)::text from memoid.idempotency_records where project_id = ${scope.projectId}::uuid) as records,
      (select count(*)::text from memoid.audit_events where project_id = ${scope.projectId}::uuid and target_key = 'crash-once') as audits`.execute(
      isolated.db,
    );
    expect(rolledBack.rows[0]).toEqual({ records: "0", audits: "0" });
    await isolated.db.transaction().execute(async (trx) => {
      const claim = await claimIdempotency(trx, scope, actorId, hash(20), hash(21), correlationId);
      expect(claim.claimOutcome).toBe("CLAIMED");
      await sql`insert into memoid.audit_events (
        workspace_id, project_id, actor_id, category, event_type, occurred_at,
        target_type, target_key, correlation_id, idempotency_record_id, outcome
      ) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${actorId}::uuid,
        'DATA_INTEGRITY', 'SEMANTIC_MUTATION', clock_timestamp(), 'TEST_EFFECT', 'crash-once',
        ${correlationId}::uuid, ${claim.idempotencyRecordId}::uuid, 'SUCCESS')`.execute(trx);
      await sql`select memoid.finish_idempotency(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${claim.idempotencyRecordId}::uuid,
        ${claim.activeClaimToken}::uuid, 'COMPLETED', 'SAFE_REFERENCE', 'effect:crash-once',
        null, ${hash(22)}, 200, '{}'::jsonb, null, null
      )`.execute(trx);
    });
    const committed = await sql<{ audits: string; records: string }>`select
      (select count(*)::text from memoid.idempotency_records where project_id = ${scope.projectId}::uuid and state = 'COMPLETED') as records,
      (select count(*)::text from memoid.audit_events where project_id = ${scope.projectId}::uuid and target_key = 'crash-once') as audits`.execute(
      isolated.db,
    );
    expect(committed.rows[0]).toEqual({ records: "1", audits: "1" });
  });

  it("leases an Operation to one worker, reclaims expiry, fences stale owners, retries, and stays terminal", async () => {
    const scope = await createProject(isolated.db);
    const initiator = await addActor(isolated.db, scope, "HUMAN", "account:operation-owner");
    const workerA = await addActor(isolated.db, scope, "MEMOID_WORKER", "worker:a");
    const workerB = await addActor(isolated.db, scope, "MEMOID_WORKER", "worker:b");
    const operation = await addOperation(isolated.db, scope, initiator, "RECOVERABLE_WORK", 3);
    const acquire = (workerId: string) =>
      sql<{ attempt: number; leaseToken: string | null; wasAcquired: boolean }>`select
        was_acquired as "wasAcquired", acquired_lease_token::text as "leaseToken",
        acquired_attempt as attempt from memoid.acquire_operation(
          ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${operation.id}::uuid,
          ${workerId}::uuid, 60
        )`.execute(isolated.db);
    const raced = await Promise.all([acquire(workerA), acquire(workerB)]);
    const first = raced.map((result) => result.rows[0]!).find((result) => result.wasAcquired)!;
    expect(
      raced.map((result) => result.rows[0]!).filter((result) => result.wasAcquired),
    ).toHaveLength(1);
    expect(first.attempt).toBe(1);
    await sql`update memoid.operations set lease_expires_at = clock_timestamp() - interval '1 second'
      where id = ${operation.id}::uuid`.execute(isolated.db);
    const reclaimed = (await acquire(workerB)).rows[0]!;
    expect(reclaimed).toMatchObject({ wasAcquired: true, attempt: 2 });
    await expect(
      sql`select memoid.finish_operation(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${operation.id}::uuid,
      ${first.leaseToken}::uuid, 'SUCCEEDED', null, '{}'::jsonb, null
    )`.execute(isolated.db),
    ).rejects.toThrow("stale Operation lease");
    await sql`select memoid.renew_operation_lease(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${operation.id}::uuid,
      ${reclaimed.leaseToken}::uuid, 60
    )`.execute(isolated.db);
    await sql`select memoid.finish_operation(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${operation.id}::uuid,
      ${reclaimed.leaseToken}::uuid, 'RETRY', 'TRANSIENT_PROVIDER', '{"RETRY_CLASS":"TRANSIENT"}'::jsonb,
      clock_timestamp() + interval '1 minute'
    )`.execute(isolated.db);
    await sql`update memoid.operations set next_attempt_at = clock_timestamp() - interval '1 second'
      where id = ${operation.id}::uuid`.execute(isolated.db);
    const thirdRace = await Promise.all([acquire(workerA), acquire(workerB)]);
    const third = thirdRace.map((result) => result.rows[0]!).find((result) => result.wasAcquired)!;
    expect(
      thirdRace.map((result) => result.rows[0]!).filter((result) => result.wasAcquired),
    ).toHaveLength(1);
    expect(third.attempt).toBe(3);
    await sql`select memoid.finish_operation(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${operation.id}::uuid,
      ${third.leaseToken}::uuid, 'SUCCEEDED', null, '{}'::jsonb, null
    )`.execute(isolated.db);
    await expect(
      sql`update memoid.operations set state = 'RUNNING', terminal_at = null,
      lease_token = uuidv7(), lease_owner_actor_id = ${workerA}::uuid,
      lease_expires_at = clock_timestamp() + interval '1 minute'
      where id = ${operation.id}::uuid`.execute(isolated.db),
    ).rejects.toThrow("terminal Operation");
    const attempts = await sql<{
      attempt: number;
      outcome: string;
    }>`select attempt_number as attempt, outcome
      from memoid.operation_attempts where operation_id = ${operation.id}::uuid order by attempt_number`.execute(
      isolated.db,
    );
    expect(attempts.rows).toEqual([
      { attempt: 1, outcome: "LEASE_EXPIRED" },
      { attempt: 2, outcome: "RETRY_SCHEDULED" },
      { attempt: 3, outcome: "SUCCEEDED" },
    ]);
    await expect(
      sql`update memoid.operation_attempts set failure_code = 'REWRITTEN'
        where operation_id = ${operation.id}::uuid and attempt_number = 3`.execute(isolated.db),
    ).rejects.toThrow("completed Operation attempt is immutable");
    await expect(
      sql`delete from memoid.operation_attempts
        where operation_id = ${operation.id}::uuid and attempt_number = 3`.execute(isolated.db),
    ).rejects.toThrow("immutable history row");
  });

  it("serializes completion/cancellation and failure/retry races", async () => {
    const scope = await createProject(isolated.db);
    const initiator = await addActor(isolated.db, scope, "HUMAN", "account:race-owner");
    const worker = await addActor(isolated.db, scope, "MEMOID_WORKER", "worker:race");
    const operation = await addOperation(isolated.db, scope, initiator, "CANCELLATION_RACE", 3);
    const acquired = (
      await sql<{ token: string }>`select acquired_lease_token::text as token
      from memoid.acquire_operation(${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
        ${operation.id}::uuid, ${worker}::uuid, 60)`.execute(isolated.db)
    ).rows[0]!;
    const completionRace = await Promise.allSettled([
      sql`select memoid.finish_operation(${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
        ${operation.id}::uuid, ${acquired.token}::uuid, 'SUCCEEDED', null, '{}'::jsonb, null)`.execute(
        isolated.db,
      ),
      sql`select memoid.request_operation_cancellation(${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid, ${operation.id}::uuid)`.execute(isolated.db),
    ]);
    expect(completionRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const afterRace = (
      await sql<{
        state: string;
      }>`select state from memoid.operations where id = ${operation.id}::uuid`.execute(isolated.db)
    ).rows[0]!.state;
    if (afterRace === "CANCELLATION_REQUESTED") {
      await sql`select memoid.finish_operation(${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
        ${operation.id}::uuid, ${acquired.token}::uuid, 'CANCELLED', null, '{}'::jsonb, null)`.execute(
        isolated.db,
      );
    }
    expect(
      (
        await sql<{
          state: string;
        }>`select state from memoid.operations where id = ${operation.id}::uuid`.execute(
          isolated.db,
        )
      ).rows[0]!.state,
    ).toMatch(/^(SUCCEEDED|CANCELLED)$/);

    const failureRaceOperation = await addOperation(
      isolated.db,
      scope,
      initiator,
      "FAILURE_RETRY_RACE",
      2,
    );
    const failureLease = (
      await sql<{ token: string }>`select acquired_lease_token::text as token
      from memoid.acquire_operation(${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
        ${failureRaceOperation.id}::uuid, ${worker}::uuid, 60)`.execute(isolated.db)
    ).rows[0]!;
    const failureRace = await Promise.allSettled([
      sql`select memoid.finish_operation(${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
        ${failureRaceOperation.id}::uuid, ${failureLease.token}::uuid, 'RETRY', 'TRANSIENT', '{}'::jsonb,
        clock_timestamp() + interval '1 minute')`.execute(isolated.db),
      sql`select memoid.finish_operation(${scope.workspaceId}::uuid, ${scope.projectId}::uuid,
        ${failureRaceOperation.id}::uuid, ${failureLease.token}::uuid, 'FAILED', 'PERMANENT', '{}'::jsonb, null)`.execute(
        isolated.db,
      ),
    ]);
    expect(failureRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await sql<{
          state: string;
        }>`select state from memoid.operations where id = ${failureRaceOperation.id}::uuid`.execute(
          isolated.db,
        )
      ).rows[0]!.state,
    ).toMatch(/^(RETRY_WAIT|FAILED)$/);
  });

  it("preserves the exact 105 to 106 lost-wakeup and duplicate-scheduling contract", async () => {
    const scope = await createProject(isolated.db);
    const workerA = await addActor(isolated.db, scope, "MEMOID_WORKER", "worker:frontier-a");
    const workerB = await addActor(isolated.db, scope, "MEMOID_WORKER", "worker:frontier-b");
    const unit = await sql<{ id: string }>`insert into memoid.processing_units
      (workspace_id, project_id, unit_kind, unit_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 'SOURCE_REF', 'source:main')
      returning id::text`.execute(isolated.db);
    await sql`select memoid.advance_processing_desired(${scope.workspaceId}::uuid,
      ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid, 105)`.execute(isolated.db);
    const acquire = (workerId: string) =>
      sql<{
        leaseToken: string | null;
        target: string;
        wasAcquired: boolean;
      }>`select was_acquired as "wasAcquired", acquired_lease_token::text as "leaseToken",
      target_sequence::text as target from memoid.acquire_processing_unit(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid,
        ${workerId}::uuid, 60)`.execute(isolated.db);
    const firstRace = await Promise.all([acquire(workerA), acquire(workerB)]);
    const pass105 = firstRace
      .map((result) => result.rows[0]!)
      .find((result) => result.wasAcquired)!;
    expect(
      firstRace.map((result) => result.rows[0]!).filter((result) => result.wasAcquired),
    ).toHaveLength(1);
    expect(pass105.target).toBe("105");
    await sql`select memoid.advance_processing_desired(${scope.workspaceId}::uuid,
      ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid, 106)`.execute(isolated.db);
    const completion = await sql<{ desired: string; followUp: boolean; processed: string }>`select
      processed_through::text as processed, current_desired::text as desired,
      follow_up_still_required as "followUp" from memoid.complete_processing_unit(
        ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid,
        ${pass105.leaseToken}::uuid, 105)`.execute(isolated.db);
    expect(completion.rows[0]).toEqual({ processed: "105", desired: "106", followUp: true });
    const pass106 = (await acquire(workerB)).rows[0]!;
    expect(pass106).toMatchObject({ wasAcquired: true, target: "106" });
    await expect(
      sql`select * from memoid.complete_processing_unit(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid,
      ${pass105.leaseToken}::uuid, 105)`.execute(isolated.db),
    ).rejects.toThrow("stale processing lease");
    await sql`select * from memoid.complete_processing_unit(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid,
      ${pass106.leaseToken}::uuid, 106)`.execute(isolated.db);
    const settled = await sql<{ desired: string; followUp: boolean; processed: string }>`select
      desired_sequence::text as desired, processed_sequence::text as processed,
      follow_up_required as "followUp" from memoid.processing_units where id = ${unit.rows[0]!.id}::uuid`.execute(
      isolated.db,
    );
    expect(settled.rows[0]).toEqual({ desired: "106", processed: "106", followUp: false });
    expect((await acquire(workerA)).rows[0]!.wasAcquired).toBe(false);
  });

  it("keeps Candidate reconciliation at 48 while 49 is pending and 50 is stable", async () => {
    const scope = await createProject(isolated.db);
    const candidateIds: string[] = [];
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      const candidate = await sql<{ id: string }>`insert into memoid.candidate_submissions
        (workspace_id, project_id, submission_sequence, submitted_at, payload_hash)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${sequence},
          clock_timestamp(), ${hash(sequence)}) returning id::text`.execute(isolated.db);
      candidateIds.push(candidate.rows[0]!.id);
    }
    for (let sequence = 1; sequence <= 48; sequence += 1) {
      await sql`insert into memoid.candidate_stable_dispositions
        (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${sequence},
          ${candidateIds[sequence - 1]}::uuid, 'WORKING_CONTEXT_UPDATED')`.execute(isolated.db);
    }
    await sql`insert into memoid.candidate_stable_dispositions
      (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 50,
        ${candidateIds[49]}::uuid, 'NO_CHANGE')`.execute(isolated.db);
    const gap = await sql<{ accepted: string; reconciled: string }>`select
      last_accepted_sequence::text as accepted, reconciled_through_sequence::text as reconciled
      from memoid.candidate_frontier_states where project_id = ${scope.projectId}::uuid`.execute(
      isolated.db,
    );
    expect(gap.rows[0]).toEqual({ accepted: "50", reconciled: "48" });
    await expect(
      sql`update memoid.candidate_frontier_states set reconciled_through_sequence = 50
      where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("unstable gap");
    await expect(
      sql`insert into memoid.candidate_stable_dispositions
      (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 50,
        ${candidateIds[49]}::uuid, 'NO_CHANGE')`.execute(isolated.db),
    ).rejects.toThrow();
    await expect(
      isolated.db.transaction().execute(async (trx) => {
        await sql`insert into memoid.candidate_stable_dispositions
          (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
          values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 49,
            ${candidateIds[48]}::uuid, 'PROPOSAL_CREATED')`.execute(trx);
        throw new Error("simulated worker crash before disposition commit");
      }),
    ).rejects.toThrow("simulated worker crash");
    expect(
      (
        await sql<{ reconciled: string }>`select reconciled_through_sequence::text as reconciled
      from memoid.candidate_frontier_states where project_id = ${scope.projectId}::uuid`.execute(
          isolated.db,
        )
      ).rows[0]!.reconciled,
    ).toBe("48");
    await sql`insert into memoid.candidate_stable_dispositions
      (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 49,
        ${candidateIds[48]}::uuid, 'PROPOSAL_CREATED')`.execute(isolated.db);
    await sql`select memoid.refresh_candidate_reconciled_frontier(
      ${scope.workspaceId}::uuid, ${scope.projectId}::uuid)`.execute(isolated.db);
    expect(
      (
        await sql<{ reconciled: string }>`select reconciled_through_sequence::text as reconciled
      from memoid.candidate_frontier_states where project_id = ${scope.projectId}::uuid`.execute(
          isolated.db,
        )
      ).rows[0]!.reconciled,
    ).toBe("50");
  });
});
