import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import { Pool } from "pg";

export interface TenantProbeTable {
  id: string;
  tenant_id: string;
  payload: string;
}
export interface FoundationDatabase {
  "foundation.tenant_probe": TenantProbeTable;
}

export function createDatabase(connectionString: string, max = 10): Kysely<FoundationDatabase> {
  return new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) }),
  });
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

const foundationMigration: Migration = {
  async up(db) {
    await sql`create schema if not exists foundation authorization memoid_owner`.execute(db);
    await sql`create table if not exists foundation.tenant_probe (id uuid primary key, tenant_id text not null, payload text not null)`.execute(
      db,
    );
    await sql`alter table foundation.tenant_probe owner to memoid_owner`.execute(db);
    await sql`alter table foundation.tenant_probe enable row level security`.execute(db);
    await sql`alter table foundation.tenant_probe force row level security`.execute(db);
    await sql`drop policy if exists tenant_isolation on foundation.tenant_probe`.execute(db);
    await sql`create policy tenant_isolation on foundation.tenant_probe using (tenant_id = current_setting('memoid.tenant_id', true)) with check (tenant_id = current_setting('memoid.tenant_id', true))`.execute(
      db,
    );
    await sql`grant usage on schema foundation to memoid_app`.execute(db);
    await sql`grant select, insert, update, delete on foundation.tenant_probe to memoid_app`.execute(
      db,
    );
  },
  async down(db) {
    await sql`drop schema if exists foundation cascade`.execute(db);
  },
};

class FoundationMigrationProvider implements MigrationProvider {
  public async getMigrations(): Promise<Record<string, Migration>> {
    return { "001_foundation_rls": foundationMigration };
  }
}

export const createMigrator = (db: Kysely<FoundationDatabase>): Migrator =>
  new Migrator({ db, provider: new FoundationMigrationProvider(), migrationTableSchema: "public" });
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
