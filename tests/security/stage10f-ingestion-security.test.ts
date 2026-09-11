import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../packages/db/src/migrations/007-stage10f-ingestion-evidence.ts",
  import.meta.url,
);
const adapterPath = new URL("../../packages/adapters/src/source-ingestion.ts", import.meta.url);
const applicationPath = new URL(
  "../../packages/application/src/source-ingestion.ts",
  import.meta.url,
);

describe("Stage 10F ingestion security boundary", () => {
  it("persists structured references and hashes without repository contents or generic evidence JSON", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration).toContain("create table memoid.evidence_references");
    expect(migration).toContain("content_sha256 bytea");
    expect(migration).not.toMatch(/repository_(?:content|blob|excerpt)|raw_content|patch_text/iu);
    expect(migration).not.toMatch(/evidence_(?:payload|metadata)\s+jsonb/iu);
    expect(migration).toContain("contains no repository contents");
  });

  it("uses forced Project RLS, fixed security-definer search paths, and no direct runtime writes", async () => {
    const migration = await readFile(migrationPath, "utf8");
    expect(migration.match(/force row level security/gu)).toHaveLength(1);
    expect(migration).toContain(
      'for (const tableName of ["evidence_references", "source_ingestion_dispositions"])',
    );
    for (const functionName of [
      "schedule_source_observation",
      "acquire_source_ingestion",
      "record_evidence_reference",
      "complete_source_ingestion",
      "retry_source_ingestion",
    ]) {
      const start = migration.indexOf(`create function memoid.${functionName}`);
      expect(start).toBeGreaterThan(-1);
      expect(migration.slice(start, start + 1_000)).toContain(
        "security definer set search_path = pg_catalog, memoid",
      );
    }
    expect(migration).toContain(
      "grant select on memoid.evidence_references, memoid.source_ingestion_dispositions to memoid_app",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+memoid\.(?:evidence_references|source_ingestion_dispositions)\s+to\s+memoid_app/iu,
    );
  });

  it("keeps installation tokens ephemeral, repository-scoped, read-only, and revoked", async () => {
    const adapter = await readFile(adapterPath, "utf8");
    expect(adapter).toContain("repository_ids: [repositoryId]");
    expect(adapter).toContain('permissions: { metadata: "read", contents: "read" }');
    expect(adapter).toContain('await client.request("DELETE /installation/token")');
    expect(adapter).not.toMatch(/console\.|logger\.|authorization:/iu);
    expect(adapter).not.toMatch(/insert into|update memoid|repository content/iu);
  });

  it("permits only bound system scheduling and worker processing with no human refresh surface", async () => {
    const application = await readFile(applicationPath, "utf8");
    expect(application).toContain('context.actor.kind !== "MEMOID_WORKER"');
    expect(application).toContain('context.actor.kind !== "MEMOID_SYSTEM"');
    expect(application).not.toMatch(/authorize\(|PROJECT_CONTROL|sessionCredentialHash/u);
    expect(application).not.toMatch(/WorkingContext|ContextRecord|ChangeProposal|reconcil/iu);
  });
});
