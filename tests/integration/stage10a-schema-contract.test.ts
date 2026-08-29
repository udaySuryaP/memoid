import { createDatabase, migrateToLatest, type MemoidDatabase } from "@memoid/db";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

type Scope = { accountId: string; workspaceId: string; projectId: string };

async function createProject(db: Kysely<MemoidDatabase>): Promise<Scope> {
  const account = await sql<{
    id: string;
  }>`insert into memoid.accounts default values returning id::text`.execute(db);
  const accountId = account.rows[0]!.id;
  const workspace = await sql<{ id: string }>`insert into memoid.workspaces (account_id)
    values (${accountId}::uuid) returning id::text`.execute(db);
  const workspaceId = workspace.rows[0]!.id;
  const project = await sql<{ id: string }>`insert into memoid.projects (workspace_id)
    values (${workspaceId}::uuid) returning id::text`.execute(db);
  return { accountId, workspaceId, projectId: project.rows[0]!.id };
}

async function addPolicy(
  db: Kysely<MemoidDatabase>,
  scope: Scope,
  version: number,
  policy: "MANUAL" | "AUTOMATIC",
  effectiveAt = "2026-08-29T00:00:00Z",
): Promise<void> {
  await sql`insert into memoid.project_review_policy_versions
    (workspace_id, project_id, version, policy, effective_at, changed_by_account_id)
    values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${version}, ${policy}, ${effectiveAt}::timestamptz, ${scope.accountId}::uuid)`.execute(
    db,
  );
}

async function addCandidate(
  db: Kysely<MemoidDatabase>,
  scope: Scope,
  sequence: number,
): Promise<string> {
  const result = await sql<{ id: string }>`insert into memoid.candidate_submissions
    (workspace_id, project_id, submission_sequence, submitted_at, payload_hash)
    values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${sequence}, clock_timestamp(), decode(repeat('11',32),'hex'))
    returning id::text`.execute(db);
  return result.rows[0]!.id;
}

async function addAssertion(
  db: Kysely<MemoidDatabase>,
  scope: Scope,
  candidateId: string,
  ordinal = 1,
): Promise<string> {
  const result = await sql<{ id: string }>`insert into memoid.candidate_assertions
    (workspace_id, project_id, candidate_submission_id, assertion_ordinal, origin_kind, confirmation_kind, assertion_payload, assertion_hash)
    values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${candidateId}::uuid, ${ordinal}, 'AI_INFERRED', 'NONE', '{"claim":"candidate only"}'::jsonb, decode(repeat('22',32),'hex'))
    returning id::text`.execute(db);
  return result.rows[0]!.id;
}

async function addContextIdentity(db: Kysely<MemoidDatabase>, scope: Scope): Promise<string> {
  const result = await sql<{ id: string }>`insert into memoid.context_identities
    (workspace_id, project_id, subject_key, scope_key, facet_key, predicate_key)
    values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 'api/auth', 'project/root', 'architecture', 'provider')
    returning id::text`.execute(db);
  return result.rows[0]!.id;
}

