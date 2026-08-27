import { sql } from "kysely";
import { createDatabase, createMigrator, migrateToLatest, seedSyntheticProbe } from "./index.js";

const command = process.argv[2];
const url = process.env.DATABASE_ADMIN_URL ?? process.env.INTEGRATION_DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL or INTEGRATION_DATABASE_ADMIN_URL is required");
const db = createDatabase(url, 2);
try {
  if (command === "migrate") await migrateToLatest(db);
  else if (command === "status") console.log(await createMigrator(db).getMigrations());
  else if (command === "seed") await seedSyntheticProbe(db);
  else if (command === "reset") {
    await sql`drop schema if exists foundation cascade`.execute(db);
    await migrateToLatest(db);
    await seedSyntheticProbe(db);
  } else throw new Error("Expected one of: migrate, status, seed, reset");
} finally {
  await db.destroy();
}
