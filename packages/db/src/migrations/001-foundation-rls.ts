import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const foundationMigration: Migration = {
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
