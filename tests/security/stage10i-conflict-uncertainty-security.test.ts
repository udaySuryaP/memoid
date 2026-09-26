import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../packages/db/src/migrations/011-stage10i-conflict-uncertainty.ts",
  import.meta.url,
);
const applicationPath = new URL(
  "../../packages/application/src/conflict-uncertainty.ts",
  import.meta.url,
);

describe("Stage 10I integrity security boundary", () => {
  it("forces Project RLS and exposes only narrow definer mutations", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("force row level security");
    for (const name of ["record_conflict_state", "record_uncertainty_state"]) {
      const start = migration.indexOf(`create function memoid.${name}`);
      expect(start).toBeGreaterThan(-1);
      expect(migration.slice(start, start + 1_200)).toContain(
        "security definer set search_path=pg_catalog,memoid",
      );
    }
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+memoid\.(?:conflict|integrity|uncertainty)/iu,
    );
    expect(migration).toContain("from public,memoid_app,memoid_auth,memoid_provider");
  });

  it("requires a live human session, matching Actor, Project scope, and Context capability", async () => {
    const [migration, application] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(applicationPath, "utf8"),
    ]);
    expect(migration).toContain("security_state.disabled_at is null");
    expect(migration).toContain("s.revoked_at is null");
    expect(migration).toContain("actor_kind='HUMAN'");
    expect(migration).toContain("p_project_id=memoid.current_project_id()");
    expect(application).toContain('"PROJECT_MANAGE_CONTEXT"');
  });

  it("rejects foreign Evidence, Working Context, Context Records, and resolution revisions", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("INVALID_CONFLICT_EVIDENCE");
    expect(migration).toContain("INVALID_CONFLICT_WORKING_CONTEXT");
    expect(migration).toContain("INVALID_CONFLICT_REVIEWED_CONTEXT");
    expect(migration).toContain("INVALID_UNCERTAINTY_TARGET");
    expect(migration).toContain("INVALID_CONFLICT_RESOLUTION_REVISION");
    expect(migration).toContain("INVALID_UNCERTAINTY_RESOLUTION_REVISION");
  });

  it("reuses the canonical authority resolver and preserves multi-Source qualification", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration.match(/memoid\.resolve_effective_source_authority\(/gu)).toHaveLength(2);
    expect(migration).toContain("AUTHORITATIVE_CURRENT");
    expect(migration).toContain("SHADOWED");
    expect(migration).not.toContain("create function memoid.resolve_effective_source_authority");
  });

  it("makes integrity history immutable and refuses populated rollback before drops", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("Integrity history is immutable");
    const refusal = migration.indexOf("STAGE10I_ROLLBACK_REFUSED_POPULATED_INTEGRITY_HISTORY");
    const firstDrop = migration.indexOf("drop function if exists", migration.indexOf("async down"));
    expect(refusal).toBeGreaterThan(migration.indexOf("async down"));
    expect(refusal).toBeLessThan(firstDrop);
  });

  it("does not persist claim text, model confidence, proposals, or reconciliation output", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).not.toMatch(
      /claim_(?:text|payload)|confidence_score|model_output|proposal/iu,
    );
    expect(migration).toContain("claim_fingerprint");
  });
});
