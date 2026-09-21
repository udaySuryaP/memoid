import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../packages/db/src/migrations/009-stage10h-context-records-provenance.ts",
  import.meta.url,
);
const correctionMigrationPath = new URL(
  "../../packages/db/src/migrations/010-audit1a-integrity-corrections.ts",
  import.meta.url,
);
const adapterPath = new URL("../../packages/adapters/src/context-record.ts", import.meta.url);
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

  it("does not persist raw Source content and requires the canonical authority winner", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).not.toMatch(/raw_(?:content|repository|payload)|repository_blob/iu);
    expect(migration).toContain("p_evidence_reference_id is not null");
    expect(migration).toContain("p_source_authority_assignment_id is not null");
    expect(migration).toContain("a.id=s.current_assignment_id");
    expect(migration).toContain("dense_rank() over (order by ref_rank desc,scope_rank desc)");
    expect(migration).toContain("authority_winner_count <> 1");
    expect(migration).toContain("CONTEXT_AUTHORITY_NOT_WINNER");
    expect(migration).toContain("authority_winner.connection_state is distinct from 'ACTIVE'");
  });

  it("refuses populated rollback before any destructive migration action", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const refusal = migration.indexOf("STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY");
    const firstDrop = migration.indexOf(
      "drop function if exists memoid.end_context_identity",
      migration.indexOf("async down"),
    );
    expect(refusal).toBeGreaterThan(migration.indexOf("async down"));
    expect(refusal).toBeLessThan(firstDrop);
  });

  it("uses one canonical authority resolver for corrected writes and read-time currentness", async () => {
    const [migration, adapter] = await Promise.all([
      readFile(correctionMigrationPath, "utf8"),
      readFile(adapterPath, "utf8"),
    ]);
    expect(migration).toContain("create function memoid.resolve_effective_source_authority");
    expect(migration).toContain("create function memoid.put_context_record_v2");
    expect(migration).toContain("from memoid.resolve_effective_source_authority(");
    expect(adapter).toContain("left join lateral memoid.resolve_effective_source_authority(");
    expect(adapter).toContain("from memoid.put_context_record_v2(");
    expect(migration).toContain("p_source_authority_assignment_id");
    expect(migration).not.toMatch(/raw_(?:content|repository|payload)|repository_blob/iu);
  });

  it("keeps corrected definer functions on fixed paths with narrow runtime grants", async () => {
    const migration = await readFile(correctionMigrationPath, "utf8");
    expect(migration).toContain("language plpgsql stable set search_path = pg_catalog, memoid");
    for (const name of ["list_source_ingestion_runtime_targets", "put_context_record_v2"]) {
      const start = migration.indexOf(`create function memoid.${name}`);
      expect(start).toBeGreaterThan(-1);
      expect(migration.slice(start, start + 3_000)).toContain(
        "security definer set search_path = pg_catalog, memoid",
      );
    }
    expect(migration).toContain("session_user <> 'memoid_app'");
    expect(migration).toMatch(/from public,\s*memoid_app,\s*memoid_auth,\s*memoid_provider/u);
    expect(migration).toContain("grant execute on function");
  });
});
