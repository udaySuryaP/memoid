import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../packages/db/src/migrations/009-stage10h-context-records-provenance.ts",
  import.meta.url,
);
const applicationPath = new URL(
  "../../packages/application/src/context-record.ts",
  import.meta.url,
);

describe("Stage 10H Context security boundary", () => {
  it("uses forced Project RLS, fixed definer paths, and no direct runtime writes", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("force row level security");
    for (const name of ["put_context_record", "end_context_identity"]) {
      const start = migration.indexOf(`create function memoid.${name}`);
      expect(start).toBeGreaterThan(-1);
      expect(migration.slice(start, start + 1000)).toContain(
        "security definer set search_path = pg_catalog, memoid",
      );
    }
    expect(migration).toContain("from public, memoid_app, memoid_auth, memoid_provider");
    expect(migration).not.toMatch(/grant\s+(?:insert|update|delete|all)\s+on\s+memoid\.context_/iu);
  });

  it("requires the context capability and a live human session/Actor", async () => {
    const [application, migration] = await Promise.all([
      readFile(applicationPath, "utf8"),
      readFile(migrationPath, "utf8"),
    ]);
    expect(application).toContain('"PROJECT_MANAGE_CONTEXT"');
    expect(migration).toContain("security_state.disabled_at is null");
    expect(migration).toContain("s.revoked_at is null");
    expect(migration).toContain("actor_kind = 'HUMAN'");
    expect(migration).toContain("actor_reference = 'account:' || session_row.account_id::text");
  });

  it("does not persist raw Source content and requires exact evidence plus authority", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).not.toMatch(/raw_(?:content|repository|payload)|repository_blob/iu);
    expect(migration).toContain("p_evidence_reference_id is not null");
    expect(migration).toContain("p_source_authority_assignment_id is not null");
    expect(migration).toContain("s.current_assignment_id=a.id");
    expect(migration).toContain("g.connection_state='ACTIVE'");
  });
});
