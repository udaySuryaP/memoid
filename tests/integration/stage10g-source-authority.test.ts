import {
  PostgresSourceAuthorityRepository,
  PostgresWorkspaceProjectRepository,
} from "../../packages/adapters/src/index.js";
import {
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
  ProjectId,
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

function roleConnection(connectionString: string, role: "memoid_app" | "memoid_auth") {
  const url = new URL(connectionString);
  url.username = role;
  url.password = role === "memoid_app" ? "synthetic-app-password" : "synthetic-auth-password";
  return createDatabase(url.toString(), 8);
}

interface Fixture {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  sourceId: SourceId;
  service: SourceAuthorityService;
  authorityRepository: PostgresSourceAuthorityRepository;
  projectRepository: PostgresWorkspaceProjectRepository;
  context: {
    accountId: AccountId;
    workspaceId: WorkspaceId;
    sessionCredentialHash: Uint8Array;
    actor: Awaited<ReturnType<PostgresWorkspaceProjectRepository["ensureHumanActor"]>>;
    freshAuthenticationSatisfied: boolean;
    principal: {
      kind: "HUMAN";
      id: string;
      accountId: AccountId;
      active: true;
      sessionRevoked: false;
      roleAssignments: readonly [
        { readonly role: "PERSONAL_WORKSPACE_OWNER"; readonly workspaceId: WorkspaceId },
      ];
    };
  };
}

suite("Stage 10G Source Authority PostgreSQL", () => {
  let isolated: IsolatedTestDatabase;
  let app: Kysely<MemoidDatabase>;
  let auth: Kysely<MemoidDatabase>;
  const closables: Array<{ close(): Promise<void> }> = [];
  let repositoryId = 10_000;
  let owner: Fixture;
  let foreign: Fixture;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10g_authority");
    await migrateToLatest(isolated.db);
    app = roleConnection(isolated.connectionString, "memoid_app");
    auth = roleConnection(isolated.connectionString, "memoid_auth");
  });

  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
    owner = await createFixture("owner");
    foreign = await createFixture("foreign");
  });

  afterAll(async () => {
    await Promise.all(closables.map((value) => value.close()));
    await app.destroy();
    await auth.destroy();
    await isolated.destroy();
  }, 60_000);

  async function createFixture(label: string): Promise<Fixture> {
    const subject = `stage10g_${label}`;
    const identity = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: subject,
      email: `${subject}@example.test`,
      emailVerified: true,
    });
    const accountId = identity.accountId as AccountId;
    const originalToken = hashSessionCredential(`${subject}-original-credential`.padEnd(48, "x"));
    await createLocalAuthSession(auth, {
      accountId,
      bindingId: identity.bindingId,
      tokenHash: originalToken,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    const projectRepository = new PostgresWorkspaceProjectRepository(
      isolated.connectionString.replace("postgres:postgres", "memoid_app:synthetic-app-password"),
    );
    closables.push(projectRepository);
    const workspace = await projectRepository.findPersonalWorkspace(accountId);
    if (!workspace) throw new Error("Expected personal Workspace");
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
    const projectService = new WorkspaceProjectService(projectRepository);
    const project = (
      await projectService.createProject(
        {
          accountId,
          workspaceId: workspace.id,
          sessionCredentialHash: originalToken,
          actor,
          principal,
        },
        {
          displayName: `Authority ${label}`,
          reviewPolicy: "MANUAL",
          idempotencyKeyHash: hashIdempotencyKey(`${subject}-project-key`.padEnd(40, "x")),
          requestFingerprint: fingerprintLifecycleRequest({ label }),
        },
      )
    ).project;
    const sourceId = (
      await sql<{ id: string }>`insert into memoid.sources (workspace_id, project_id, source_kind)
        values (${workspace.id}::uuid, ${project.id}::uuid, 'GITHUB_REPOSITORY') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as SourceId;
    await sql`insert into memoid.github_source_connections (
      workspace_id, project_id, source_id, app_id, installation_id, account_id,
      repository_id, owner_login, repository_name, full_name, html_url, visibility,
      default_branch, connection_state, verified_at
    ) values (${workspace.id}::uuid, ${project.id}::uuid, ${sourceId}::uuid, '123', '456', '789',
      ${(repositoryId++).toString()}, 'owner', ${label}, ${`owner/${label}`},
      ${`https://github.com/owner/${label}`}, 'PRIVATE', 'main', 'ACTIVE', clock_timestamp())`.execute(
      isolated.db,
    );

    const nonce = Buffer.alloc(32, label === "owner" ? 31 : 32);
    const intentId = await createStepUpIntent(auth, {
      tokenHash: originalToken,
      nonceHash: nonce,
      actionKey: "MANAGE_SOURCE_AUTHORITY",
      workspaceId: workspace.id,
      projectId: project.id,
      returnPath: `/projects/${project.id}/sources/authority`,
      correlationId: await createDatabaseUuidV7(auth),
    });
    const rotatedToken = hashSessionCredential(`${subject}-rotated-credential`.padEnd(48, "y"));
    await completeStepUpIntent(auth, {
      oldTokenHash: originalToken,
      nonceHash: nonce,
      intentId,
      newTokenHash: rotatedToken,
      providerSubject: subject,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    const authorityRepository = new PostgresSourceAuthorityRepository(
      isolated.connectionString.replace("postgres:postgres", "memoid_app:synthetic-app-password"),
    );
    closables.push(authorityRepository);
    return {
      accountId,
      workspaceId: workspace.id,
      projectId: project.id,
      sourceId,
      projectRepository,
      authorityRepository,
      service: new SourceAuthorityService(authorityRepository),
      context: {
        accountId,
        workspaceId: workspace.id,
        sessionCredentialHash: rotatedToken,
        actor,
        principal,
        freshAuthenticationSatisfied: true,
      },
    };
  }

  function setInput(f: Fixture, key: string, expectedVersion = 0) {
    const base = {
      projectId: f.projectId,
      sourceId: f.sourceId,
      categoryFacet: "IMPLEMENTATION_STATE:CODE",
      scopeKind: "PROJECT" as const,
      scopeKey: null,
      refSelector: "DEFAULT_BRANCH" as const,
      refKey: null,
      expectedVersion,
      reasonKey:
        expectedVersion === 0
          ? ("INITIAL_REVIEW" as const)
          : ("DEFAULT_BRANCH_REVALIDATION" as const),
      reasonNote: "Reviewed by the Project owner",
    };
    return {
      ...base,
      idempotencyKeyHash: hashIdempotencyKey(key.padEnd(40, "k")),
      requestFingerprint: fingerprintLifecycleRequest(base),
    };
  }

  async function addRefState(
    f: Fixture,
    refKey: string,
    input: { observed: boolean; desired: number; ingested: number | null },
  ) {
    const unitId = (
      await sql<{ id: string }>`insert into memoid.source_frontier_units(
        workspace_id,project_id,source_id,scope_key,ref_key
      ) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${f.sourceId}::uuid,'repository',${refKey})
      returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    if (input.observed) {
      for (let sequence = 1; sequence <= input.desired; sequence += 1) {
        await sql`insert into memoid.source_observations(
          workspace_id,project_id,frontier_unit_id,observation_sequence,external_revision,observed_at
        ) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unitId}::uuid,${sequence},
          ${String(sequence).repeat(40).slice(0, 40)},clock_timestamp())`.execute(isolated.db);
      }
    }
    await sql`insert into memoid.source_frontier_states(
      workspace_id,project_id,frontier_unit_id,observed_sequence,desired_sequence,ingested_sequence
    ) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unitId}::uuid,
      ${input.observed ? input.desired : null},${input.observed ? input.desired : null},${input.ingested})`.execute(
      isolated.db,
    );
    return unitId;
  }

  it("creates, replaces, revokes, audits, and preserves immutable history without Context promotion", async () => {
    const first = await owner.service.set(owner.context, setInput(owner, "first"));
    expect(first).toMatchObject({ version: 1, replayed: false });
    expect(await owner.service.set(owner.context, setInput(owner, "first"))).toEqual({
      ...first,
      replayed: true,
    });
    const replacement = await owner.service.set(owner.context, setInput(owner, "replace", 1));
    expect(replacement.version).toBe(2);
    const current = await owner.service.overview(owner.context, owner.projectId);
    expect(current.assignments).toEqual([
      expect.objectContaining({
        id: replacement.assignmentId,
        version: 2,
        qualification: "SOURCE_UNOBSERVED",
      }),
    ]);
    const scopeId = current.assignments[0]!.scopeId;
    const revokeBase = {
      projectId: owner.projectId,
      scopeId,
      expectedVersion: 2,
      reasonKey: "SCOPE_CORRECTION" as const,
      reasonNote: "No longer applicable",
    };
    await owner.service.revoke(owner.context, {
      ...revokeBase,
      idempotencyKeyHash: hashIdempotencyKey("revoke".padEnd(40, "r")),
      requestFingerprint: fingerprintLifecycleRequest(revokeBase),
    });
    expect((await owner.service.overview(owner.context, owner.projectId)).assignments).toEqual([]);
    const proof = (
      await sql<{ assignments: string; endings: string; audits: string; contexts: string }>`select
        (select count(*)::text from memoid.source_authority_assignments where project_id = ${owner.projectId}::uuid) as assignments,
        (select count(*)::text from memoid.source_authority_assignment_endings where project_id = ${owner.projectId}::uuid) as endings,
        (select count(*)::text from memoid.audit_events where project_id = ${owner.projectId}::uuid and event_type like 'SOURCE_AUTHORITY_%') as audits,
        (select count(*)::text from memoid.context_records where project_id = ${owner.projectId}::uuid) as contexts`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(proof).toEqual({ assignments: "2", endings: "2", audits: "3", contexts: "0" });
    await expect(
      sql`update memoid.source_authority_assignments set reason_note = 'rewritten'`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("immutable");
  });

  it("serializes concurrent writers, rejects stale versions, and fails closed on malformed vocabulary", async () => {
    const raced = await Promise.allSettled([
      owner.service.set(owner.context, setInput(owner, "race-a")),
      owner.service.set(owner.context, setInput(owner, "race-b")),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining("STALE_AUTHORITY_VERSION"),
      }),
    });
    await expect(owner.service.set(owner.context, setInput(owner, "stale", 0))).rejects.toThrow(
      "STALE_AUTHORITY_VERSION",
    );
    await expect(
      owner.service.set(owner.context, {
        ...setInput(owner, "unknown", 1),
        categoryFacet: "GLOBAL:TRUTH",
      }),
    ).rejects.toThrow("Unsupported");
  });

  it("hides foreign Projects and denies absent scoped step-up or forged Actor attribution", async () => {
    await expect(foreign.service.overview(foreign.context, owner.projectId)).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      owner.service.set(
        { ...owner.context, freshAuthenticationSatisfied: false },
        setInput(owner, "not-fresh"),
      ),
    ).rejects.toThrow("STEP_UP_REQUIRED");
    await expect(
      owner.service.set(
        { ...owner.context, actor: foreign.context.actor },
        setInput(owner, "forged"),
      ),
    ).rejects.toThrow("DENIED");
    const visible = await withSecurityTransaction(
      app,
      {
        accountId: foreign.accountId,
        workspaceId: foreign.workspaceId,
        projectId: foreign.projectId,
        actorId: foreign.context.actor.id,
      },
      (trx) =>
        sql<{
          count: string;
        }>`select count(*)::text as count from memoid.source_authority_assignments
      where project_id = ${owner.projectId}::uuid`.execute(trx),
    );
    expect(visible.rows[0]?.count).toBe("0");
  });

  it("requires revalidation after default-branch drift and never falls back after Source loss", async () => {
    await owner.service.set(owner.context, setInput(owner, "drift"));
    await sql`update memoid.github_source_connections set default_branch = 'trunk'
      where source_id = ${owner.sourceId}::uuid`.execute(isolated.db);
    expect(
      (await owner.service.overview(owner.context, owner.projectId)).assignments[0]?.qualification,
    ).toBe("REVALIDATION_REQUIRED");
    await sql`update memoid.github_source_connections set connection_state = 'REPOSITORY_ACCESS_REMOVED'
      where source_id = ${owner.sourceId}::uuid`.execute(isolated.db);
    expect(
      (await owner.service.overview(owner.context, owner.projectId)).assignments[0]?.qualification,
    ).toBe("SOURCE_UNAVAILABLE");
    await expect(
      owner.service.set(owner.context, setInput(owner, "unavailable", 1)),
    ).rejects.toThrow("SOURCE_UNAVAILABLE");
  });

  it("isolates exact-ref health from unrelated observed and behind refs", async () => {
    const exactBase = {
      ...setInput(owner, "exact-main"),
      refSelector: "EXACT_REF" as const,
      refKey: "refs/heads/main",
    };
    const exact = await owner.service.set(owner.context, {
      ...exactBase,
      requestFingerprint: fingerprintLifecycleRequest(exactBase),
    });
    await addRefState(owner, "refs/heads/feature", {
      observed: true,
      desired: 2,
      ingested: 1,
    });
    expect(
      (await owner.service.overview(owner.context, owner.projectId)).assignments.find(
        (assignment) => assignment.id === exact.assignmentId,
      )?.qualification,
    ).toBe("SOURCE_UNOBSERVED");

    const mainUnit = await addRefState(owner, "refs/heads/main", {
      observed: true,
      desired: 1,
      ingested: 1,
    });
    expect(
      (await owner.service.overview(owner.context, owner.projectId)).assignments.find(
        (assignment) => assignment.id === exact.assignmentId,
      )?.qualification,
    ).toBe("EFFECTIVE");
    await sql`insert into memoid.source_observations(
      workspace_id,project_id,frontier_unit_id,observation_sequence,external_revision,observed_at
    ) values(${owner.workspaceId}::uuid,${owner.projectId}::uuid,${mainUnit}::uuid,2,
      ${"b".repeat(40)},clock_timestamp())`.execute(isolated.db);
    await sql`update memoid.source_frontier_states set desired_sequence=2
      where frontier_unit_id=${mainUnit}::uuid`.execute(isolated.db);
    expect(
      (await owner.service.overview(owner.context, owner.projectId)).assignments.find(
        (assignment) => assignment.id === exact.assignmentId,
      )?.qualification,
    ).toBe("SOURCE_BEHIND");
  });

  it("treats ANY_REF as effective when at least one applicable ref is current", async () => {
    await addRefState(owner, "refs/heads/main", { observed: true, desired: 1, ingested: 1 });
    await addRefState(owner, "refs/heads/feature", { observed: true, desired: 2, ingested: 1 });
    const anyBase = {
      ...setInput(owner, "any-ref"),
      refSelector: "ANY_REF" as const,
      refKey: null,
    };
    const any = await owner.service.set(owner.context, {
      ...anyBase,
      requestFingerprint: fingerprintLifecycleRequest(anyBase),
    });
    expect(
      (await owner.service.overview(owner.context, owner.projectId)).assignments.find(
        (assignment) => assignment.id === any.assignmentId,
      )?.qualification,
    ).toBe("EFFECTIVE");
  });
});
