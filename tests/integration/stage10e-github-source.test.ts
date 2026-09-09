import {
  PostgresGitHubLifecycleRepository,
  PostgresGitHubSourceRepository,
  PostgresWorkspaceProjectRepository,
} from "../../packages/adapters/src/index.js";
import { WorkspaceProjectService } from "../../packages/application/src/index.js";
import {
  githubProviderId,
  verifiedGitHubRepository,
  type AccountId,
} from "../../packages/domain/src/index.js";
import {
  createDatabase,
  createDatabaseUuidV7,
  createLocalAuthSession,
  migrateToLatest,
  resolveAccountIdentity,
} from "@memoid/db";
import {
  createOpaqueProviderState,
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  hashSessionCredential,
} from "@memoid/security";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10E GitHub Source lifecycle", () => {
  let isolated: IsolatedTestDatabase;
  let workspaceRepository: PostgresWorkspaceProjectRepository;
  let githubRepository: PostgresGitHubSourceRepository;
  let providerRepository: PostgresGitHubLifecycleRepository;
  let auth: ReturnType<typeof createDatabase>;
  let context: Awaited<ReturnType<typeof createContext>>;
  let projectId: Awaited<ReturnType<WorkspaceProjectService["createProject"]>>["project"]["id"];

  async function createContext() {
    const identity = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: "stage10e-owner",
      email: "stage10e-owner@example.test",
      emailVerified: true,
    });
    const credential = hashSessionCredential("stage10e-session-credential-0000000000000001");
    await createLocalAuthSession(auth, {
      accountId: identity.accountId,
      bindingId: identity.bindingId,
      tokenHash: credential,
      providerSessionId: "stage10e-provider-session",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    const accountId = identity.accountId as AccountId;
    const workspace = await workspaceRepository.findPersonalWorkspace(accountId);
    if (!workspace) throw new Error("Expected Personal Workspace");
    const actor = await workspaceRepository.ensureHumanActor(accountId, workspace.id);
    return {
      accountId,
      workspaceId: workspace.id,
      sessionCredentialHash: credential,
      actor,
      principal: {
        kind: "HUMAN" as const,
        id: "stage10e-owner",
        accountId,
        active: true,
        sessionRevoked: false,
        roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId: workspace.id }],
      },
    };
  }

  function candidate(repositoryId = "987654321", installationId = "456") {
    return verifiedGitHubRepository({
      appId: githubProviderId("123"),
      installationId: githubProviderId(installationId),
      accountId: githubProviderId("789"),
      repositoryId: githubProviderId(repositoryId),
      ownerLogin: "memoid-owner",
      repositoryName: "memoid",
      fullName: "memoid-owner/memoid",
      htmlUrl: "https://github.com/memoid-owner/memoid",
      visibility: "PRIVATE",
      defaultBranch: "main",
      verifiedAt: new Date().toISOString(),
    });
  }

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10e_lifecycle");
    await migrateToLatest(isolated.db);
    const roleUrl = (role: string, password: string) => {
      const url = new URL(isolated.connectionString);
      url.username = role;
      url.password = password;
      return url.toString();
    };
    auth = createDatabase(roleUrl("memoid_auth", "synthetic-auth-password"), 2);
    workspaceRepository = new PostgresWorkspaceProjectRepository(
      roleUrl("memoid_app", "synthetic-app-password"),
    );
    githubRepository = new PostgresGitHubSourceRepository(
      roleUrl("memoid_app", "synthetic-app-password"),
    );
    providerRepository = new PostgresGitHubLifecycleRepository(
      roleUrl("memoid_provider", "synthetic-provider-password"),
    );
    context = await createContext();
    const service = new WorkspaceProjectService(workspaceRepository);
    const project = await service.createProject(context, {
      displayName: "GitHub identity proof",
      reviewPolicy: "MANUAL",
      idempotencyKeyHash: hashIdempotencyKey("stage10e-project-idempotency-key-0000001"),
      requestFingerprint: fingerprintLifecycleRequest({ displayName: "GitHub identity proof" }),
    });
    projectId = project.project.id;
  });

  afterAll(async () => {
    await Promise.all([
      auth.destroy(),
      workspaceRepository.close(),
      githubRepository.close(),
      providerRepository.close(),
    ]);
    await isolated.destroy();
  }, 60_000);

  it("connects one verified repository atomically and replays one stable Source", async () => {
    const intent = await githubRepository.begin(context, projectId);
    await githubRepository.recordCandidate(context, {
      projectId,
      intentId: intent.id,
      rawState: intent.rawState,
      repository: candidate(),
    });
    const request = {
      projectId,
      intentId: intent.id,
      rawState: intent.rawState,
      repositoryId: "987654321",
      idempotencyKeyHash: hashIdempotencyKey("stage10e-connect-idempotency-key-000001"),
      requestFingerprint: fingerprintLifecycleRequest({ repositoryId: "987654321" }),
    };
    const connected = await githubRepository.connect(context, request);
    expect(connected.replayed).toBe(false);
    await sql`update memoid.github_connection_intents set expires_at = created_at + interval '1 microsecond'
      where id = ${intent.id}::uuid`.execute(isolated.db);
    await sql`update memoid.github_repository_candidates set expires_at = verified_at + interval '1 microsecond'
      where intent_id = ${intent.id}::uuid`.execute(isolated.db);
    expect(await githubRepository.connect(context, request)).toEqual({
      sourceId: connected.sourceId,
      replayed: true,
    });
    expect(await githubRepository.find(context, projectId)).toMatchObject({
      sourceId: connected.sourceId,
      repositoryId: "987654321",
      state: "ACTIVE",
    });
    expect(
      (
        await sql<{
          count: string;
        }>`select count(*)::text as count from memoid.source_observations`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("0");
  });

  it("deduplicates provider delivery, preserves stronger state, and rejects replacement", async () => {
    const signal = {
      appId: "123",
      installationId: "456",
      repositoryId: "987654321",
      deliveryId: "00000000-0000-4000-8000-000000000010",
      state: "REPOSITORY_ACCESS_REMOVED" as const,
      payloadHash: Buffer.alloc(32, 1),
      providerOccurredAt: null,
    };
    expect(await providerRepository.apply(signal)).toBe(1);
    expect(await providerRepository.apply(signal)).toBe(0);
    await expect(
      providerRepository.apply({ ...signal, payloadHash: Buffer.alloc(32, 2) }),
    ).rejects.toThrow(/PROVIDER_DELIVERY_CONFLICT/u);
    expect((await githubRepository.find(context, projectId))?.state).toBe(
      "REPOSITORY_ACCESS_REMOVED",
    );
    expect(
      await providerRepository.apply({
        ...signal,
        deliveryId: "00000000-0000-4000-8000-000000000011",
        state: "VERIFICATION_REQUIRED",
      }),
    ).toBe(0);
    expect((await githubRepository.find(context, projectId))?.state).toBe(
      "REPOSITORY_ACCESS_REMOVED",
    );

    const replacement = await githubRepository.begin(context, projectId);
    await githubRepository.recordCandidate(context, {
      projectId,
      intentId: replacement.id,
      rawState: replacement.rawState,
      repository: candidate("987654322"),
    });
    await expect(
      githubRepository.connect(context, {
        projectId,
        intentId: replacement.id,
        rawState: replacement.rawState,
        repositoryId: "987654322",
        idempotencyKeyHash: hashIdempotencyKey("stage10e-replace-idempotency-key-00001"),
        requestFingerprint: fingerprintLifecycleRequest({ repositoryId: "987654322" }),
      }),
    ).rejects.toThrow(/REPLACEMENT_REQUIRES_SEPARATE_WORKFLOW/u);
  });

  it("rotates callback state once and rejects the retired value", async () => {
    const intent = await githubRepository.begin(context, projectId);
    const rotated = await githubRepository.rotateState(context, {
      projectId,
      intentId: intent.id,
      rawState: intent.rawState,
    });
    expect(rotated).not.toBe(intent.rawState);
    await expect(
      githubRepository.rotateState(context, {
        projectId,
        intentId: intent.id,
        rawState: intent.rawState,
      }),
    ).rejects.toThrow(/GITHUB_CONNECTION_INTENT_INVALID/u);
    expect(createOpaqueProviderState().state).toHaveLength(43);
  });

  it("lets a pre-binding lifecycle signal fence a later verified selection", async () => {
    expect(
      await providerRepository.apply({
        appId: "123",
        installationId: "999",
        repositoryId: "777",
        deliveryId: "00000000-0000-4000-8000-000000000012",
        state: "REPOSITORY_ACCESS_REMOVED",
        payloadHash: Buffer.alloc(32, 3),
        providerOccurredAt: null,
      }),
    ).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const intent = await githubRepository.begin(context, projectId);
    await githubRepository.recordCandidate(context, {
      projectId,
      intentId: intent.id,
      rawState: intent.rawState,
      repository: candidate("777", "999"),
    });
    await expect(
      githubRepository.connect(context, {
        projectId,
        intentId: intent.id,
        rawState: intent.rawState,
        repositoryId: "777",
        idempotencyKeyHash: hashIdempotencyKey("stage10e-fenced-idempotency-key-000001"),
        requestFingerprint: fingerprintLifecycleRequest({ repositoryId: "777" }),
      }),
    ).rejects.toThrow(/GITHUB_PROVIDER_STATE_CHANGED/u);
  });
});
