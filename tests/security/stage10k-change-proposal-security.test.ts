import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../packages/db/src/migrations/013-stage10k-change-proposals-backlog.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("Stage 10K Change Proposal security contract", () => {
  it("forces RLS on every Project-owned Proposal table", () => {
    for (const table of [
      "change_proposals",
      "change_proposal_items",
      "proposal_current_states",
      "proposal_item_current_states",
      "proposal_state_events",
    ]) {
      expect(migration).toContain(`"${table}"`);
    }
    expect(migration).toContain("force row level security");
  });

  it("uses Project-scoped foreign keys for reconciliation, Context, Working, and successors", () => {
    expect(migration).toContain("foreign key (workspace_id,project_id,reconciliation_id)");
    expect(migration).toContain("foreign key (workspace_id,project_id,context_identity_id)");
    expect(migration).toContain("foreign key (workspace_id,project_id,working_context_item_id)");
    expect(migration).toContain("foreign key (workspace_id,project_id,successor_item_id)");
    expect(migration).toContain("foreign key (workspace_id,project_id,successor_proposal_id)");
  });

  it("denies direct writes and limits materialization to system or worker Actors", () => {
    expect(migration).toContain("revoke all on memoid.change_proposals");
    expect(migration).not.toContain("grant insert on memoid.change_proposals");
    expect(migration).toContain("actor_row.actor_kind not in ('MEMOID_SYSTEM','MEMOID_WORKER')");
  });

  it("uses fixed search paths and immutable history guards", () => {
    expect(migration).toContain("security definer set search_path=pg_catalog,memoid");
    expect(migration).toContain("Proposal history is immutable");
  });

  it("has no trusted review or Reviewed Context mutation operation", () => {
    expect(migration).not.toMatch(
      /APPROVE_CHANGE_PROPOSAL|REJECT_CHANGE_PROPOSAL|DEFER_CHANGE_PROPOSAL/u,
    );
    expect(migration).not.toMatch(
      /insert into memoid\.context_revisions|update memoid\.context_records/iu,
    );
  });
});
