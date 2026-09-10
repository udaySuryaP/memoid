import {
  SourceIngestionError,
  SourceIngestionService,
} from "../../packages/application/src/source-ingestion.js";
import {
  INGESTION_LIMITS,
  classifyRepositoryEntry,
  containsLikelySecret,
  decodeBoundedUtf8,
  evidenceReferenceDraft,
  isGitLfsPointer,
  parseUuidV7,
  repositoryPath,
  repositoryRevision,
  sourceRefKey,
  type ActorId,
  type ProjectId,
  type SourceFrontierUnitId,
  type SourceId,
  type SourceObservationId,
  type WorkspaceId,
} from "../../packages/domain/src/index.js";
import { describe, expect, it, vi } from "vitest";

const ids = {
  workspace: parseUuidV7("0198a000-0000-7000-8000-000000000001", "WorkspaceId") as WorkspaceId,
  project: parseUuidV7("0198a000-0000-7000-8000-000000000002", "ProjectId") as ProjectId,
  source: parseUuidV7("0198a000-0000-7000-8000-000000000003", "SourceId") as SourceId,
  actor: parseUuidV7("0198a000-0000-7000-8000-000000000004", "ActorId") as ActorId,
  unit: parseUuidV7(
    "0198a000-0000-7000-8000-000000000005",
    "SourceFrontierUnitId",
  ) as SourceFrontierUnitId,
  observation: parseUuidV7(
    "0198a000-0000-7000-8000-000000000006",
    "SourceObservationId",
  ) as SourceObservationId,
};
const revision = "a".repeat(40);

