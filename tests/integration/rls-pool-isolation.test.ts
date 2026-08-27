import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  migrateToLatest,
  seedSyntheticProbe,
  withTenantTransaction,
  type FoundationDatabase,
} from "@memoid/db";
import type { Kysely } from "kysely";

const appUrl = process.env.INTEGRATION_DATABASE_URL;
const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;
suite("transaction-scoped RLS pool isolation", () => {
  let app: Kysely<FoundationDatabase>;
  let admin: Kysely<FoundationDatabase>;
  beforeAll(async () => {
    admin = createDatabase(adminUrl!, 2);
    app = createDatabase(appUrl!, 1);
    await migrateToLatest(admin);
    await seedSyntheticProbe(admin);
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
  });
  it("uses a non-owner, non-BYPASSRLS application role", async () => {
    const role = await sql<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>`select rolname, rolsuper, rolbypassrls from pg_roles where rolname=current_user`.execute(
      app,
    );
    expect(role.rows[0]).toMatchObject({
      rolname: "memoid_app",
      rolsuper: false,
      rolbypassrls: false,
    });
    const owner = await sql<{
      owner: string;
    }>`select tableowner as owner from pg_tables where schemaname='foundation' and tablename='tenant_probe'`.execute(
      app,
    );
    expect(owner.rows[0]?.owner).not.toBe("memoid_app");
  });
  it("does not leak context after commit or rollback on a reused connection", async () => {
    await expect(
      withTenantTransaction(app, "tenant-a", async (trx) =>
        (
          await sql<{ tenant_id: string }>`select tenant_id from foundation.tenant_probe`.execute(
            trx,
          )
        ).rows.map((r) => r.tenant_id),
      ),
    ).resolves.toEqual(["tenant-a"]);
    await expect(sql`select * from foundation.tenant_probe`.execute(app)).resolves.toMatchObject({
      rows: [],
    });
    await expect(
      withTenantTransaction(app, "tenant-b", async (trx) => {
        await sql`select tenant_id from foundation.tenant_probe`.execute(trx);
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    await expect(sql`select * from foundation.tenant_probe`.execute(app)).resolves.toMatchObject({
      rows: [],
    });
  });
  it("rejects cross-tenant writes", async () => {
    await expect(
      withTenantTransaction(app, "tenant-a", (trx) =>
        sql`insert into foundation.tenant_probe values ('00000000-0000-4000-8000-000000000003','tenant-b','unauthorized')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow();
  });
});
