import {
  assertRuntimeDatabaseRole,
  authenticateLocalSession,
  completeStepUpIntent,
  createDatabase,
  createDatabaseUuidV7,
  createLocalAuthSession,
  createStepUpIntent,
  createMigrator,
  migrateToLatest,
  resolveAccountIdentity,
  revokeProviderAuthSession,
  revokeProviderIdentitySessions,
  withSecurityTransaction,
  type MemoidDatabase,
} from "@memoid/db";
import { MemoidAuthSessionStore } from "../../packages/auth/src/index.js";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

function appConnection(connectionString: string, max = 1): Kysely<MemoidDatabase> {
  const url = new URL(connectionString);
  url.username = "memoid_app";
  url.password = "synthetic-app-password";
  return createDatabase(url.toString(), max);
}

suite("Stage 10C identity, sessions, and forced RLS", () => {
  let isolated: IsolatedTestDatabase;
  let app: Kysely<MemoidDatabase>;
  let accountA: string;
  let accountB: string;
  let workspaceA: string;
  let workspaceB: string;
  let projectA: string;
  let projectB: string;
  let actorA: string;
  const tokenA = Buffer.alloc(32, 11);

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10c_security");
    await migrateToLatest(isolated.db);
    app = appConnection(isolated.connectionString);
    const identityA = await resolveAccountIdentity(app, {
      providerKey: "workos",
      providerSubject: "user_account_a",
      email: "owner-a@example.test",
      emailVerified: true,
    });
    const identityB = await resolveAccountIdentity(app, {
      providerKey: "workos",
      providerSubject: "user_account_b",
      email: "owner-b@example.test",
      emailVerified: true,
    });
    accountA = identityA.accountId;
    accountB = identityB.accountId;
    workspaceA = (
      await sql<{
        id: string;
      }>`select id::text from memoid.workspaces where account_id = ${accountA}::uuid`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    workspaceB = (
      await sql<{
        id: string;
      }>`select id::text from memoid.workspaces where account_id = ${accountB}::uuid`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    projectA = (
      await sql<{
        id: string;
      }>`insert into memoid.projects (workspace_id) values (${workspaceA}::uuid)
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    projectB = (
      await sql<{
        id: string;
      }>`insert into memoid.projects (workspace_id) values (${workspaceB}::uuid)
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id;

    await createLocalAuthSession(app, {
      accountId: accountA,
      bindingId: identityA.bindingId,
      tokenHash: tokenA,
      providerSessionId: "session_account_a",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(app),
    });
    actorA = await withSecurityTransaction(
      app,
      { accountId: accountA, workspaceId: workspaceA },
      async (trx) =>
        (
          await sql<{ id: string }>`insert into memoid.actors
            (workspace_id, actor_kind, actor_reference, display_label)
            values (${workspaceA}::uuid, 'HUMAN', ${`account:${accountA}`}, 'Account owner')
            returning id::text`.execute(trx)
        ).rows[0]!.id,
    );
  });

  afterAll(async () => {
    await app.destroy();
    await isolated.destroy();
  });

  it("uses a non-owner runtime role and forces RLS on every product table", async () => {
    await expect(assertRuntimeDatabaseRole(app)).resolves.toBeUndefined();
    const unprotected = await sql<{ name: string }>`select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'memoid' and c.relkind = 'r' and (not c.relrowsecurity or not c.relforcerowsecurity)
      order by c.relname`.execute(isolated.db);
    expect(unprotected.rows).toEqual([]);
  });

  it("fails closed for unverified or ambiguous identity linking", async () => {
    await expect(
      resolveAccountIdentity(app, {
        providerKey: "workos",
        providerSubject: "user_unverified",
        email: "unverified@example.test",
        emailVerified: false,
      }),
    ).rejects.toThrow("EMAIL_NOT_VERIFIED");
    await expect(
      resolveAccountIdentity(app, {
        providerKey: "workos",
        providerSubject: "different_subject_same_email",
        email: "OWNER-A@example.test",
        emailVerified: true,
      }),
    ).rejects.toThrow("IDENTITY_LINK_AMBIGUOUS");
    await expect(
      resolveAccountIdentity(app, {
        providerKey: "workos",
        providerSubject: "user_account_a",
        email: "owner-a@example.test",
        emailVerified: true,
      }),
    ).resolves.toMatchObject({ accountId: accountA, resolution: "EXISTING" });
  });

  it("authenticates only hashed, active local sessions and supports one-time scoped step-up", async () => {
    await expect(authenticateLocalSession(app, tokenA)).resolves.toMatchObject({
      accountId: accountA,
      providerSessionId: "session_account_a",
      fresh: true,
    });
    await expect(authenticateLocalSession(app, Buffer.alloc(32, 12))).resolves.toBeNull();
    const nonce = Buffer.alloc(32, 21);
    const intent = await sql<{ id: string }>`select memoid.create_step_up_intent(
      ${tokenA}::bytea, ${nonce}::bytea, 'REVOKE_ALL_SESSIONS', ${workspaceA}::uuid,
      ${projectA}::uuid, '/account/security', ${await createDatabaseUuidV7(app)}::uuid
    )::text as id`.execute(app);
    const consume = () =>
      sql`select * from memoid.consume_step_up_intent(
        ${tokenA}::bytea, ${nonce}::bytea, ${intent.rows[0]!.id}::uuid
      )`.execute(app);
    await expect(consume()).resolves.toMatchObject({
      rows: [expect.objectContaining({ action_key: "REVOKE_ALL_SESSIONS" })],
    });
    await expect(consume()).resolves.toMatchObject({ rows: [] });

    const rotationNonce = Buffer.alloc(32, 22);
    const rotationIntent = await createStepUpIntent(app, {
      tokenHash: tokenA,
      nonceHash: rotationNonce,
      actionKey: "MANAGE_ACCOUNT_SECURITY",
      returnPath: "/account/security",
      correlationId: await createDatabaseUuidV7(app),
    });
    const rotatedToken = Buffer.alloc(32, 23);
    await expect(
      completeStepUpIntent(app, {
        oldTokenHash: tokenA,
        nonceHash: rotationNonce,
        intentId: rotationIntent,
        newTokenHash: rotatedToken,
        providerSubject: "different_subject",
        providerSessionId: "session_account_a",
        freshAuthenticatedAt: new Date(),
        providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      }),
    ).rejects.toThrow("STEP_UP_IDENTITY_MISMATCH");
    await expect(authenticateLocalSession(app, tokenA)).resolves.toMatchObject({
      accountId: accountA,
    });
    await expect(
      completeStepUpIntent(app, {
        oldTokenHash: tokenA,
        nonceHash: rotationNonce,
        intentId: rotationIntent,
        newTokenHash: rotatedToken,
        providerSubject: "user_account_a",
        providerSessionId: "session_account_a",
        freshAuthenticatedAt: new Date(Date.now() - 60 * 1_000),
        providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      }),
    ).rejects.toThrow("STEP_UP_INTENT_INVALID");
    await expect(authenticateLocalSession(app, tokenA)).resolves.toMatchObject({
      accountId: accountA,
    });
    await expect(
      completeStepUpIntent(app, {
        oldTokenHash: tokenA,
        nonceHash: rotationNonce,
        intentId: rotationIntent,
        newTokenHash: rotatedToken,
        providerSubject: "user_account_a",
        providerSessionId: "session_account_a",
        freshAuthenticatedAt: new Date(),
        providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      }),
    ).resolves.toMatchObject({ returnPath: "/account/security" });
    await expect(authenticateLocalSession(app, tokenA)).resolves.toBeNull();
    await expect(authenticateLocalSession(app, rotatedToken)).resolves.toMatchObject({
      accountId: accountA,
      fresh: true,
    });
    await expect(
      completeStepUpIntent(app, {
        oldTokenHash: tokenA,
        nonceHash: rotationNonce,
        intentId: rotationIntent,
        newTokenHash: Buffer.alloc(32, 24),
        providerSubject: "user_account_a",
        providerSessionId: "session_account_a",
        freshAuthenticatedAt: new Date(),
        providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      }),
    ).rejects.toThrow();
  });

  it("isolates Accounts, Workspaces, Projects, Actors, known UUIDs, and writes", async () => {
    await withSecurityTransaction(
      app,
      { accountId: accountA, workspaceId: workspaceA, projectId: projectA, actorId: actorA },
      async (trx) => {
        expect(
          (await sql<{ id: string }>`select id::text from memoid.accounts`.execute(trx)).rows,
        ).toEqual([{ id: accountA }]);
        expect(
          (await sql<{ id: string }>`select id::text from memoid.workspaces`.execute(trx)).rows,
        ).toEqual([{ id: workspaceA }]);
        expect(
          (
            await sql<{
              id: string;
            }>`select id::text from memoid.projects where id = ${projectB}::uuid`.execute(trx)
          ).rows,
        ).toEqual([]);
        await expect(
          sql`insert into memoid.audit_events (
            workspace_id, project_id, actor_id, actor_kind_snapshot, actor_reference_snapshot,
            actor_label_snapshot, category, event_type, occurred_at, target_type, target_key,
            correlation_id, outcome
          ) values (
            ${workspaceA}::uuid, ${projectA}::uuid, ${actorA}::uuid, 'HUMAN',
            ${`account:${accountA}`}, 'Account owner', 'SECURITY', 'AUTHORIZATION_ALLOWED',
            clock_timestamp(), 'PROJECT', ${projectA}, uuidv7(), 'SUCCESS'
          )`.execute(trx),
        ).resolves.toBeDefined();
        expect(
          (
            await sql<{ allowed: boolean }>`select memoid.has_actor_scope(
              ${workspaceA}::uuid, ${actorA}::uuid, 'HUMAN',
              ${`account:${accountB}`}, 'Spoofed owner'
            ) as allowed`.execute(trx)
          ).rows[0]?.allowed,
        ).toBe(false);
        const canonicalized = await sql<{
          actor_reference_snapshot: string;
          actor_label_snapshot: string;
        }>`insert into memoid.audit_events (
            workspace_id, project_id, actor_id, actor_kind_snapshot, actor_reference_snapshot,
            actor_label_snapshot, category, event_type, occurred_at, target_type, target_key,
            correlation_id, outcome
          ) values (
            ${workspaceA}::uuid, ${projectA}::uuid, ${actorA}::uuid, 'HUMAN',
            ${`account:${accountB}`}, 'Spoofed owner', 'SECURITY', 'AUTHORIZATION_ALLOWED',
            clock_timestamp(), 'PROJECT', ${projectA}, uuidv7(), 'SUCCESS'
          ) returning actor_reference_snapshot, actor_label_snapshot`.execute(trx);
        expect(canonicalized.rows[0]).toEqual({
          actor_reference_snapshot: `account:${accountA}`,
          actor_label_snapshot: "Account owner",
        });
        await expect(sql`delete from memoid.audit_events`.execute(trx)).rejects.toThrow();
      },
    );

    await expect(
      withSecurityTransaction(app, { accountId: accountA, workspaceId: workspaceB }, (trx) =>
        sql`select id from memoid.workspaces`.execute(trx),
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      withSecurityTransaction(app, { accountId: accountA, workspaceId: workspaceA }, (trx) =>
        sql`insert into memoid.actors
          (workspace_id, actor_kind, actor_reference, display_label)
          values (${workspaceA}::uuid, 'HUMAN', ${`account:${accountB}`}, 'Spoofed')`.execute(trx),
      ),
    ).rejects.toThrow();
  });

  it("clears transaction security context after commit, rollback, and repeated pool reuse", async () => {
    for (let index = 0; index < 8; index += 1) {
      const accountId = index % 2 === 0 ? accountA : accountB;
      const workspaceId = index % 2 === 0 ? workspaceA : workspaceB;
      await expect(
        withSecurityTransaction(app, { accountId, workspaceId }, async (trx) => {
          const rows = await sql<{
            account_id: string;
          }>`select account_id::text from memoid.workspaces`.execute(trx);
          if (index === 5) throw new Error("synthetic rollback");
          return rows.rows;
        }),
      )[index === 5 ? "rejects" : "resolves"].toBeDefined();
      expect((await sql`select id from memoid.accounts`.execute(app)).rows).toEqual([]);
      expect((await sql`select id from memoid.workspaces`.execute(app)).rows).toEqual([]);
      expect((await sql`select id from memoid.projects`.execute(app)).rows).toEqual([]);
    }

    await withSecurityTransaction(
      app,
      { accountId: accountA, workspaceId: workspaceA, projectId: projectA },
      async (trx) => {
        await sql`savepoint nested_security_scope`.execute(trx);
        await sql`select set_config('memoid.project_id', ${projectB}, true)`.execute(trx);
        expect((await sql`select id from memoid.projects`.execute(trx)).rows).toEqual([]);
        await sql`rollback to savepoint nested_security_scope`.execute(trx);
        expect(
          (await sql<{ id: string }>`select id::text from memoid.projects`.execute(trx)).rows,
        ).toEqual([{ id: projectA }]);
      },
    );
    expect((await sql`select id from memoid.projects`.execute(app)).rows).toEqual([]);

    await expect(
      withSecurityTransaction(
        app,
        { accountId: accountA, workspaceId: workspaceA },
        async (trx) => {
          await sql`set local statement_timeout = '40ms'`.execute(trx);
          await sql`select pg_sleep(1)`.execute(trx);
        },
      ),
    ).rejects.toThrow();
    expect((await sql`select id from memoid.accounts`.execute(app)).rows).toEqual([]);
  });

  it("revokes local sessions from provider session, password-reset, and user-deletion signals", async () => {
    const identity = await resolveAccountIdentity(app, {
      providerKey: "workos",
      providerSubject: "user_provider_events",
      email: "provider-events@example.test",
      emailVerified: true,
    });
    const sessionToken = Buffer.alloc(32, 31);
    await createLocalAuthSession(app, {
      accountId: identity.accountId,
      bindingId: identity.bindingId,
      tokenHash: sessionToken,
      providerSessionId: "session_provider_event",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(app),
    });
    await expect(
      revokeProviderAuthSession(
        app,
        "session_provider_event",
        "PROVIDER_SESSION_REVOKED",
        await createDatabaseUuidV7(app),
      ),
    ).resolves.toBe(1);
    await expect(authenticateLocalSession(app, sessionToken)).resolves.toBeNull();

    const resetToken = Buffer.alloc(32, 32);
    await createLocalAuthSession(app, {
      accountId: identity.accountId,
      bindingId: identity.bindingId,
      tokenHash: resetToken,
      providerSessionId: "session_password_reset",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(app),
    });
    await expect(
      revokeProviderIdentitySessions(app, {
        providerKey: "workos",
        providerSubject: "user_provider_events",
        reason: "PROVIDER_PASSWORD_RESET",
        correlationId: await createDatabaseUuidV7(app),
      }),
    ).resolves.toBe(1);
    await expect(authenticateLocalSession(app, resetToken)).resolves.toBeNull();
  });

  it("keeps the web runtime behind the auth-owned PostgreSQL session adapter", async () => {
    const store = new MemoidAuthSessionStore(isolated.connectionString, 1);
    const token = Buffer.alloc(32, 41);
    const identity = {
      providerKey: "workos",
      providerSubject: "user_auth_runtime_adapter",
      email: "auth-runtime-adapter@example.test",
      emailVerified: true,
      providerSessionId: "session_auth_runtime_adapter",
      providerSessionExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      freshAuthenticatedAt: new Date(),
      authenticationMethod: "password",
      impersonated: false,
    } as const;
    try {
      await store.create(identity, token);
      await expect(store.authenticate(token)).resolves.toMatchObject({
        providerSubject: identity.providerSubject,
        providerSessionId: identity.providerSessionId,
      });
      await store.applyProviderSecurityEvent({
        type: "SESSION_REVOKED",
        providerSessionId: identity.providerSessionId,
      });
      await expect(store.authenticate(token)).resolves.toBeNull();
    } finally {
      await store.close();
    }
  });

  it("migrates 10B to 10C, down to the exact 10B boundary, and back up", async () => {
    const roundTrip = await createIsolatedTestDatabase(adminUrl!, "10c_round_trip");
    try {
      expect(
        (await createMigrator(roundTrip.db).migrateTo("003_stage10b_actor_audit_operation")).error,
      ).toBeUndefined();
      expect(
        (await createMigrator(roundTrip.db).migrateTo("004_stage10c_identity_authz_rls")).error,
      ).toBeUndefined();
      expect((await createMigrator(roundTrip.db).migrateDown()).error).toBeUndefined();
      expect(
        (
          await sql<{
            exists: boolean;
          }>`select to_regclass('memoid.auth_sessions') is not null as exists`.execute(roundTrip.db)
        ).rows[0]?.exists,
      ).toBe(false);
      expect(
        (await createMigrator(roundTrip.db).migrateTo("004_stage10c_identity_authz_rls")).error,
      ).toBeUndefined();
    } finally {
      await roundTrip.destroy();
    }
  });
});
