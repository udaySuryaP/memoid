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