suite("Stage 10A PostgreSQL contract", () => {
  let isolated: IsolatedTestDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10a_contract");
    await migrateToLatest(isolated.db);
  });

  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
  });

  afterAll(async () => isolated.destroy());

  it("keeps every Project-owned relationship Workspace and Project scoped", async () => {
    const first = await createProject(isolated.db);
    const second = await createProject(isolated.db);
    const candidate = await addCandidate(isolated.db, first, 1);
    const assertion = await addAssertion(isolated.db, first, candidate);

    await expect(
      sql`insert into memoid.working_context_items
        (workspace_id, project_id, candidate_assertion_id, trust_qualification, assertion_payload, assertion_hash)
        values (${second.workspaceId}::uuid, ${second.projectId}::uuid, ${assertion}::uuid, 'PENDING_UNRECONCILED', '{"claim":"wrong project"}'::jsonb, decode(repeat('33',32),'hex'))`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
  });

  it("enforces append-only policy version ordering, values, effectivity, and attribution", async () => {
    const scope = await createProject(isolated.db);
    await expect(addPolicy(isolated.db, scope, 2, "MANUAL")).rejects.toThrow("must start at 1");
    await addPolicy(isolated.db, scope, 1, "MANUAL", "2026-08-29T00:00:00Z");
    await expect(
      sql`insert into memoid.project_review_policy_versions
        (workspace_id, project_id, version, policy, effective_at, changed_by_account_id)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 2, 'MODEL_DECIDES', clock_timestamp(), ${scope.accountId}::uuid)`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
    await expect(
      addPolicy(isolated.db, scope, 2, "AUTOMATIC", "2026-08-28T00:00:00Z"),
    ).rejects.toThrow("cannot move backwards");
    await addPolicy(isolated.db, scope, 2, "AUTOMATIC", "2026-08-30T00:00:00Z");
    const effective = await sql<{ policy: string }>`select coalesce((
      select policy from memoid.project_review_policy_versions
      where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid
        and effective_at <= '2026-08-29T12:00:00Z'::timestamptz
      order by effective_at desc, version desc limit 1
    ), 'MANUAL') as policy`.execute(isolated.db);
    expect(effective.rows[0]?.policy).toBe("MANUAL");
  });

  it("serializes concurrent attempts to create the next review-policy version", async () => {
    const scope = await createProject(isolated.db);
    await addPolicy(isolated.db, scope, 1, "MANUAL");
    const attempts = await Promise.allSettled([
      addPolicy(isolated.db, scope, 2, "AUTOMATIC", "2026-08-30T00:00:00Z"),
      addPolicy(isolated.db, scope, 2, "MANUAL", "2026-08-30T01:00:00Z"),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const versions = await sql<{
      version: string;
    }>`select version::text from memoid.project_review_policy_versions
      where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid
      order by version`.execute(isolated.db);
    expect(versions.rows.map((row) => row.version)).toEqual(["1", "2"]);
  });

  it("keeps assertion origin orthogonal to explicit user confirmation", async () => {
    const scope = await createProject(isolated.db);
    const candidate = await addCandidate(isolated.db, scope, 1);
    await addAssertion(isolated.db, scope, candidate);
    await expect(
      sql`insert into memoid.candidate_assertions
        (workspace_id, project_id, candidate_submission_id, assertion_ordinal, origin_kind, confirmation_kind, assertion_payload, assertion_hash)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${candidate}::uuid, 2, 'AI_INFERRED', 'EXPLICIT_USER', '{"claim":"not actually confirmed"}'::jsonb, decode(repeat('23',32),'hex'))`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
    await expect(
      sql`insert into memoid.candidate_assertions
        (workspace_id, project_id, candidate_submission_id, assertion_ordinal, origin_kind, confirmation_kind, confirmed_by_account_id, confirmed_at, assertion_payload, assertion_hash)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${candidate}::uuid, 2, 'AI_INFERRED', 'EXPLICIT_USER', ${scope.accountId}::uuid, clock_timestamp(), '{"claim":"explicitly confirmed"}'::jsonb, decode(repeat('24',32),'hex'))`.execute(
        isolated.db,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects cross-Workspace review attribution and mutation of immutable evidence/history", async () => {
    const first = await createProject(isolated.db);
    const second = await createProject(isolated.db);
    await addPolicy(isolated.db, first, 1, "MANUAL");
    const candidate = await addCandidate(isolated.db, first, 1);

    await expect(
      sql`insert into memoid.candidate_assertions
        (workspace_id, project_id, candidate_submission_id, assertion_ordinal, origin_kind, confirmation_kind, confirmed_by_account_id, confirmed_at, assertion_payload, assertion_hash)
        values (${first.workspaceId}::uuid, ${first.projectId}::uuid, ${candidate}::uuid, 1, 'AI_INFERRED', 'EXPLICIT_USER', ${second.accountId}::uuid, clock_timestamp(), '{"claim":"cross scope"}'::jsonb, decode(repeat('25',32),'hex'))`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
    await expect(
      sql`insert into memoid.context_revisions
        (workspace_id, project_id, revision_sequence, review_policy_version, decision_mode, applied_by_account_id)
        values (${first.workspaceId}::uuid, ${first.projectId}::uuid, 1, 1, 'MANUAL', ${second.accountId}::uuid)`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
    await expect(
      sql`update memoid.candidate_submissions set submitted_at = clock_timestamp()
        where workspace_id = ${first.workspaceId}::uuid and project_id = ${first.projectId}::uuid and submission_sequence = 1`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable history row");
    await expect(
      sql`update memoid.project_review_policy_versions set effective_at = clock_timestamp()
        where workspace_id = ${first.workspaceId}::uuid and project_id = ${first.projectId}::uuid and version = 1`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable history row");
  });

  it("keeps the Candidate reconciled frontier behind an unfinished earlier sequence", async () => {
    const scope = await createProject(isolated.db);
    const first = await addCandidate(isolated.db, scope, 1);
    await addCandidate(isolated.db, scope, 2);
    const third = await addCandidate(isolated.db, scope, 3);
    await sql`insert into memoid.candidate_stable_dispositions
      (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 1, ${first}::uuid, 'PROPOSAL_CREATED')`.execute(
      isolated.db,
    );
    await sql`insert into memoid.candidate_stable_dispositions
      (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 3, ${third}::uuid, 'NO_CHANGE')`.execute(
      isolated.db,
    );
    const gap = await sql<{ accepted: string; reconciled: string }>`select
      last_accepted_sequence::text as accepted,
      reconciled_through_sequence::text as reconciled
      from memoid.candidate_frontier_states
      where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid`.execute(
      isolated.db,
    );
    expect(gap.rows[0]).toEqual({ accepted: "3", reconciled: "1" });
    await expect(
      sql`update memoid.candidate_frontier_states set reconciled_through_sequence = 3
        where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("unstable gap");
  });

  it("advances through out-of-order stable completions safely under concurrency", async () => {
    const scope = await createProject(isolated.db);
    const first = await addCandidate(isolated.db, scope, 1);
    const second = await addCandidate(isolated.db, scope, 2);
    const third = await addCandidate(isolated.db, scope, 3);
    await sql`insert into memoid.candidate_stable_dispositions
      (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 1, ${first}::uuid, 'PROPOSAL_CREATED')`.execute(
      isolated.db,
    );
    const completed = await Promise.allSettled([
      sql`insert into memoid.candidate_stable_dispositions
        (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 3, ${third}::uuid, 'NO_CHANGE')`.execute(
        isolated.db,
      ),
      sql`insert into memoid.candidate_stable_dispositions
        (workspace_id, project_id, submission_sequence, candidate_submission_id, disposition_key)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 2, ${second}::uuid, 'WORKING_CONTEXT_UPDATED')`.execute(
        isolated.db,
      ),
    ]);
    expect(completed.every((attempt) => attempt.status === "fulfilled")).toBe(true);
    const frontier = await sql<{
      reconciled: string;
    }>`select reconciled_through_sequence::text as reconciled
      from memoid.candidate_frontier_states
      where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid`.execute(
      isolated.db,
    );
    expect(frontier.rows[0]?.reconciled).toBe("3");
  });

  it("represents Source observed/desired/ingested/reconciled stages per scope and ref", async () => {
    const scope = await createProject(isolated.db);
    const source = await sql<{ id: string }>`insert into memoid.sources
      (workspace_id, project_id, source_kind) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 'GITHUB_REPOSITORY') returning id::text`.execute(
      isolated.db,
    );
    const unit = await sql<{ id: string }>`insert into memoid.source_frontier_units
      (workspace_id, project_id, source_id, scope_key, ref_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${source.rows[0]!.id}::uuid, 'implementation', 'refs/heads/main') returning id::text`.execute(
      isolated.db,
    );
    for (const [sequence, revision] of [
      [1, "sha-before-force-push"],
      [2, "non-ancestral-sha"],
    ] as const) {
      await sql`insert into memoid.source_observations
        (workspace_id, project_id, frontier_unit_id, observation_sequence, external_revision, observed_at)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid, ${sequence}, ${revision}, clock_timestamp())`.execute(
        isolated.db,
      );
    }
    await sql`insert into memoid.source_frontier_states
      (workspace_id, project_id, frontier_unit_id, observed_sequence, desired_sequence, ingested_sequence, reconciled_sequence)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid, 2, 2, 1, 1)`.execute(
      isolated.db,
    );
    await expect(
      sql`update memoid.source_frontier_states set reconciled_sequence = 2
        where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid and frontier_unit_id = ${unit.rows[0]!.id}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow();
    await expect(
      sql`update memoid.source_frontier_states set observed_sequence = 1, desired_sequence = 1
        where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid and frontier_unit_id = ${unit.rows[0]!.id}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("cannot move backwards");
  });

  it("keeps Context Identity unique while immutable records evolve through revisions", async () => {
    const scope = await createProject(isolated.db);
    await addPolicy(isolated.db, scope, 1, "MANUAL");
    const candidate = await addCandidate(isolated.db, scope, 1);
    const assertion = await addAssertion(isolated.db, scope, candidate);
    const identity = await addContextIdentity(isolated.db, scope);
    await expect(addContextIdentity(isolated.db, scope)).rejects.toThrow();
    const records: string[] = [];
    const revisions: string[] = [];
    let revisionSequence = 0;
    for (const [claim, hashByte] of [
      ["express", "41"],
      ["fastify", "42"],
    ] as const) {
      revisionSequence += 1;
      const created = await isolated.db.transaction().execute(async (trx) => {
        const revision = await sql<{ id: string }>`insert into memoid.context_revisions
          (workspace_id, project_id, revision_sequence, review_policy_version, decision_mode, applied_by_account_id)
          values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${revisionSequence}, 1, 'MANUAL', ${scope.accountId}::uuid) returning id::text`.execute(
          trx,
        );
        const record = await sql<{ id: string }>`insert into memoid.context_records
          (workspace_id, project_id, context_identity_id, context_revision_id, assertion_payload, assertion_hash, reviewed_at)
          values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${identity}::uuid, ${revision.rows[0]!.id}::uuid, jsonb_build_object('value', ${claim}::text), decode(repeat(${hashByte}::text,32),'hex'), clock_timestamp()) returning id::text`.execute(
          trx,
        );
        await sql`insert into memoid.context_record_candidate_provenance
          (workspace_id, project_id, context_record_id, candidate_assertion_id, relation_kind)
          values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${record.rows[0]!.id}::uuid, ${assertion}::uuid, 'SUPPORTS')`.execute(
          trx,
        );
        return { recordId: record.rows[0]!.id, revisionId: revision.rows[0]!.id };
      });
      records.push(created.recordId);
      revisions.push(created.revisionId);
    }
    const attempts = await Promise.allSettled(
      records.map((recordId, index) =>
        isolated.db.transaction().execute((trx) =>
          sql`insert into memoid.context_identity_current_records
            (workspace_id, project_id, context_identity_id, context_record_id, established_by_revision_id)
            values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${identity}::uuid, ${recordId}::uuid, ${revisions[index]}::uuid)`.execute(
            trx,
          ),
        ),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const history = await sql<{
      count: string;
    }>`select count(*)::text as count from memoid.context_records
      where workspace_id = ${scope.workspaceId}::uuid and project_id = ${scope.projectId}::uuid and context_identity_id = ${identity}::uuid`.execute(
      isolated.db,
    );
    expect(history.rows[0]?.count).toBe("2");
  });

  it("supports cumulative Candidate and Source provenance plus record-level Source coverage", async () => {
    const scope = await createProject(isolated.db);
    await addPolicy(isolated.db, scope, 1, "MANUAL");
    const candidate = await addCandidate(isolated.db, scope, 1);
    const assertion = await addAssertion(isolated.db, scope, candidate);
    const identity = await addContextIdentity(isolated.db, scope);
    const revision = await sql<{ id: string }>`insert into memoid.context_revisions
      (workspace_id, project_id, revision_sequence, review_policy_version, decision_mode, applied_by_account_id)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 1, 1, 'MANUAL', ${scope.accountId}::uuid) returning id::text`.execute(
      isolated.db,
    );
    await expect(
      sql`insert into memoid.context_records
        (workspace_id, project_id, context_identity_id, context_revision_id, assertion_payload, assertion_hash, reviewed_at)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${identity}::uuid, ${revision.rows[0]!.id}::uuid, '{"value":"unproven"}'::jsonb, decode(repeat('50',32),'hex'), clock_timestamp())`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("requires Candidate or Source provenance");
    const record = await isolated.db.transaction().execute(async (trx) => {
      const inserted = await sql<{ id: string }>`insert into memoid.context_records
        (workspace_id, project_id, context_identity_id, context_revision_id, assertion_payload, assertion_hash, reviewed_at)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${identity}::uuid, ${revision.rows[0]!.id}::uuid, '{"value":"postgresql"}'::jsonb, decode(repeat('51',32),'hex'), clock_timestamp()) returning id::text`.execute(
        trx,
      );
      await sql`insert into memoid.context_record_candidate_provenance
        (workspace_id, project_id, context_record_id, candidate_assertion_id, relation_kind)
        values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${inserted.rows[0]!.id}::uuid, ${assertion}::uuid, 'ORIGINATES')`.execute(
        trx,
      );
      return inserted;
    });
    const source = await sql<{ id: string }>`insert into memoid.sources
      (workspace_id, project_id, source_kind) values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, 'GITHUB_REPOSITORY') returning id::text`.execute(
      isolated.db,
    );
    const unit = await sql<{ id: string }>`insert into memoid.source_frontier_units
      (workspace_id, project_id, source_id, scope_key, ref_key)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${source.rows[0]!.id}::uuid, 'database', 'refs/heads/main') returning id::text`.execute(
      isolated.db,
    );
    const observation = await sql<{ id: string }>`insert into memoid.source_observations
      (workspace_id, project_id, frontier_unit_id, observation_sequence, external_revision, observed_at)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${unit.rows[0]!.id}::uuid, 1, 'sha-1', clock_timestamp()) returning id::text`.execute(
      isolated.db,
    );
    await sql`insert into memoid.context_record_source_provenance
      (workspace_id, project_id, context_record_id, source_observation_id, relation_kind)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${record.rows[0]!.id}::uuid, ${observation.rows[0]!.id}::uuid, 'SUPPORTS')`.execute(
      isolated.db,
    );
    await sql`insert into memoid.context_record_source_coverage
      (workspace_id, project_id, context_record_id, frontier_unit_id, covered_observation_sequence)
      values (${scope.workspaceId}::uuid, ${scope.projectId}::uuid, ${record.rows[0]!.id}::uuid, ${unit.rows[0]!.id}::uuid, 1)`.execute(
      isolated.db,
    );
    const proof = await sql<{ candidate: string; source: string; coverage: string }>`select
      (select count(*)::text from memoid.context_record_candidate_provenance) as candidate,
      (select count(*)::text from memoid.context_record_source_provenance) as source,
      (select count(*)::text from memoid.context_record_source_coverage) as coverage`.execute(
      isolated.db,
    );
    expect(proof.rows[0]).toEqual({ candidate: "1", source: "1", coverage: "1" });
  });

  it("keeps the product schema inaccessible to the application role until 10C", async () => {
    const appUrl = new URL(isolated.connectionString);
    appUrl.username = "memoid_app";
    appUrl.password = "synthetic-app-password";
    const app = createDatabase(appUrl.toString(), 1);
    try {
      await expect(sql`select id from memoid.accounts`.execute(app)).rejects.toThrow();
    } finally {
      await app.destroy();
    }
  });
});
