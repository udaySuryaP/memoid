import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../packages/db/src/migrations/008-stage10g-source-authority.ts",
  import.meta.url,
);
const applicationPath = new URL(
  "../../packages/application/src/source-authority.ts",
  import.meta.url,
);
const actionsPath = new URL(
  "../../apps/web/app/projects/[projectId]/sources/authority/actions.ts",
  import.meta.url,
);
const stepUpPath = new URL(
  "../../apps/web/app/projects/[projectId]/sources/authority/step-up/route.ts",
  import.meta.url,
);

describe("Stage 10G Source Authority security boundary", () => {
  it("uses forced Project RLS, fixed definer paths, and no direct runtime writes", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("force row level security");
    for (const name of [
      "has_source_authority_step_up",
      "set_source_authority",
      "revoke_source_authority",
    ]) {
      const start = migration.indexOf(`create function memoid.${name}`);
      expect(start).toBeGreaterThan(-1);
      expect(migration.slice(start, start + 900)).toContain(
        "security definer set search_path = pg_catalog, memoid",
      );
    }
    expect(migration).toContain("from public, memoid_app, memoid_auth, memoid_provider");
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+memoid\.source_authority/iu,
    );
  });

  it("requires a human capability, fresh authentication, and a Project-scoped step-up", async () => {
    const [application, migration] = await Promise.all([
      readFile(applicationPath, "utf8"),
      readFile(migrationPath, "utf8"),
    ]);
    expect(application).toContain('"PROJECT_MANAGE_SOURCE_AUTHORITY"');
    expect(application).toContain("freshAuthenticationRequired: mutate");
    expect(application).toContain("hasScopedStepUp");
    expect(migration).toContain("MANAGE_SOURCE_AUTHORITY");
    expect(migration).toContain("actor_kind = 'HUMAN'");
    expect(migration).toContain("intent.workspace_id = project.workspace_id");
    expect(migration).toContain("intent.project_id = project.id");
  });

  it("keeps browser mutations same-origin and provider-backed step-up protected", async () => {
    const [actions, stepUp] = await Promise.all([
      readFile(actionsPath, "utf8"),
      readFile(stepUpPath, "utf8"),
    ]);
    expect(actions).toContain("isAllowedMutationOrigin");
    expect(actions.match(/confirmedImpact/g)?.length).toBe(2);
    expect(actions).toContain("AUTHORITY_REVIEW_REQUIRED");
    expect(stepUp).toContain("isAllowedMutationOrigin");
    expect(stepUp).toContain("maxAgeSeconds: 0");
    expect(stepUp).toContain('actionKey: "MANAGE_SOURCE_AUTHORITY"');
  });

  it("cannot mutate Reviewed or Working Context and persists no arbitrary metadata", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from)\s+memoid\.(?:context_records|context_revisions|working_context_items|context_identity_current_records)/iu,
    );
    expect(migration).not.toMatch(/authority_(?:payload|metadata)\s+jsonb/iu);
    expect(migration).toContain("reason_note varchar(500)");
  });
});
