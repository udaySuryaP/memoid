import {
  PostgresContextRecordRepository,
  PostgresSourceAuthorityRepository,
  PostgresWorkspaceProjectRepository,
} from "../../packages/adapters/src/index.js";
import {
  ContextRecordService,
  SourceAuthorityService,
  WorkspaceProjectService,
} from "../../packages/application/src/index.js";
import {
  completeStepUpIntent,
  createDatabase,
  createDatabaseUuidV7,
  createLocalAuthSession,
  createStepUpIntent,
  migrateToLatest,
  resolveAccountIdentity,
  withSecurityTransaction,
  type MemoidDatabase,
} from "../../packages/db/src/index.js";
import type {
  AccountId,
  ContextRecordId,
  EvidenceReferenceId,
  ProjectId,
  SourceAuthorityAssignmentId,
  SourceId,
  WorkspaceId,
} from "../../packages/domain/src/index.js";
import {
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  hashSessionCredential,
} from "../../packages/security/src/index.js";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

interface Fixture {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  context: Parameters<ContextRecordService["list"]>[0];
  service: ContextRecordService;
  repository: PostgresContextRecordRepository;
  projectRepository: PostgresWorkspaceProjectRepository;
  authorityRepository: PostgresSourceAuthorityRepository;
}

suite("Stage 10H Context Records PostgreSQL", () => {
  let isolated: IsolatedTestDatabase;
  let auth: Kysely<MemoidDatabase>;
  let app: Kysely<MemoidDatabase>;
  let owner: Fixture;
  let foreign: Fixture;
  const closables: Array<{ close(): Promise<void> }> = [];

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10h_context");
    await migrateToLatest(isolated.db);
    const authUrl = isolated.connectionString.replace(
      "postgres:postgres",
      "memoid_auth:synthetic-auth-password",
    );
    const appUrl = isolated.connectionString.replace(
      "postgres:postgres",
      "memoid_app:synthetic-app-password",
    );
    auth = createDatabase(authUrl, 8);
    app = createDatabase(appUrl, 8);
  });
  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
    owner = await fixture("owner");
    foreign = await fixture("foreign");
  });
  afterAll(async () => {
    await Promise.all(closables.map((value) => value.close()));
    await auth.destroy();
    await app.destroy();
    await isolated.destroy();
  }, 60_000);

  async function fixture(label: string): Promise<Fixture> {
    const subject = `stage10h_${label}`;
    const identity = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: subject,
      email: `${subject}@example.test`,
      emailVerified: true,
    });
    const accountId = identity.accountId as AccountId;
    const originalToken = hashSessionCredential(`${subject}-original-token`.padEnd(48, "x"));
    await createLocalAuthSession(auth, {
      accountId,
      bindingId: identity.bindingId,
      tokenHash: originalToken,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 3_600_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    const appUrl = isolated.connectionString.replace(
      "postgres:postgres",
      "memoid_app:synthetic-app-password",
    );
    const projectRepository = new PostgresWorkspaceProjectRepository(appUrl);
    closables.push(projectRepository);
    const workspace = await projectRepository.findPersonalWorkspace(accountId);
    if (!workspace) throw new Error("Workspace missing");
    const actor = await projectRepository.ensureHumanActor(accountId, workspace.id);
    const principal = {
      kind: "HUMAN" as const,
      id: subject,
      accountId,
      active: true as const,
      sessionRevoked: false as const,
      roleAssignments: [
        { role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId: workspace.id },
      ] as const,
    };
    const project = (
      await new WorkspaceProjectService(projectRepository).createProject(
        {
          accountId,
          workspaceId: workspace.id,
          sessionCredentialHash: originalToken,
          actor,
          principal,
        },
        {
          displayName: `Context ${label}`,
          reviewPolicy: "MANUAL",
          idempotencyKeyHash: hashIdempotencyKey(`${subject}-project`.padEnd(40, "p")),
          requestFingerprint: fingerprintLifecycleRequest({ label }),
        },
      )
    ).project;
    const nonce = Buffer.alloc(32, label === "owner" ? 41 : 42);
    const intentId = await createStepUpIntent(auth, {
      tokenHash: originalToken,
      nonceHash: nonce,
      actionKey: "MANAGE_SOURCE_AUTHORITY",
      workspaceId: workspace.id,
      projectId: project.id,
      returnPath: `/projects/${project.id}`,
      correlationId: await createDatabaseUuidV7(auth),
    });
    const token = hashSessionCredential(`${subject}-rotated-token`.padEnd(48, "y"));
    await completeStepUpIntent(auth, {
      oldTokenHash: originalToken,
      nonceHash: nonce,
      intentId,
      newTokenHash: token,
      providerSubject: subject,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const context = {
      accountId,
      workspaceId: workspace.id,
      sessionCredentialHash: token,
      actor,
      principal,
      freshAuthenticationSatisfied: true,
    };
    const repository = new PostgresContextRecordRepository(appUrl);
    closables.push(repository);
    const authorityRepository = new PostgresSourceAuthorityRepository(appUrl);
    closables.push(authorityRepository);
    return {
      accountId,
      workspaceId: workspace.id,
      projectId: project.id,
      context,
      service: new ContextRecordService(repository),
      repository,
      projectRepository,
      authorityRepository,
    };
  }

  const identity = {
    subject: "project",
    scope: "architecture",
    facet: "decision",
    predicate: "database",
  };
  function put(
    f: Fixture,
    key: string,
    expectedIdentityVersion = 0,
    expectedCurrentRecordId: ContextRecordId | null = null,
    payload: Record<string, unknown> = { value: "PostgreSQL" },
  ) {
    const base = {
      projectId: f.projectId,
      identity,
      expectedIdentityVersion,
      expectedCurrentRecordId,
      payload,
      originKind: "USER_NATIVE" as const,
    };
    return {
      ...base,
      idempotencyKeyHash: hashIdempotencyKey(key.padEnd(40, "k")),
      requestFingerprint: fingerprintLifecycleRequest(base),
    };
  }

  it("keeps identity stable, appends revisions/provenance, and replays idempotently", async () => {
    const first = await owner.service.put(owner.context, put(owner, "first"));
    expect(first).toMatchObject({ identityVersion: 1, recordVersion: 1, replayed: false });
    expect(await owner.service.put(owner.context, put(owner, "first"))).toEqual({
      ...first,
      replayed: true,
    });
    const second = await owner.service.put(
      owner.context,
      put(owner, "second", 1, first.contextRecordId, { value: "PostgreSQL 18" }),
    );
    expect(second.contextIdentityId).toBe(first.contextIdentityId);
    expect(second).toMatchObject({ identityVersion: 2, recordVersion: 2 });
    expect((await owner.service.list(owner.context, owner.projectId))[0]).toMatchObject({
      contextIdentityId: first.contextIdentityId,
      contextRecordId: second.contextRecordId,
      supersedesContextRecordId: first.contextRecordId,
      originKind: "USER_NATIVE",
      freshness: "NOT_SOURCE_BACKED",
    });
    const proof = (
      await sql<{ records: string; origins: string; revisions: string; audits: string }>`select
      (select count(*)::text from memoid.context_records where project_id=${owner.projectId}::uuid) records,
      (select count(*)::text from memoid.context_record_origins where project_id=${owner.projectId}::uuid) origins,
      (select count(*)::text from memoid.context_revisions where project_id=${owner.projectId}::uuid) revisions,
      (select count(*)::text from memoid.audit_events where project_id=${owner.projectId}::uuid and event_type like 'CONTEXT_%') audits`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(proof).toEqual({ records: "2", origins: "2", revisions: "2", audits: "2" });
    await expect(
      sql`update memoid.context_record_origins set origin_kind='SOURCE_EVIDENCE'`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable");
  });

  it("serializes concurrent revisions and lifecycle ending with compare-and-set", async () => {
    const first = await owner.service.put(owner.context, put(owner, "race-base"));
    const raced = await Promise.allSettled([
      owner.service.put(
        owner.context,
        put(owner, "race-a", 1, first.contextRecordId, { value: "A" }),
      ),
      owner.service.put(
        owner.context,
        put(owner, "race-b", 1, first.contextRecordId, { value: "B" }),
      ),
    ]);
    expect(raced.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const current = (await owner.service.list(owner.context, owner.projectId))[0]!;
    const endBase = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedIdentityVersion: current.identityVersion,
      expectedCurrentRecordId: current.contextRecordId,
      reasonKey: "RETIRED" as const,
      reasonNote: "No longer applicable",
    };
    const ending = owner.service.end(owner.context, {
      ...endBase,
      idempotencyKeyHash: hashIdempotencyKey("end-race".padEnd(40, "e")),
      requestFingerprint: fingerprintLifecycleRequest(endBase),
    });
    const revision = owner.service.put(
      owner.context,
      put(owner, "revise-race", current.identityVersion, current.contextRecordId, { value: "C" }),
    );
    const finalRace = await Promise.allSettled([ending, revision]);
    expect(finalRace.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(finalRace.filter((value) => value.status === "rejected")).toHaveLength(1);
  });

  it("enforces Project isolation and revoked-session checks", async () => {
    const first = await owner.service.put(owner.context, put(owner, "isolated"));
    await expect(foreign.service.list(foreign.context, owner.projectId)).rejects.toThrow(
      "NOT_FOUND",
    );
    const visible = await withSecurityTransaction(
      app,
      {
        accountId: foreign.accountId,
        workspaceId: foreign.workspaceId,
        projectId: foreign.projectId,
        actorId: foreign.context.actor.id,
      },
      (trx) =>
        sql<{ count: string }>`select count(*)::text count
      from memoid.context_records where id=${first.contextRecordId}::uuid`.execute(trx),
    );
    expect(visible.rows[0]?.count).toBe("0");
    await sql`update memoid.auth_sessions set revoked_at=clock_timestamp()
      where token_hash=${Buffer.from(owner.context.sessionCredentialHash)}::bytea`.execute(
      isolated.db,
    );
    await expect(
      owner.service.put(owner.context, put(owner, "revoked", 1, first.contextRecordId)),
    ).rejects.toThrow("RESOURCE_NOT_FOUND");
  });

  async function sourceEvidence(f: Fixture) {
    const sourceId = (
      await sql<{ id: string }>`insert into memoid.sources(workspace_id,project_id,source_kind)
      values(${f.workspaceId}::uuid,${f.projectId}::uuid,'GITHUB_REPOSITORY') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as SourceId;
    await sql`insert into memoid.github_source_connections(workspace_id,project_id,source_id,app_id,installation_id,
      account_id,repository_id,owner_login,repository_name,full_name,html_url,visibility,default_branch,connection_state,verified_at)
      values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,'1','2','3',${Date.now().toString()},'owner','repo',
      'owner/repo','https://github.com/owner/repo','PRIVATE','main','ACTIVE',clock_timestamp())`.execute(
      isolated.db,
    );
    const authorityBase = {
      projectId: f.projectId,
      sourceId,
      categoryFacet: "IMPLEMENTATION_STATE:CODE",
      scopeKind: "PROJECT" as const,
      scopeKey: null,
      refSelector: "DEFAULT_BRANCH" as const,
      refKey: null,
      expectedVersion: 0,
      reasonKey: "INITIAL_REVIEW" as const,
      reasonNote: "Reviewed",
    };
    const authority = (
      await new SourceAuthorityService(f.authorityRepository).set(f.context, {
        ...authorityBase,
        idempotencyKeyHash: hashIdempotencyKey("authority".padEnd(40, "a")),
        requestFingerprint: fingerprintLifecycleRequest(authorityBase),
      })
    ).assignmentId;
    const unit = (
      await sql<{
        id: string;
      }>`insert into memoid.source_frontier_units(workspace_id,project_id,source_id,scope_key,ref_key)
      values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,'repository','refs/heads/main') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const observation = (
      await sql<{
        id: string;
      }>`insert into memoid.source_observations(workspace_id,project_id,frontier_unit_id,
      observation_sequence,external_revision,observed_at) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unit}::uuid,
      1,${"a".repeat(40)},clock_timestamp()) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    await sql`insert into memoid.source_frontier_states(workspace_id,project_id,frontier_unit_id,observed_sequence,
      desired_sequence,ingested_sequence) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unit}::uuid,1,1,1)`.execute(
      isolated.db,
    );
    const evidence = (
      await sql<{
        id: string;
      }>`insert into memoid.evidence_references(workspace_id,project_id,source_id,
      frontier_unit_id,source_observation_id,observation_sequence,evidence_kind,repository_revision,repository_path,
      provider_object_id,byte_size,content_sha256) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,
      ${unit}::uuid,${observation}::uuid,1,'FILE',${"a".repeat(40)},'packages/domain/src/index.ts',${"a".repeat(40)},
      42,${Buffer.alloc(32, 7)}::bytea) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    return {
      sourceId,
      unit,
      authority: authority as SourceAuthorityAssignmentId,
      evidence: evidence as EvidenceReferenceId,
    };
  }

  it("binds source Context to exact Evidence and Authority and preserves truthful freshness", async () => {
    const source = await sourceEvidence(owner);
    const base = {
      projectId: owner.projectId,
      identity: {
        subject: "codebase",
        scope: "runtime",
        facet: "implementation",
        predicate: "language",
      },
      expectedIdentityVersion: 0,
      expectedCurrentRecordId: null,
      payload: { value: "TypeScript" },
      originKind: "SOURCE_EVIDENCE" as const,
      evidenceReferenceId: source.evidence,
      sourceAuthorityAssignmentId: source.authority,
    };
    const created = await owner.service.put(owner.context, {
      ...base,
      idempotencyKeyHash: hashIdempotencyKey("source".padEnd(40, "s")),
      requestFingerprint: fingerprintLifecycleRequest(base),
    });
    expect(
      (await owner.service.list(owner.context, owner.projectId)).find(
        (row) => row.contextRecordId === created.contextRecordId,
      )?.freshness,
    ).toBe("CURRENT");
    const observation2 = (
      await sql<{
        id: string;
      }>`insert into memoid.source_observations(workspace_id,project_id,frontier_unit_id,
      observation_sequence,external_revision,observed_at) values(${owner.workspaceId}::uuid,${owner.projectId}::uuid,${source.unit}::uuid,
      2,${"b".repeat(40)},clock_timestamp()) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    await sql`update memoid.source_frontier_states set observed_sequence=2,desired_sequence=2,ingested_sequence=2
      where frontier_unit_id=${source.unit}::uuid`.execute(isolated.db);
    expect(observation2).toBeTruthy();
    expect(
      (await owner.service.list(owner.context, owner.projectId)).find(
        (row) => row.contextRecordId === created.contextRecordId,
      )?.freshness,
    ).toBe("SOURCE_NEWER");
    await sql`update memoid.github_source_connections set connection_state='REPOSITORY_ACCESS_REMOVED'
      where source_id=${source.sourceId}::uuid`.execute(isolated.db);
    expect(
      (await owner.service.list(owner.context, owner.projectId)).find(
        (row) => row.contextRecordId === created.contextRecordId,
      )?.freshness,
    ).toBe("SOURCE_UNAVAILABLE");
    await expect(
      owner.service.put(owner.context, {
        ...base,
        identity: { ...base.identity, predicate: "framework" },
        sourceAuthorityAssignmentId: (await sourceEvidence(foreign)).authority,
        idempotencyKeyHash: hashIdempotencyKey("cross".padEnd(40, "c")),
        requestFingerprint: fingerprintLifecycleRequest({ bad: true }),
      }),
    ).rejects.toThrow("CONTEXT_AUTHORITY_UNAVAILABLE");
  });
});
