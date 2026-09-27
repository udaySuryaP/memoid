import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../packages/db/src/migrations/014-stage10l-review-policy-transitions.ts",
    import.meta.url,
  ),
  "utf8",
);
const application = readFileSync(
  new URL("../../packages/application/src/review-policy.ts", import.meta.url),
  "utf8",
);

describe("Stage 10L review-policy security contract", () => {
  it("keeps tables read-only to runtime roles and forces Project-scoped RLS", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain(
      "workspace_id=memoid.current_workspace_id() and project_id=memoid.current_project_id()",
    );
    expect(migration).toContain(
      "grant select on memoid.review_policy_evaluations,memoid.review_policy_current_states to memoid_app",
    );
    expect(migration).not.toContain("grant insert");
    expect(migration).not.toContain("grant update");
  });
  it("requires first-party human control and Memoid-only evaluation", () => {
    expect(application).toContain('context.principal.kind !== "HUMAN"');
    expect(application).toContain('context.principal.kind !== "SYSTEM"');
    expect(application).toContain('context.principal.kind !== "WORKER"');
    expect(migration).toContain("POLICY_CHANGE_REQUIRES_FIRST_PARTY_HUMAN");
    expect(migration).toContain("POLICY_EVALUATION_ACTOR_FORBIDDEN");
  });
  it("never exposes trusted review application or Context mutation", () => {
    for (const forbidden of [
      "approve_proposal",
      "reject_proposal",
      "context_revisions(",
      "reviewed context mutation",
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden);
    }
  });
});
