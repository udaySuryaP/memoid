import { PostgresWorkspaceProjectRepository } from "../../packages/adapters/src/index.js";
import { WorkspaceProjectService } from "../../packages/application/src/index.js";
import {
  createDatabase,
  createDatabaseUuidV7,
  createLocalAuthSession,
  migrateToLatest,
  resolveAccountIdentity,
} from "../../packages/db/src/index.js";
import type { AccountId } from "../../packages/domain/src/index.js";
import {
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  hashSessionCredential,
} from "../../packages/security/src/index.js";
import { sql } from "kysely";

export const E2E_SESSION_TOKEN = "stage10d-e2e-session-credential-000001";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const authUrl = process.env.AUTH_DATABASE_URL;
if (process.env.STAGE10D_E2E !== "1" || !adminUrl || !appUrl || !authUrl) {
  throw new Error("Stage 10D browser seed requires explicit isolated-database configuration");
}
if (new URL(adminUrl).pathname !== "/memoid_test") {
  throw new Error("Stage 10D browser seed refuses a non-test database");
}

const admin = createDatabase(adminUrl, 2);
const auth = createDatabase(authUrl, 2);
const repository = new PostgresWorkspaceProjectRepository(appUrl);
try {
  await migrateToLatest(admin);
  await sql`truncate table memoid.accounts cascade`.execute(admin);
  const identity = await resolveAccountIdentity(auth, {
    providerKey: "workos",
    providerSubject: "stage10d_browser_owner",
    email: "browser-owner@example.test",
    emailVerified: true,
  });
  await createLocalAuthSession(auth, {
    accountId: identity.accountId,
    bindingId: identity.bindingId,
    tokenHash: hashSessionCredential(E2E_SESSION_TOKEN),
    providerSessionId: "stage10d_browser_session",
    freshAuthenticatedAt: new Date(),
    providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    correlationId: await createDatabaseUuidV7(auth),
  });
  const accountId = identity.accountId as AccountId;
  const workspace = await repository.findPersonalWorkspace(accountId);
  if (!workspace) throw new Error("Browser owner Workspace was not provisioned");
  const actor = await repository.ensureHumanActor(accountId, workspace.id);
  const context = {
    accountId,
    workspaceId: workspace.id,
    sessionCredentialHash: hashSessionCredential(E2E_SESSION_TOKEN),
    actor,
    principal: {
      kind: "HUMAN" as const,
      id: "stage10d_browser_owner",
      accountId,
      active: true,
      sessionRevoked: false,
      roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId: workspace.id }],
    },
  };
  const service = new WorkspaceProjectService(repository);
  const displayName = "Browser proof project";
  const description = "Private, source-less, and ready for review.";
  const reviewPolicy = "MANUAL" as const;
  await service.createProject(context, {
    displayName,
    description,
    reviewPolicy,
    idempotencyKeyHash: hashIdempotencyKey("stage10d-browser-seed-idempotency-key-0001"),
    requestFingerprint: fingerprintLifecycleRequest({ displayName, description, reviewPolicy }),
  });
} finally {
  await repository.close();
  await auth.destroy();
  await admin.destroy();
}
