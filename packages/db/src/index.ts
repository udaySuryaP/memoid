import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";
import { MemoidMigrationProvider } from "./migrations/index.js";
import type { FoundationDatabase, MemoidDatabase } from "./types.js";

export type * from "./types.js";

export function createDatabase(connectionString: string, max = 10): Kysely<MemoidDatabase> {
  return new Kysely<MemoidDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) }),
  });
}

export interface PostgresReadinessProbe {
  check: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function createPostgresReadinessProbe(
  connectionString: string,
  timeoutMs: number,
): PostgresReadinessProbe {
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: "memoid-api-readiness",
  });

  // node-postgres emits idle-client/backend failures on the Pool. Handling that
  // event here keeps a dependency outage from becoming an unhandled process
  // error; the next bounded check remains the readiness source of truth.
  pool.on("error", () => undefined);

  return {
    check: async () => {
      try {
        const result = await pool.query<{ ready: number }>("select 1 as ready");
        return result.rows[0]?.ready === 1;
      } catch {
        return false;
      }
    },
    close: async () => pool.end(),
  };
}

export async function withTenantTransaction<T>(
  db: Kysely<FoundationDatabase>,
  tenantId: string,
  operation: (trx: Transaction<FoundationDatabase>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('memoid.tenant_id', ${tenantId}, true)`.execute(trx);
    return operation(trx);
  });
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DatabaseSecurityContext {
  readonly accountId: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly actorId?: string;
}

function validateSecurityContext(context: DatabaseSecurityContext): void {
  for (const [name, value] of Object.entries(context)) {
    if (value !== undefined && !UUID_V7.test(value.toLowerCase()))
      throw new Error(`${name} must be a canonical UUIDv7`);
  }
  if (context.projectId && !context.workspaceId)
    throw new Error("Project security context requires a Workspace");
  if (context.actorId && !context.workspaceId)
    throw new Error("Actor security context requires a Workspace");
}

export async function withSecurityTransaction<T>(
  db: Kysely<MemoidDatabase>,
  context: DatabaseSecurityContext,
  operation: (trx: Transaction<MemoidDatabase>) => Promise<T>,
): Promise<T> {
  validateSecurityContext(context);
  return db.transaction().execute(async (trx) => {
    await sql`select
      set_config('memoid.account_id', ${context.accountId.toLowerCase()}, true),
      set_config('memoid.workspace_id', ${context.workspaceId?.toLowerCase() ?? ""}, true),
      set_config('memoid.project_id', ${context.projectId?.toLowerCase() ?? ""}, true),
      set_config('memoid.actor_id', ${context.actorId?.toLowerCase() ?? ""}, true)`.execute(trx);
    return operation(trx);
  });
}

export async function assertRuntimeDatabaseRole(db: Kysely<MemoidDatabase>): Promise<void> {
  const result = await sql<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`.execute(db);
  const role = result.rows[0];
  if (!role || role.rolname !== "memoid_app" || role.rolsuper || role.rolbypassrls)
    throw new Error("Product runtime must use the non-owner memoid_app role without RLS bypass");
}

export interface ResolvedAccountIdentity {
  readonly accountId: string;
  readonly bindingId: string;
  readonly resolution: "CREATED" | "EXISTING" | "UPDATED_EMAIL";
}

export async function resolveAccountIdentity(
  db: Kysely<MemoidDatabase>,
  evidence: { providerKey: string; providerSubject: string; email: string; emailVerified: boolean },
): Promise<ResolvedAccountIdentity> {
  const result = await sql<{
    resolved_account_id: string;
    resolved_binding_id: string;
    resolution: ResolvedAccountIdentity["resolution"];
  }>`select * from memoid.resolve_account_identity(
    ${evidence.providerKey}, ${evidence.providerSubject}, ${evidence.email}, ${evidence.emailVerified}
  )`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error("Identity resolution returned no binding");
  return {
    accountId: row.resolved_account_id,
    bindingId: row.resolved_binding_id,
    resolution: row.resolution,
  };
}

export async function createLocalAuthSession(
  db: Kysely<MemoidDatabase>,
  input: {
    accountId: string;
    bindingId: string;
    tokenHash: Uint8Array;
    providerSessionId: string;
    freshAuthenticatedAt: Date;
    providerExpiresAt: Date;
    correlationId: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`select memoid.create_auth_session(
    ${input.accountId}::uuid, ${input.bindingId}::uuid, ${Buffer.from(input.tokenHash)}::bytea,
    ${input.providerSessionId}, ${input.freshAuthenticatedAt}, ${input.providerExpiresAt},
    ${input.correlationId}::uuid
  ) as id`.execute(db);
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Local session was not created");
  return id;
}

export interface AuthenticatedLocalSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly bindingId: string;
  readonly providerSubject: string;
  readonly providerSessionId: string;
  readonly providerExpiresAt: Date;
  readonly freshAuthenticatedAt: Date;
  readonly providerRecheckRequired: boolean;
  readonly fresh: boolean;
}

export async function authenticateLocalSession(
  db: Kysely<MemoidDatabase>,
  tokenHash: Uint8Array,
): Promise<AuthenticatedLocalSession | null> {
  const result = await sql<{
    auth_session_id: string;
    resolved_account_id: string;
    resolved_binding_id: string;
    provider_subject: string;
    provider_session_id: string;
    provider_expires_at: Date;
    fresh_authenticated_at: Date;
    provider_recheck_required: boolean;
    fresh: boolean;
  }>`select * from memoid.authenticate_auth_session(${Buffer.from(tokenHash)}::bytea)`.execute(db);
  const row = result.rows[0];
  return row
    ? {
        sessionId: row.auth_session_id,
        accountId: row.resolved_account_id,
        bindingId: row.resolved_binding_id,
        providerSubject: row.provider_subject,
        providerSessionId: row.provider_session_id,
        providerExpiresAt: row.provider_expires_at,
        freshAuthenticatedAt: row.fresh_authenticated_at,
        providerRecheckRequired: row.provider_recheck_required,
        fresh: row.fresh,
      }
    : null;
}

export async function markLocalSessionProviderState(
  db: Kysely<MemoidDatabase>,
  tokenHash: Uint8Array,
  active: boolean,
  providerExpiresAt: Date,
): Promise<boolean> {
  const result = await sql<{ marked: boolean }>`select memoid.mark_auth_session_provider_state(
    ${Buffer.from(tokenHash)}::bytea, ${active}, ${providerExpiresAt}
  ) as marked`.execute(db);
  return result.rows[0]?.marked ?? false;
}

export async function revokeLocalAuthSession(
  db: Kysely<MemoidDatabase>,
  tokenHash: Uint8Array,
  reason: string,
  correlationId: string,
): Promise<string | null> {
  const result = await sql<{ providerSessionId: string | null }>`select memoid.revoke_auth_session(
    ${Buffer.from(tokenHash)}::bytea, ${reason}, ${correlationId}::uuid
  ) as "providerSessionId"`.execute(db);
  return result.rows[0]?.providerSessionId ?? null;
}

export async function revokeProviderAuthSession(
  db: Kysely<MemoidDatabase>,
  providerSessionId: string,
  reason: string,
  correlationId: string,
): Promise<number> {
  const result = await sql<{ changed: number }>`select memoid.revoke_provider_auth_session(
    ${providerSessionId}, ${reason}, ${correlationId}::uuid
  ) as changed`.execute(db);
  return result.rows[0]?.changed ?? 0;
}

export async function revokeProviderIdentitySessions(
  db: Kysely<MemoidDatabase>,
  input: {
    providerKey: string;
    providerSubject: string;
    reason: string;
    correlationId: string;
  },
): Promise<number> {
  const result = await sql<{ changed: number }>`select memoid.revoke_provider_identity_sessions(
    ${input.providerKey}, ${input.providerSubject}, ${input.reason}, ${input.correlationId}::uuid
  ) as changed`.execute(db);
  return result.rows[0]?.changed ?? 0;
}

export async function createStepUpIntent(
  db: Kysely<MemoidDatabase>,
  input: {
    tokenHash: Uint8Array;
    nonceHash: Uint8Array;
    actionKey: string;
    workspaceId?: string;
    projectId?: string;
    returnPath: string;
    correlationId: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`select memoid.create_step_up_intent(
    ${Buffer.from(input.tokenHash)}::bytea, ${Buffer.from(input.nonceHash)}::bytea,
    ${input.actionKey}, ${input.workspaceId ?? null}::uuid, ${input.projectId ?? null}::uuid,
    ${input.returnPath}, ${input.correlationId}::uuid
  )::text as id`.execute(db);
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Step-up intent was not created");
  return id;
}

export async function completeStepUpIntent(
  db: Kysely<MemoidDatabase>,
  input: {
    oldTokenHash: Uint8Array;
    nonceHash: Uint8Array;
    intentId: string;
    newTokenHash: Uint8Array;
    providerSubject: string;
    providerSessionId: string;
    freshAuthenticatedAt: Date;
    providerExpiresAt: Date;
  },
): Promise<{ sessionId: string; returnPath: string }> {
  const result = await sql<{ new_session_id: string; return_path: string }>`select * from
    memoid.complete_step_up_intent(
      ${Buffer.from(input.oldTokenHash)}::bytea, ${Buffer.from(input.nonceHash)}::bytea,
      ${input.intentId}::uuid, ${Buffer.from(input.newTokenHash)}::bytea,
      ${input.providerSubject}, ${input.providerSessionId}, ${input.freshAuthenticatedAt},
      ${input.providerExpiresAt}
    )`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error("Step-up intent was not completed");
  return { sessionId: row.new_session_id, returnPath: row.return_path };
}

export async function createDatabaseUuidV7(db: Kysely<MemoidDatabase>): Promise<string> {
  const result = await sql<{ id: string }>`select uuidv7()::text as id`.execute(db);
  const id = result.rows[0]?.id;
  if (!id) throw new Error("PostgreSQL did not generate a UUIDv7");
  return id;
}

export const createMigrator = (db: Kysely<FoundationDatabase>): Migrator =>
  new Migrator({ db, provider: new MemoidMigrationProvider(), migrationTableSchema: "public" });
export async function migrateToLatest(db: Kysely<FoundationDatabase>): Promise<void> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  for (const result of results ?? [])
    if (result.status === "Error") throw new Error(`Migration ${result.migrationName} failed`);
  if (error) throw error;
}
export async function seedSyntheticProbe(db: Kysely<FoundationDatabase>): Promise<void> {
  await sql`insert into foundation.tenant_probe (id, tenant_id, payload) values ('00000000-0000-4000-8000-000000000001','tenant-a','synthetic-a'), ('00000000-0000-4000-8000-000000000002','tenant-b','synthetic-b') on conflict (id) do nothing`.execute(
    db,
  );
}
