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

function authConnection(connectionString: string, max = 1): Kysely<MemoidDatabase> {
  const url = new URL(connectionString);
  url.username = "memoid_auth";
  url.password = "synthetic-auth-password";
  return createDatabase(url.toString(), max);
}

suite("Stage 10C identity, sessions, and forced RLS", () => {
  let isolated: IsolatedTestDatabase;
  let app: Kysely<MemoidDatabase>;
  let auth: Kysely<MemoidDatabase>;
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
    auth = authConnection(isolated.connectionString);
    const identityA = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: "user_account_a",
      email: "owner-a@example.test",
      emailVerified: true,
    });
    const identityB = await resolveAccountIdentity(auth, {
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

    await createLocalAuthSession(auth, {
      accountId: accountA,
      bindingId: identityA.bindingId,
      tokenHash: tokenA,
      providerSessionId: "session_account_a",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(auth),
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
    await auth.destroy();
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

  it("separates ordinary product access from the bounded authentication authority", async () => {
    const roles = await sql<{
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
    }>`select rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
      from pg_roles where rolname in ('memoid_app', 'memoid_auth') order by rolname`.execute(
      isolated.db,
    );
    expect(roles.rows).toEqual([
      {
        rolname: "memoid_app",
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolbypassrls: false,
      },
      {
        rolname: "memoid_auth",
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolbypassrls: false,
      },
    ]);

    const elevated = [
      "authenticate_auth_session",
      "complete_step_up_intent",
      "create_auth_session",
      "create_step_up_intent",
      "mark_auth_session_provider_state",
      "resolve_account_identity",
      "revoke_auth_session",
      "revoke_provider_auth_session",
      "revoke_provider_identity_sessions",
    ];
    const privileges = await sql<{
      name: string;
      app_execute: boolean;
      auth_execute: boolean;
    }>`select p.proname as name,
        has_function_privilege('memoid_app', p.oid, 'EXECUTE') as app_execute,
        has_function_privilege('memoid_auth', p.oid, 'EXECUTE') as auth_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'memoid' and p.proname = any(${elevated}::text[])
      order by p.proname`.execute(isolated.db);
    expect(privileges.rows).toEqual(
      elevated.map((name) => ({ name, app_execute: false, auth_execute: true })),
    );
    const authExecutable = await sql<{ name: string }>`select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'memoid' and has_function_privilege('memoid_auth', p.oid, 'EXECUTE')
      order by p.proname`.execute(isolated.db);
    expect(authExecutable.rows.map(({ name }) => name)).toEqual(elevated);

    const authTableAuthority = await sql<{
      owned_tables: number;
      table_privileges: number;
    }>`select
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'memoid' and c.relkind = 'r'
          and pg_get_userbyid(c.relowner) = 'memoid_auth') as owned_tables,
      (select count(*)::int from information_schema.table_privileges
        where grantee = 'memoid_auth' and table_schema = 'memoid') as table_privileges`.execute(
      isolated.db,
    );
    expect(authTableAuthority.rows[0]).toEqual({ owned_tables: 0, table_privileges: 0 });
    const authMemberships = await sql`select 1 from pg_auth_members m
      join pg_roles member on member.oid = m.member
      where member.rolname = 'memoid_auth'`.execute(isolated.db);
    expect(authMemberships.rows).toEqual([]);
    await expect(sql`select id from memoid.projects`.execute(auth)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("denies direct elevated-auth abuse from memoid_app and exposes no weak step-up primitive", async () => {
    await expect(
      sql`select * from memoid.resolve_account_identity(
        'workos', 'attacker', 'attacker@example.test', true
      )`.execute(app),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      sql`select memoid.create_auth_session(
        ${accountB}::uuid, ${accountB}::uuid, ${Buffer.alloc(32, 70)}::bytea,
        'attacker-session', clock_timestamp(), clock_timestamp() + interval '1 hour', uuidv7()
      )`.execute(app),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      sql`select memoid.revoke_provider_identity_sessions(
        'workos', 'user_account_b', 'ATTACK', uuidv7()
      )`.execute(app),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      sql`select * from memoid.complete_step_up_intent(
        ${Buffer.alloc(32, 71)}::bytea, ${Buffer.alloc(32, 72)}::bytea, ${accountA}::uuid,
        ${Buffer.alloc(32, 73)}::bytea, 'user_account_a', 'attacker-session',
        clock_timestamp(), clock_timestamp() + interval '1 hour'
      )`.execute(app),
    ).rejects.toThrow(/permission denied/i);
    const weakPrimitive = await sql<{ function_name: string | null }>`select
      to_regprocedure('memoid.consume_step_up_intent(bytea,bytea,uuid)')::text as function_name`.execute(
      isolated.db,
    );
    expect(weakPrimitive.rows[0]?.function_name).toBeNull();
  });

  it("pins every Stage 10C security-definer function to memoid_owner and a fixed search path", async () => {
    const functions = await sql<{
      name: string;
      owner: string;
      configuration: string[] | null;
    }>`select p.proname as name, pg_get_userbyid(p.proowner) as owner, p.proconfig as configuration
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'memoid' and p.prosecdef and p.proname in (
        'initialize_account_security_state', 'resolve_account_identity', 'create_auth_session',
        'authenticate_auth_session', 'mark_auth_session_provider_state', 'revoke_auth_session',
        'revoke_provider_auth_session', 'revoke_provider_identity_sessions',
        'revoke_all_account_auth_sessions', 'create_step_up_intent', 'complete_step_up_intent',
        'has_workspace_scope', 'has_project_scope'
      ) order by p.proname`.execute(isolated.db);
    expect(functions.rows).toHaveLength(13);
    for (const fn of functions.rows) {
      expect(fn.owner).toBe("memoid_owner");
      expect(fn.configuration).toContain("search_path=pg_catalog, memoid");
    }
  });

  it("fails closed for unverified or ambiguous identity linking", async () => {
    await expect(
      resolveAccountIdentity(auth, {
        providerKey: "workos",
        providerSubject: "user_unverified",
        email: "unverified@example.test",
        emailVerified: false,
      }),
    ).rejects.toThrow("EMAIL_NOT_VERIFIED");
    await expect(
      resolveAccountIdentity(auth, {
        providerKey: "workos",
        providerSubject: "different_subject_same_email",
        email: "OWNER-A@example.test",
        emailVerified: true,
      }),
    ).rejects.toThrow("IDENTITY_LINK_AMBIGUOUS");
    await expect(
      resolveAccountIdentity(auth, {
        providerKey: "workos",
        providerSubject: "user_account_a",
        email: "owner-a@example.test",
        emailVerified: true,
      }),
    ).resolves.toMatchObject({ accountId: accountA, resolution: "EXISTING" });
  });

  it("authenticates only hashed, active local sessions and supports one-time scoped step-up", async () => {
    await expect(authenticateLocalSession(auth, tokenA)).resolves.toMatchObject({
      accountId: accountA,
      providerSessionId: "session_account_a",
      fresh: true,
    });
    await expect(authenticateLocalSession(auth, Buffer.alloc(32, 12))).resolves.toBeNull();

    const rotationNonce = Buffer.alloc(32, 22);
    const rotationIntent = await createStepUpIntent(auth, {
      tokenHash: tokenA,
      nonceHash: rotationNonce,
      actionKey: "MANAGE_ACCOUNT_SECURITY",
      returnPath: "/account/security",
      correlationId: await createDatabaseUuidV7(auth),
    });
    const rotatedToken = Buffer.alloc(32, 23);
    await expect(
      completeStepUpIntent(auth, {
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
    await expect(authenticateLocalSession(auth, tokenA)).resolves.toMatchObject({
      accountId: accountA,
    });
    await expect(
      completeStepUpIntent(auth, {
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
    await expect(authenticateLocalSession(auth, tokenA)).resolves.toMatchObject({
      accountId: accountA,
    });
    await expect(
      completeStepUpIntent(auth, {
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
    await expect(authenticateLocalSession(auth, tokenA)).resolves.toBeNull();
    await expect(authenticateLocalSession(auth, rotatedToken)).resolves.toMatchObject({
      accountId: accountA,
      fresh: true,
    });
    await expect(
      completeStepUpIntent(auth, {
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
    const identity = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: "user_provider_events",
      email: "provider-events@example.test",
      emailVerified: true,
    });
    const sessionToken = Buffer.alloc(32, 31);
    await createLocalAuthSession(auth, {
      accountId: identity.accountId,
      bindingId: identity.bindingId,
      tokenHash: sessionToken,
      providerSessionId: "session_provider_event",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    await expect(
      revokeProviderAuthSession(
        auth,
        "session_provider_event",
        "PROVIDER_SESSION_REVOKED",
        await createDatabaseUuidV7(auth),
      ),
    ).resolves.toBe(1);
    await expect(authenticateLocalSession(auth, sessionToken)).resolves.toBeNull();

    const resetToken = Buffer.alloc(32, 32);
    await createLocalAuthSession(auth, {
      accountId: identity.accountId,
      bindingId: identity.bindingId,
      tokenHash: resetToken,
      providerSessionId: "session_password_reset",
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    await expect(
      revokeProviderIdentitySessions(auth, {
        providerKey: "workos",
        providerSubject: "user_provider_events",
        reason: "PROVIDER_PASSWORD_RESET",
        correlationId: await createDatabaseUuidV7(auth),
      }),
    ).resolves.toBe(1);
    await expect(authenticateLocalSession(auth, resetToken)).resolves.toBeNull();
  });

  it("keeps the web runtime behind the auth-owned PostgreSQL session adapter", async () => {
    const store = new MemoidAuthSessionStore(
      (() => {
        const url = new URL(isolated.connectionString);
        url.username = "memoid_auth";
        url.password = "synthetic-auth-password";
        return url.toString();
      })(),
      1,
    );
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