describe("Stage 10F deterministic ingestion domain", () => {
  it("normalizes canonical revisions, refs, and safe repository paths", () => {
    expect(repositoryRevision(revision.toUpperCase())).toBe(revision);
    expect(sourceRefKey("refs/heads/feature/safe")).toBe("refs/heads/feature/safe");
    expect(repositoryPath("src/café.ts")).toBe("src/café.ts");
    expect(repositoryPath("src/cafe\u0301.ts")).toBe("src/cafe\u0301.ts");
    expect(() => repositoryRevision("a".repeat(41))).toThrow();
    for (const unsafe of [
      "/etc/passwd",
      "../secret",
      "src\\file.ts",
      "src//file.ts",
      "src/./file.ts",
      `src/${String.fromCharCode(0)}file`,
    ])
      expect(() => repositoryPath(unsafe)).toThrow();
    expect(() => sourceRefKey("refs/tags/v1")).toThrow();
  });

  it("filters generated, vendored, lock, binary, oversized, symlink, and submodule entries", () => {
    expect(classifyRepositoryEntry({ path: "dist/app.js", byteSize: 10 })).toBe("GENERATED");
    expect(classifyRepositoryEntry({ path: "node_modules/a/index.js", byteSize: 10 })).toBe(
      "VENDORED",
    );
    expect(classifyRepositoryEntry({ path: "pnpm-lock.yaml", byteSize: 10 })).toBe("LOCKFILE");
    expect(classifyRepositoryEntry({ path: "logo.png", byteSize: 10 })).toBe("BINARY");
    expect(
      classifyRepositoryEntry({
        path: "large.ts",
        byteSize: INGESTION_LIMITS.maximumFileBytes + 1,
      }),
    ).toBe("OVERSIZED");
    expect(classifyRepositoryEntry({ path: "link", byteSize: 4, mode: "120000" })).toBe("SYMLINK");
    expect(classifyRepositoryEntry({ path: "module", byteSize: 4, mode: "160000" })).toBe(
      "SUBMODULE",
    );
    expect(classifyRepositoryEntry({ path: "src/index.ts", byteSize: 10 })).toBeNull();
  });

  it("decodes only exact bounded UTF-8 and detects secret-like content without retaining it", () => {
    const safe = Buffer.from("export const safe = true;", "utf8");
    expect(decodeBoundedUtf8(safe.toString("base64"), safe.byteLength)).toEqual(safe);
    expect(() => decodeBoundedUtf8(Buffer.from([0, 1]).toString("base64"), 2)).toThrow("binary");
    const secretLabel = ["api", "key"].join("_");
    expect(containsLikelySecret(Buffer.from(`${secretLabel} = "abcdefghijklmnopqrstuvwx"`))).toBe(
      true,
    );
    expect(containsLikelySecret(safe)).toBe(false);
    expect(
      isGitLfsPointer(
        Buffer.from(
          `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 123\n`,
        ),
      ),
    ).toBe(true);
  });

  it("creates structured immutable file, rename, and deletion references", () => {
    const hash = Buffer.alloc(32, 1);
    expect(
      evidenceReferenceDraft({
        kind: "FILE",
        repositoryRevision: revision,
        path: "src/a.ts",
        previousPath: null,
        providerObjectId: "b".repeat(40),
        byteSize: 12,
        contentSha256: hash,
        structuralLocator: null,
      }),
    ).toMatchObject({ kind: "FILE", path: "src/a.ts" });
    expect(
      evidenceReferenceDraft({
        kind: "RENAMED_FILE",
        repositoryRevision: revision,
        path: "src/b.ts",
        previousPath: "src/a.ts",
        providerObjectId: "b".repeat(40),
        byteSize: 12,
        contentSha256: hash,
        structuralLocator: "symbol:Example",
      }),
    ).toMatchObject({ previousPath: "src/a.ts" });
    expect(
      evidenceReferenceDraft({
        kind: "DELETION",
        repositoryRevision: revision,
        path: "src/old.ts",
        previousPath: null,
        providerObjectId: null,
        byteSize: null,
        contentSha256: null,
        structuralLocator: null,
      }),
    ).toMatchObject({ kind: "DELETION" });
    expect(() =>
      evidenceReferenceDraft({
        kind: "FILE",
        repositoryRevision: revision,
        path: "src/a.ts",
        previousPath: null,
        providerObjectId: null,
        byteSize: null,
        contentSha256: null,
        structuralLocator: null,
      }),
    ).toThrow();
  });

  it("rejects human callers before provider or persistence access", async () => {
    const repository = {
      connection: vi.fn(),
      schedule: vi.fn(),
      acquire: vi.fn(),
      recordReference: vi.fn(),
      complete: vi.fn(),
      retry: vi.fn(),
      close: vi.fn(),
    };
    const provider = { observeRef: vi.fn(), extractEvidence: vi.fn() };
    const service = new SourceIngestionService(repository, provider);
    await expect(
      service.observe(
        {
          accountId: ids.workspace,
          workspaceId: ids.workspace,
          projectId: ids.project,
          actor: { id: ids.actor, kind: "HUMAN", reference: "account:owner" },
        },
        { sourceId: ids.source, refKey: "refs/heads/main", correlationId: ids.observation },
      ),
    ).rejects.toEqual(new SourceIngestionError("DENIED"));
    expect(repository.connection).not.toHaveBeenCalled();
  });

  it("separates authoritative observation from leased evidence processing", async () => {
    const connection = {
      providerKey: "GITHUB" as const,
      appId: "1",
      installationId: "2",
      repositoryId: "3",
      accountId: "4",
      ownerLogin: "owner",
      repositoryName: "repo",
    };
    const scheduled = {
      frontierUnitId: ids.unit,
      observationId: ids.observation,
      observationSequence: 1,
      created: true,
    };
    const acquired = {
      sourceId: ids.source,
      ...scheduled,
      externalRevision: revision,
      baseRevision: null,
      leaseToken: ids.actor,
      connection,
    };
    const reference = evidenceReferenceDraft({
      kind: "FILE",
      repositoryRevision: revision,
      path: "src/a.ts",
      previousPath: null,
      providerObjectId: "b".repeat(40),
      byteSize: 1,
      contentSha256: Buffer.alloc(32),
      structuralLocator: null,
    });
    const repository = {
      connection: vi.fn().mockResolvedValue(connection),
      schedule: vi.fn().mockResolvedValue(scheduled),
      acquire: vi.fn().mockResolvedValue(acquired),
      recordReference: vi.fn(),
      complete: vi.fn().mockResolvedValue({ followUpRequired: true }),
      retry: vi.fn(),
      close: vi.fn(),
    };
    const extraction = {
      references: [reference],
      classifications: {},
      candidateCount: 1,
      fetchedBytes: 1,
      mode: "INITIAL_TREE" as const,
    };
    const provider = {
      observeRef: vi.fn().mockResolvedValue({
        externalRevision: revision,
        isDefaultRef: true,
        observedAt: new Date(),
      }),
      extractEvidence: vi.fn().mockResolvedValue(extraction),
    };
    const service = new SourceIngestionService(repository, provider);
    const context = {
      accountId: ids.workspace,
      workspaceId: ids.workspace,
      projectId: ids.project,
      actor: { id: ids.actor, kind: "MEMOID_WORKER" as const, reference: "worker:ingestion" },
    };
    await expect(
      service.observe(context, {
        sourceId: ids.source,
        refKey: "refs/heads/main",
        correlationId: ids.observation,
      }),
    ).resolves.toEqual(scheduled);
    await expect(
      service.processNext(context, { sourceId: ids.source, refKey: "refs/heads/main" }),
    ).resolves.toEqual({ processed: true, followUpRequired: true });
    expect(repository.recordReference).toHaveBeenCalledWith(context, acquired, reference);
    expect(repository.complete).toHaveBeenCalledWith(context, acquired, extraction);
  });

  it("uses an explicit deleted-ref completion without asking the provider for files", async () => {
    const connection = {
      providerKey: "GITHUB" as const,
      appId: "1",
      installationId: "2",
      repositoryId: "3",
      accountId: "4",
      ownerLogin: "owner",
      repositoryName: "repo",
    };
    const acquired = {
      sourceId: ids.source,
      frontierUnitId: ids.unit,
      observationId: ids.observation,
      observationSequence: 2,
      externalRevision: null,
      baseRevision: revision,
      leaseToken: ids.actor,
      connection,
    };
    const repository = {
      connection: vi.fn(),
      schedule: vi.fn(),
      acquire: vi.fn().mockResolvedValue(acquired),
      recordReference: vi.fn(),
      complete: vi.fn().mockResolvedValue({ followUpRequired: false }),
      retry: vi.fn(),
      close: vi.fn(),
    };
    const provider = { observeRef: vi.fn(), extractEvidence: vi.fn() };
    const service = new SourceIngestionService(repository, provider);
    const context = {
      accountId: ids.workspace,
      workspaceId: ids.workspace,
      projectId: ids.project,
      actor: { id: ids.actor, kind: "MEMOID_WORKER" as const, reference: "worker:ingestion" },
    };
    await expect(
      service.processNext(context, { sourceId: ids.source, refKey: "refs/heads/main" }),
    ).resolves.toEqual({ processed: true, followUpRequired: false });
    expect(provider.extractEvidence).not.toHaveBeenCalled();
    expect(repository.complete.mock.calls[0]?.[2]).toMatchObject({
      mode: "REF_DELETED",
      references: [],
    });
  });

  it("preserves scheduled work and records a sanitized retry after provider failure", async () => {
    const connection = {
      providerKey: "GITHUB" as const,
      appId: "1",
      installationId: "2",
      repositoryId: "3",
      accountId: "4",
      ownerLogin: "owner",
      repositoryName: "repo",
    };
    const acquired = {
      sourceId: ids.source,
      frontierUnitId: ids.unit,
      observationId: ids.observation,
      observationSequence: 1,
      externalRevision: revision,
      baseRevision: null,
      leaseToken: ids.actor,
      connection,
    };
    const repository = {
      connection: vi.fn(),
      schedule: vi.fn(),
      acquire: vi.fn().mockResolvedValue(acquired),
      recordReference: vi.fn(),
      complete: vi.fn(),
      retry: vi.fn(),
      close: vi.fn(),
    };
    const providerFailure = new Error("provider body must not escape");
    const provider = {
      observeRef: vi.fn(),
      extractEvidence: vi.fn().mockRejectedValue(providerFailure),
    };
    const service = new SourceIngestionService(repository, provider);
    const context = {
      accountId: ids.workspace,
      workspaceId: ids.workspace,
      projectId: ids.project,
      actor: { id: ids.actor, kind: "MEMOID_WORKER" as const, reference: "worker:ingestion" },
    };
    await expect(
      service.processNext(context, { sourceId: ids.source, refKey: "refs/heads/main" }),
    ).rejects.toBe(providerFailure);
    expect(repository.retry).toHaveBeenCalledWith(
      context,
      acquired,
      expect.objectContaining({
        failureCode: "PROVIDER_UNAVAILABLE",
        failureMetadata: { RETRY_CLASS: "TRANSIENT" },
      }),
    );
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
