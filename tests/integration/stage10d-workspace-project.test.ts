import { PostgresWorkspaceProjectRepository } from "../../packages/adapters/src/index.js";
import {
  WorkspaceProjectAccessError,
  WorkspaceProjectService,
} from "../../packages/application/src/index.js";
import {
  createDatabase,
  createDatabaseUuidV7,
  createLocalAuthSession,
  migrateToLatest,
  resolveAccountIdentity,
  revokeLocalAuthSession,
  withSecurityTransaction,
  type MemoidDatabase,
} from "@memoid/db";
import type { AccountId, WorkspaceId } from "../../packages/domain/src/index.js";
import {
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  hashSessionCredential,
} from "@memoid/security";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

function roleConnection(connectionString: string, role: "memoid_app" | "memoid_auth") {
  const url = new URL(connectionString);
  url.username = role;
  url.password = role === "memoid_app" ? "synthetic-app-password" : "synthetic-auth-password";
  return createDatabase(url.toString(), 6);
}

interface OwnerFixture {
  readonly accountId: AccountId;
  readonly workspaceId: WorkspaceId;
  readonly repository: PostgresWorkspaceProjectRepository;
  readonly service: WorkspaceProjectService;
  readonly context: Awaited<ReturnType<typeof ownerContext>>;
}

async function ownerContext(
  repository: PostgresWorkspaceProjectRepository,
  accountId: AccountId,
  workspaceId: WorkspaceId,
  sessionCredentialHash: Uint8Array,
) {
  const actor = await repository.ensureHumanActor(accountId, workspaceId);
  return {
    accountId,
    workspaceId,
    sessionCredentialHash,
    actor,
    principal: {
      kind: "HUMAN" as const,
      id: `provider:${accountId}`,
      accountId,
      active: true,
      sessionRevoked: false,
      roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId }],
    },
  };
}

