import { createDatabase, type MemoidDatabase } from "@memoid/db";
import { sql, type Kysely } from "kysely";

export interface IsolatedTestDatabase {
  readonly db: Kysely<MemoidDatabase>;
  readonly connectionString: string;
  destroy: () => Promise<void>;
}

export async function createIsolatedTestDatabase(
  adminConnectionString: string,
  label: string,
): Promise<IsolatedTestDatabase> {
  const databaseName = `memoid_${label}_${process.pid}_${Date.now()}`.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(databaseName)) throw new Error("Unsafe isolated database name");

  const controlUrl = new URL(adminConnectionString);
  controlUrl.pathname = "/postgres";
  const testUrl = new URL(adminConnectionString);
  testUrl.pathname = `/${databaseName}`;
  const control = createDatabase(controlUrl.toString(), 2);
  await sql.raw(`create database "${databaseName}" template template0`).execute(control);
  const db = createDatabase(testUrl.toString(), 8);

  return {
    db,
    connectionString: testUrl.toString(),
    destroy: async () => {
      await db.destroy();
      await sql<{ terminated: boolean }>`select pg_terminate_backend(pid) as terminated
        from pg_stat_activity where datname = ${databaseName} and pid <> pg_backend_pid()`.execute(
        control,
      );
      await sql.raw(`drop database if exists "${databaseName}"`).execute(control);
      await control.destroy();
    },
  };
}
