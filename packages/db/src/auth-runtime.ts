import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { MemoidDatabase } from "./types.js";

export interface PostgresAuthenticatedSession {
  readonly accountId: string;
  readonly providerSubject: string;
  readonly providerSessionId: string;
  readonly providerExpiresAt: Date;
  readonly providerRecheckRequired: boolean;
  readonly fresh: boolean;
}

export interface PostgresAuthenticatedIdentity {
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly providerSessionId: string;
  readonly providerSessionExpiresAt: Date;
  readonly freshAuthenticatedAt: Date;
}

/** Bundler-safe PostgreSQL adapter for the Memoid-owned authentication session boundary. */
export class PostgresAuthSessionStore {
  private readonly database: Kysely<MemoidDatabase>;

  public constructor(connectionString: string, poolSize = 2) {
    this.database = new Kysely<MemoidDatabase>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: poolSize }) }),
    });
  }

  public async authenticate(tokenHash: Uint8Array): Promise<PostgresAuthenticatedSession | null> {
    const result = await sql<{
      resolved_account_id: string;
      provider_subject: string;
      provider_session_id: string;
      provider_expires_at: Date;
      provider_recheck_required: boolean;
      fresh: boolean;
    }>`select * from memoid.authenticate_auth_session(${Buffer.from(tokenHash)}::bytea)`.execute(
      this.database,
    );
    const row = result.rows[0];
    return row
      ? {
          accountId: row.resolved_account_id,
          providerSubject: row.provider_subject,
          providerSessionId: row.provider_session_id,
          providerExpiresAt: row.provider_expires_at,
          providerRecheckRequired: row.provider_recheck_required,
          fresh: row.fresh,
        }
      : null;
  }

  public async markProviderState(
    tokenHash: Uint8Array,
    active: boolean,
    providerExpiresAt: Date,
  ): Promise<boolean> {
    const result = await sql<{ marked: boolean }>`select memoid.mark_auth_session_provider_state(
      ${Buffer.from(tokenHash)}::bytea, ${active}, ${providerExpiresAt}
    ) as marked`.execute(this.database);
    return result.rows[0]?.marked ?? false;
  }

  public async create(
    identity: PostgresAuthenticatedIdentity,
    tokenHash: Uint8Array,
  ): Promise<void> {
    const binding = await sql<{
      resolved_account_id: string;
      resolved_binding_id: string;
    }>`select * from memoid.resolve_account_identity(
      ${identity.providerKey}, ${identity.providerSubject}, ${identity.email}, ${identity.emailVerified}
    )`.execute(this.database);
    const resolved = binding.rows[0];
    if (!resolved) throw new Error("Identity resolution returned no binding");
    const correlation = await this.createCorrelationId();
    await sql`select memoid.create_auth_session(
      ${resolved.resolved_account_id}::uuid, ${resolved.resolved_binding_id}::uuid,
      ${Buffer.from(tokenHash)}::bytea, ${identity.providerSessionId},
      ${identity.freshAuthenticatedAt}, ${identity.providerSessionExpiresAt}, ${correlation}::uuid
    )`.execute(this.database);
  }

  public async completeStepUp(
    identity: PostgresAuthenticatedIdentity,
    input: {
      oldTokenHash: Uint8Array;
      nonceHash: Uint8Array;
      intentId: string;
      newTokenHash: Uint8Array;
    },
  ): Promise<{ sessionId: string; returnPath: string }> {
    const result = await sql<{ new_session_id: string; return_path: string }>`select * from
      memoid.complete_step_up_intent(
        ${Buffer.from(input.oldTokenHash)}::bytea, ${Buffer.from(input.nonceHash)}::bytea,
        ${input.intentId}::uuid, ${Buffer.from(input.newTokenHash)}::bytea,
        ${identity.providerSubject}, ${identity.providerSessionId},
        ${identity.freshAuthenticatedAt}, ${identity.providerSessionExpiresAt}
      )`.execute(this.database);
    const row = result.rows[0];
    if (!row) throw new Error("Step-up intent was not completed");
    return { sessionId: row.new_session_id, returnPath: row.return_path };
  }

  public async createStepUp(input: {
    tokenHash: Uint8Array;
    nonceHash: Uint8Array;
    actionKey: string;
    workspaceId?: string;
    projectId?: string;
    returnPath: string;
  }): Promise<string> {
    const correlation = await this.createCorrelationId();
    const result = await sql<{ id: string }>`select memoid.create_step_up_intent(
      ${Buffer.from(input.tokenHash)}::bytea, ${Buffer.from(input.nonceHash)}::bytea,
      ${input.actionKey}, ${input.workspaceId ?? null}::uuid, ${input.projectId ?? null}::uuid,
      ${input.returnPath}, ${correlation}::uuid
    )::text as id`.execute(this.database);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Step-up intent was not created");
    return id;
  }

  public async revoke(tokenHash: Uint8Array, reason: string): Promise<string | null> {
    const correlation = await this.createCorrelationId();
    const result = await sql<{
      provider_session_id: string | null;
    }>`select memoid.revoke_auth_session(
      ${Buffer.from(tokenHash)}::bytea, ${reason}, ${correlation}::uuid
    ) as provider_session_id`.execute(this.database);
    return result.rows[0]?.provider_session_id ?? null;
  }

  public async revokeProviderSession(providerSessionId: string, reason: string): Promise<void> {
    await sql`select memoid.revoke_provider_auth_session(
      ${providerSessionId}, ${reason}, ${await this.createCorrelationId()}::uuid
    )`.execute(this.database);
  }

  public async revokeProviderIdentity(
    providerKey: string,
    providerSubject: string,
    reason: string,
  ): Promise<void> {
    await sql`select memoid.revoke_provider_identity_sessions(
      ${providerKey}, ${providerSubject}, ${reason}, ${await this.createCorrelationId()}::uuid
    )`.execute(this.database);
  }

  public close(): Promise<void> {
    return this.database.destroy();
  }

  private async createCorrelationId(): Promise<string> {
    const result = await sql<{ id: string }>`select uuidv7()::text as id`.execute(this.database);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("PostgreSQL did not generate a UUIDv7");
    return id;
  }
}