suite("Stage 10D personal Workspace and private Project lifecycle", () => {
  let isolated: IsolatedTestDatabase;
  let app: Kysely<MemoidDatabase>;
  let auth: Kysely<MemoidDatabase>;
  const repositories: PostgresWorkspaceProjectRepository[] = [];
  let owner: OwnerFixture;
  let foreign: OwnerFixture;

  async function createOwner(subject: string): Promise<OwnerFixture> {
    const identity = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: subject,
      email: `${subject}@example.test`,
      emailVerified: true,
    });
    const repository = new PostgresWorkspaceProjectRepository(
      isolated.connectionString.replace("postgres:postgres", "memoid_app:synthetic-app-password"),
    );
    repositories.push(repository);
    const accountId = identity.accountId as AccountId;
    const sessionCredentialHash = hashSessionCredential(
      `stage10d-${subject}-session-credential`.padEnd(48, "x"),
    );
    await createLocalAuthSession(auth, {
      accountId,
      bindingId: identity.bindingId,
      tokenHash: sessionCredentialHash,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    const workspace = await repository.findPersonalWorkspace(accountId);
    if (!workspace) throw new Error("Expected personal Workspace");
    const context = await ownerContext(repository, accountId, workspace.id, sessionCredentialHash);
    return {
      accountId,
      workspaceId: workspace.id,
      repository,
      service: new WorkspaceProjectService(repository),
      context,
    };
  }

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10d_lifecycle");
    await migrateToLatest(isolated.db);
    app = roleConnection(isolated.connectionString, "memoid_app");
    auth = roleConnection(isolated.connectionString, "memoid_auth");
  });

  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
    owner = await createOwner("stage10d_owner");
    foreign = await createOwner("stage10d_foreign");
  });

  afterAll(async () => {
    await Promise.all(repositories.map((repository) => repository.close()));
    await app.destroy();
    await auth.destroy();
    await isolated.destroy();
  }, 60_000);

  function createInput(name: string, key: string, reviewPolicy: "MANUAL" | "AUTOMATIC" = "MANUAL") {
    return {
      displayName: name,
      description: null,
      reviewPolicy,
      idempotencyKeyHash: hashIdempotencyKey(key),
      requestFingerprint: fingerprintLifecycleRequest({
        displayName: name,
        description: null,
        reviewPolicy,
      }),
    };
  }

  it("provisions exactly one immutable personal Workspace and discovers only the owning Account", async () => {
    expect(await owner.repository.findPersonalWorkspace(owner.accountId)).toMatchObject({
      id: owner.workspaceId,
    });
    const visible = await withSecurityTransaction(
      app,
      { accountId: owner.accountId },
      async (trx) =>
        (await sql<{ id: string }>`select id::text from memoid.workspaces order by id`.execute(trx))
          .rows,
    );
    expect(visible).toEqual([{ id: owner.workspaceId }]);
    await expect(
      sql`update memoid.workspaces set account_id = ${foreign.accountId}::uuid where id = ${owner.workspaceId}::uuid`.execute(
        isolated.db,
      ),
    ).rejects.toThrow("ownership is immutable");
  });

  it("creates an active source-less Project atomically with policy and attributable audit history", async () => {
    const result = await owner.service.createProject(
      owner.context,
      createInput("Source-less project", "source-less-project-idempotency-key-0001", "AUTOMATIC"),
    );
    expect(result).toMatchObject({
      replayed: false,
      project: { lifecycleState: "ACTIVE", reviewPolicy: "AUTOMATIC", version: 1 },
    });
    const proof = await sql<{
      auditCount: string;
      idempotencyCount: string;
      policyCount: string;
      sourceCount: string;
    }>`select
      (select count(*)::text from memoid.project_review_policy_versions where project_id = ${result.project.id}::uuid) as "policyCount",
      (select count(*)::text from memoid.sources where project_id = ${result.project.id}::uuid) as "sourceCount",
      (select count(*)::text from memoid.audit_events where project_id = ${result.project.id}::uuid and actor_id = ${owner.context.actor.id}::uuid) as "auditCount",
      (select count(*)::text from memoid.idempotency_records where action_key = 'PROJECT_CREATE' and result_reference = ${result.project.id}) as "idempotencyCount"`.execute(
      isolated.db,
    );
    expect(proof.rows[0]).toEqual({
      policyCount: "1",
      sourceCount: "0",
      auditCount: "3",
      idempotencyCount: "1",
    });
  });

  it("collapses concurrent duplicate creates, replays stably, and rejects conflicting reuse", async () => {
    const input = createInput("Concurrent project", "concurrent-project-idempotency-key-0001");
    const results = await Promise.all([
      owner.service.createProject(owner.context, input),
      owner.service.createProject(owner.context, input),
      owner.service.createProject(owner.context, input),
    ]);
    expect(new Set(results.map((result) => result.project.id)).size).toBe(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(2);
    const replay = await owner.service.createProject(owner.context, input);
    expect(replay).toMatchObject({ replayed: true, project: { id: results[0]!.project.id } });
    await expect(
      owner.service.createProject(owner.context, {
        ...createInput("Different project", "concurrent-project-idempotency-key-0001"),
        idempotencyKeyHash: input.idempotencyKeyHash,
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rolls a failed transaction back completely so the same request can be retried", async () => {
    const input = createInput("Rollback project", "rollback-project-idempotency-key-000001");
    await expect(
      withSecurityTransaction(
        app,
        {
          accountId: owner.accountId,
          workspaceId: owner.workspaceId,
          actorId: owner.context.actor.id,
        },
        async (trx) => {
          await sql`select * from memoid.create_project(
            ${Buffer.from(owner.context.sessionCredentialHash)}::bytea,
            ${input.displayName}, null, 'MANUAL', ${Buffer.from(input.idempotencyKeyHash)}::bytea,
            ${Buffer.from(input.requestFingerprint)}::bytea, uuidv7(), null
          )`.execute(trx);
          throw new Error("synthetic rollback");
        },
      ),
    ).rejects.toThrow("synthetic rollback");
    await expect(owner.service.createProject(owner.context, input)).resolves.toMatchObject({
      replayed: false,
    });
  });

  it("isolates foreign Workspaces and keeps disabled Accounts unavailable", async () => {
    const own = await owner.service.createProject(
      owner.context,
      createInput("Private", "private-project-idempotency-key-000001"),
    );
    expect(await foreign.service.listProjects(foreign.context)).toEqual([]);
    await expect(foreign.service.readProject(foreign.context, own.project.id)).rejects.toEqual(
      new WorkspaceProjectAccessError("NOT_FOUND"),
    );
    await sql`update memoid.account_security_states set disabled_at = clock_timestamp()
      where account_id = ${owner.accountId}::uuid`.execute(isolated.db);
    expect(await owner.repository.findPersonalWorkspace(owner.accountId)).toBeNull();
    await expect(
      owner.service.createProject(
        owner.context,
        createInput("Denied", "disabled-project-idempotency-key-0001"),
      ),
    ).rejects.toThrow("RESOURCE_NOT_FOUND");
  });

  it("denies foreign Workspace creation and HUMAN Actor spoofing at the database boundary", async () => {
    const input = createInput("Foreign attempt", "foreign-workspace-idempotency-key-00001");
    const invoke = (workspaceId: string, actorId: string) =>
      withSecurityTransaction(app, { accountId: owner.accountId, workspaceId, actorId }, (trx) =>
        sql`select * from memoid.create_project(
            ${Buffer.from(owner.context.sessionCredentialHash)}::bytea,
            ${input.displayName}, null, 'MANUAL', ${Buffer.from(input.idempotencyKeyHash)}::bytea,
            ${Buffer.from(input.requestFingerprint)}::bytea, uuidv7(), null
          )`.execute(trx),
      );
    await expect(invoke(foreign.workspaceId, owner.context.actor.id)).rejects.toThrow(
      "RESOURCE_NOT_FOUND",
    );
    await expect(invoke(owner.workspaceId, foreign.context.actor.id)).rejects.toThrow(
      "ACTOR_MISMATCH",
    );
  });

  it("rechecks the current session before exposing a completed idempotent replay", async () => {
    const input = createInput("Revoked replay", "revoked-replay-idempotency-key-0000001");
    await owner.service.createProject(owner.context, input);
    await revokeLocalAuthSession(
      auth,
      owner.context.sessionCredentialHash,
      "USER_LOGOUT",
      await createDatabaseUuidV7(auth),
    );
    await expect(owner.service.createProject(owner.context, input)).rejects.toThrow(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("serializes Account disablement against an in-flight Project creation", async () => {
    const input = createInput("Linearized project", "linearized-project-idempotency-key-00001");
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inside = new Promise<void>((resolve) => (reached = resolve));
    const creating = withSecurityTransaction(
      app,
      {
        accountId: owner.accountId,
        workspaceId: owner.workspaceId,
        actorId: owner.context.actor.id,
      },
      async (trx) => {
        await sql`select * from memoid.create_project(
          ${Buffer.from(owner.context.sessionCredentialHash)}::bytea,
          ${input.displayName}, null, 'MANUAL', ${Buffer.from(input.idempotencyKeyHash)}::bytea,
          ${Buffer.from(input.requestFingerprint)}::bytea, uuidv7(), null
        )`.execute(trx);
        reached();
        await gate;
      },
    );
    await inside;
    let disableCommitted = false;
    const disabling = sql`update memoid.account_security_states set disabled_at = clock_timestamp()
      where account_id = ${owner.accountId}::uuid`
      .execute(isolated.db)
      .then(() => {
        disableCommitted = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(disableCommitted).toBe(false);
    release();
    await creating;
    await disabling;
    expect(disableCommitted).toBe(true);
    await expect(
      owner.service.createProject(
        owner.context,
        createInput("After disable", "after-disable-idempotency-key-00000001"),
      ),
    ).rejects.toThrow("RESOURCE_NOT_FOUND");
  });

  it("uses optimistic versions, rejects stale writes, and denies exact access after archival", async () => {
    const created = await owner.service.createProject(
      owner.context,
      createInput("Version one", "version-project-idempotency-key-000001"),
    );
    const updated = await owner.service.updateProject(owner.context, {
      projectId: created.project.id,
      expectedVersion: 1,
      displayName: "Version two",
      description: "Changed once",
    });
    expect(updated).toMatchObject({ displayName: "Version two", version: 2 });
    await expect(
      owner.service.updateProject(owner.context, {
        projectId: created.project.id,
        expectedVersion: 1,
        displayName: "Stale",
      }),
    ).rejects.toThrow("STALE_PROJECT_VERSION");
    await sql`update memoid.projects set lifecycle_state = 'ARCHIVED', archived_at = clock_timestamp()
      where id = ${created.project.id}::uuid`.execute(isolated.db);
    expect(await owner.service.listProjects(owner.context)).toEqual([
      expect.objectContaining({ id: created.project.id, lifecycleState: "ARCHIVED" }),
    ]);
    await expect(owner.service.readProject(owner.context, created.project.id)).rejects.toEqual(
      new WorkspaceProjectAccessError("NOT_FOUND"),
    );
  });

  it("exposes lifecycle commands only to memoid_app and never to memoid_auth", async () => {
    const privileges = await sql<{ app: boolean; auth: boolean; public: boolean }>`select
      has_function_privilege('memoid_app', 'memoid.create_project(bytea,text,text,character varying,bytea,bytea,uuid,uuid)', 'execute') as app,
      has_function_privilege('memoid_auth', 'memoid.create_project(bytea,text,text,character varying,bytea,bytea,uuid,uuid)', 'execute') as auth,
      has_function_privilege('public', 'memoid.create_project(bytea,text,text,character varying,bytea,bytea,uuid,uuid)', 'execute') as public`.execute(
      isolated.db,
    );
    expect(privileges.rows[0]).toEqual({ app: true, auth: false, public: false });
    await expect(sql`select * from memoid.projects`.execute(auth)).rejects.toThrow();
    await expect(
      withSecurityTransaction(
        app,
        { accountId: owner.accountId, workspaceId: owner.workspaceId },
        (trx) =>
          sql`insert into memoid.projects (workspace_id, display_name) values (${owner.workspaceId}::uuid, 'Bypass')`.execute(
            trx,
          ),
      ),
    ).rejects.toThrow();
  });
});
