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
  createMigrator,
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
  let sourceSequence = 0;
  let authoritySequence = 0;
  const sourcesByProject = new Map<string, SourceId>();
  const frontiersByProjectRef = new Map<string, { unitId: string; observationSequence: number }>();
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
    sourceSequence = 0;
    authoritySequence = 0;
    sourcesByProject.clear();
    frontiersByProjectRef.clear();
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

  it("replays the exact original semantic result after later revisions and ending", async () => {
    const firstCommand = put(owner, "stable-first");
    const first = await owner.service.put(owner.context, firstCommand);
    const secondCommand = put(
      owner,
      "stable-second",
      first.identityVersion,
      first.contextRecordId,
      { value: "PostgreSQL 18" },
    );
    const second = await owner.service.put(owner.context, secondCommand);
    const third = await owner.service.put(
      owner.context,
      put(owner, "stable-third", second.identityVersion, second.contextRecordId, {
        value: "PostgreSQL 19",
      }),
    );

    expect(await owner.service.put(owner.context, firstCommand)).toEqual({
      ...first,
      replayed: true,
    });
    expect(await owner.service.put(owner.context, secondCommand)).toEqual({
      ...second,
      replayed: true,
    });

    const endBase = {
      projectId: owner.projectId,
      contextIdentityId: first.contextIdentityId,
      expectedIdentityVersion: third.identityVersion,
      expectedCurrentRecordId: third.contextRecordId,
      reasonKey: "RETIRED" as const,
      reasonNote: "Stable replay proof",
    };
    const endCommand = {
      ...endBase,
      idempotencyKeyHash: hashIdempotencyKey("stable-ending".padEnd(40, "e")),
      requestFingerprint: fingerprintLifecycleRequest(endBase),
    };
    const ending = await owner.service.end(owner.context, endCommand);
    expect(await owner.service.end(owner.context, endCommand)).toEqual({
      ...ending,
      replayed: true,
    });
    expect(await owner.service.end(owner.context, endCommand)).toEqual({
      ...ending,
      replayed: true,
    });
    expect(await owner.service.put(owner.context, firstCommand)).toEqual({
      ...first,
      replayed: true,
    });
    await expect(
      owner.service.put(owner.context, {
        ...firstCommand,
        requestFingerprint: fingerprintLifecycleRequest({ changed: true }),
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("refuses rollback after user-native Context creation without discarding provenance", async () => {
    const created = await owner.service.put(owner.context, put(owner, "rollback-user"));
    const down = await createMigrator(isolated.db).migrateDown();
    expect(String(down.error)).toContain("STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY");
    const retained = (
      await sql<{ count: string }>`select count(*)::text count from memoid.context_record_origins
        where context_record_id=${created.contextRecordId}::uuid and origin_kind='USER_NATIVE'`.execute(
        isolated.db,
      )
    ).rows[0]?.count;
    expect(retained).toBe("1");
  });

  it("refuses rollback after source-evidence Context creation without fabricating provenance", async () => {
    const source = await sourceEvidence(owner);
    const created = await owner.service.put(
      owner.context,
      sourcePut(owner, source.evidence, source.authority, "rollback-source"),
    );
    const down = await createMigrator(isolated.db).migrateDown();
    expect(String(down.error)).toContain("STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY");
    const retained = (
      await sql<{ origins: string; evidence: string }>`select
        (select count(*)::text from memoid.context_record_origins
          where context_record_id=${created.contextRecordId}::uuid and origin_kind='SOURCE_EVIDENCE') origins,
        (select count(*)::text from memoid.context_record_evidence_provenance
          where context_record_id=${created.contextRecordId}::uuid) evidence`.execute(isolated.db)
    ).rows[0];
    expect(retained).toEqual({ origins: "1", evidence: "1" });
  });

  it("refuses rollback after revisions and lifecycle ending while retaining history", async () => {
    const first = await owner.service.put(owner.context, put(owner, "rollback-history-first"));
    const second = await owner.service.put(
      owner.context,
      put(owner, "rollback-history-second", first.identityVersion, first.contextRecordId, {
        value: "revised",
      }),
    );
    const endBase = {
      projectId: owner.projectId,
      contextIdentityId: first.contextIdentityId,
      expectedIdentityVersion: second.identityVersion,
      expectedCurrentRecordId: second.contextRecordId,
      reasonKey: "NO_LONGER_APPLICABLE" as const,
    };
    await owner.service.end(owner.context, {
      ...endBase,
      idempotencyKeyHash: hashIdempotencyKey("rollback-history-end".padEnd(40, "e")),
      requestFingerprint: fingerprintLifecycleRequest(endBase),
    });
    const down = await createMigrator(isolated.db).migrateDown();
    expect(String(down.error)).toContain("STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY");
    const retained = (
      await sql<{ origins: string; endings: string }>`select
        (select count(*)::text from memoid.context_record_origins
          where context_identity_id=${first.contextIdentityId}::uuid) origins,
        (select count(*)::text from memoid.context_identity_endings
          where context_identity_id=${first.contextIdentityId}::uuid) endings`.execute(isolated.db)
    ).rows[0];
    expect(retained).toEqual({ origins: "2", endings: "1" });
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

  async function createSourceEvidence(
    f: Fixture,
    options: {
      repositoryPath?: string;
      refKey?: string;
      defaultBranch?: string;
    } = {},
  ) {
    sourceSequence += 1;
    const repositoryPath = options.repositoryPath ?? "packages/domain/src/index.ts";
    const refKey = options.refKey ?? "refs/heads/main";
    const defaultBranch = options.defaultBranch ?? "main";
    let sourceId = sourcesByProject.get(f.projectId);
    if (!sourceId) {
      sourceId = (
        await sql<{ id: string }>`insert into memoid.sources(workspace_id,project_id,source_kind)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,'GITHUB_REPOSITORY') returning id::text`.execute(
          isolated.db,
        )
      ).rows[0]!.id as SourceId;
      sourcesByProject.set(f.projectId, sourceId);
      await sql`insert into memoid.github_source_connections(workspace_id,project_id,source_id,app_id,installation_id,
      account_id,repository_id,owner_login,repository_name,full_name,html_url,visibility,default_branch,connection_state,verified_at)
      values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,'1',${String(sourceSequence)},'3',${String(Date.now() + sourceSequence)},'owner',${`repo-${sourceSequence}`},
      ${`owner/repo-${sourceSequence}`},${`https://github.com/owner/repo-${sourceSequence}`},'PRIVATE',${defaultBranch},'ACTIVE',clock_timestamp())`.execute(
        isolated.db,
      );
    }
    const frontierKey = `${f.projectId}:${refKey}`;
    let frontier = frontiersByProjectRef.get(frontierKey);
    if (!frontier) {
      const unitId = (
        await sql<{
          id: string;
        }>`insert into memoid.source_frontier_units(workspace_id,project_id,source_id,scope_key,ref_key)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,'repository',${refKey}) returning id::text`.execute(
          isolated.db,
        )
      ).rows[0]!.id;
      frontier = { unitId, observationSequence: 0 };
      frontiersByProjectRef.set(frontierKey, frontier);
    }
    frontier.observationSequence += 1;
    const unit = frontier.unitId;
    const observationSequence = frontier.observationSequence;
    const externalRevision = sourceSequence.toString(16).padStart(40, "a").slice(-40);
    const observation = (
      await sql<{
        id: string;
      }>`insert into memoid.source_observations(workspace_id,project_id,frontier_unit_id,
      observation_sequence,external_revision,observed_at) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unit}::uuid,
      ${observationSequence},${externalRevision},clock_timestamp()) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    if (observationSequence === 1) {
      await sql`insert into memoid.source_frontier_states(workspace_id,project_id,frontier_unit_id,observed_sequence,
        desired_sequence,ingested_sequence) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unit}::uuid,1,1,1)`.execute(
        isolated.db,
      );
    } else {
      await sql`update memoid.source_frontier_states set observed_sequence=${observationSequence},
        desired_sequence=${observationSequence},ingested_sequence=${observationSequence}
        where workspace_id=${f.workspaceId}::uuid and project_id=${f.projectId}::uuid
          and frontier_unit_id=${unit}::uuid`.execute(isolated.db);
    }
    const evidence = (
      await sql<{
        id: string;
      }>`insert into memoid.evidence_references(workspace_id,project_id,source_id,
      frontier_unit_id,source_observation_id,observation_sequence,evidence_kind,repository_revision,repository_path,
      provider_object_id,byte_size,content_sha256) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,
      ${unit}::uuid,${observation}::uuid,${observationSequence},'FILE',${externalRevision},${repositoryPath},${`${"a".repeat(39)}${sourceSequence}`.slice(-40)},
      42,${Buffer.alloc(32, sourceSequence)}::bytea) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    return { sourceId, unit, evidence: evidence as EvidenceReferenceId };
  }

  async function setAuthority(
    f: Fixture,
    sourceId: SourceId,
    options: {
      categoryFacet?: string;
      scopeKind?: "PROJECT" | "PATH_PREFIX";
      scopeKey?: string | null;
      refSelector?: "ANY_REF" | "DEFAULT_BRANCH" | "EXACT_REF";
      refKey?: string | null;
      expectedVersion?: number;
    } = {},
  ) {
    authoritySequence += 1;
    const authorityBase = {
      projectId: f.projectId,
      sourceId,
      categoryFacet: options.categoryFacet ?? "IMPLEMENTATION_STATE:CODE",
      scopeKind: options.scopeKind ?? ("PROJECT" as const),
      scopeKey: options.scopeKey ?? null,
      refSelector: options.refSelector ?? ("DEFAULT_BRANCH" as const),
      refKey: options.refKey ?? null,
      expectedVersion: options.expectedVersion ?? 0,
      reasonKey: "INITIAL_REVIEW" as const,
      reasonNote: "Reviewed",
    };
    return (
      await new SourceAuthorityService(f.authorityRepository).set(f.context, {
        ...authorityBase,
        idempotencyKeyHash: hashIdempotencyKey(`authority-${authoritySequence}`.padEnd(40, "a")),
        requestFingerprint: fingerprintLifecycleRequest(authorityBase),
      })
    ).assignmentId as SourceAuthorityAssignmentId;
  }

  async function sourceEvidence(f: Fixture) {
    const source = await createSourceEvidence(f);
    return { ...source, authority: await setAuthority(f, source.sourceId) };
  }

  function sourcePut(
    f: Fixture,
    evidenceReferenceId: EvidenceReferenceId,
    sourceAuthorityAssignmentId: SourceAuthorityAssignmentId,
    key: string,
    identityOverrides: Partial<typeof identity> = {},
  ) {
    const base = {
      projectId: f.projectId,
      identity: {
        subject: "codebase",
        scope: "runtime",
        facet: "implementation_state:code",
        predicate: key,
        ...identityOverrides,
      },
      expectedIdentityVersion: 0,
      expectedCurrentRecordId: null,
      payload: { value: key },
      originKind: "SOURCE_EVIDENCE" as const,
      evidenceReferenceId,
      sourceAuthorityAssignmentId,
    };
    return {
      ...base,
      idempotencyKeyHash: hashIdempotencyKey(key.padEnd(40, "s")),
      requestFingerprint: fingerprintLifecycleRequest(base),
    };
  }

  it("rejects an authority assignment from the wrong canonical category/facet", async () => {
    const source = await createSourceEvidence(owner);
    const authority = await setAuthority(owner, source.sourceId);
    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, source.evidence, authority, "wrong-facet", {
          facet: "architecture_intent:decision",
        }),
      ),
    ).rejects.toThrow("CONTEXT_AUTHORITY_MISSING");
  });

  it("requires the path-specific winner instead of broader Project authority", async () => {
    const broadSource = await createSourceEvidence(owner);
    const pathSource = await createSourceEvidence(owner, {
      repositoryPath: "packages/domain/src/context-record.ts",
    });
    const broad = await setAuthority(owner, broadSource.sourceId, {
      refSelector: "ANY_REF",
    });
    const path = await setAuthority(owner, pathSource.sourceId, {
      scopeKind: "PATH_PREFIX",
      scopeKey: "packages/domain",
      refSelector: "ANY_REF",
    });

    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, pathSource.evidence, broad, "broader-shadowed"),
      ),
    ).rejects.toThrow("CONTEXT_AUTHORITY_NOT_WINNER");
    await expect(
      owner.service.put(owner.context, sourcePut(owner, pathSource.evidence, path, "path-winner")),
    ).resolves.toMatchObject({ identityVersion: 1, recordVersion: 1, replayed: false });
  });

  it("applies exact-ref then default-branch then any-ref precedence", async () => {
    const anySource = await createSourceEvidence(owner);
    const defaultSource = await createSourceEvidence(owner);
    const exactSource = await createSourceEvidence(owner, { refKey: "refs/heads/feature" });
    const any = await setAuthority(owner, anySource.sourceId, { refSelector: "ANY_REF" });
    const defaultBranch = await setAuthority(owner, defaultSource.sourceId);
    const exact = await setAuthority(owner, exactSource.sourceId, {
      refSelector: "EXACT_REF",
      refKey: "refs/heads/feature",
    });

    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, defaultSource.evidence, any, "any-loses-to-default"),
      ),
    ).rejects.toThrow("CONTEXT_AUTHORITY_NOT_WINNER");
    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, defaultSource.evidence, defaultBranch, "default-winner"),
      ),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, exactSource.evidence, defaultBranch, "default-not-feature"),
      ),
    ).rejects.toThrow("CONTEXT_AUTHORITY_NOT_WINNER");
    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, exactSource.evidence, exact, "exact-winner"),
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it("rejects replaced authority and never falls back from a degraded winner", async () => {
    const originalSource = await createSourceEvidence(owner);
    const replacementSource = await createSourceEvidence(owner);
    const original = await setAuthority(owner, originalSource.sourceId, {
      refSelector: "ANY_REF",
    });
    const replacement = await setAuthority(owner, replacementSource.sourceId, {
      refSelector: "ANY_REF",
      expectedVersion: 1,
    });
    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, originalSource.evidence, original, "replaced-winner"),
      ),
    ).rejects.toThrow("CONTEXT_AUTHORITY_NOT_WINNER");

    const pathSource = await createSourceEvidence(owner, {
      repositoryPath: "packages/domain/src/context-record.ts",
    });
    await setAuthority(owner, pathSource.sourceId, {
      scopeKind: "PATH_PREFIX",
      scopeKey: "packages/domain",
      refSelector: "DEFAULT_BRANCH",
    });
    await sql`update memoid.github_source_connections set default_branch='trunk'
      where source_id=${pathSource.sourceId}::uuid`.execute(isolated.db);
    const revalidationEvidence = await createSourceEvidence(owner, {
      repositoryPath: "packages/domain/src/context-record.ts",
      refKey: "refs/heads/trunk",
    });
    await expect(
      owner.service.put(
        owner.context,
        sourcePut(owner, revalidationEvidence.evidence, replacement, "degraded-no-fallback"),
      ),
    ).rejects.toThrow("CONTEXT_AUTHORITY_UNAVAILABLE");
  });

  it("binds source Context to exact Evidence and Authority and preserves truthful freshness", async () => {
    const source = await sourceEvidence(owner);
    const base = {
      projectId: owner.projectId,
      identity: {
        subject: "codebase",
        scope: "runtime",
        facet: "implementation_state:code",
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
