import type {
  AcquiredSourceIngestion,
  AuthoritativeRefObservation,
  ExtractedRepositoryEvidence,
  ScheduledSourceObservation,
  SourceIngestionContext,
  SourceIngestionProviderPort,
  SourceIngestionRepository,
  SourceProviderConnection,
} from "@memoid/application/source-ingestion";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import {
  INGESTION_LIMITS,
  classifyRepositoryEntry,
  containsLikelySecret,
  decodeBoundedUtf8,
  evidenceReferenceDraft,
  isGitLfsPointer,
  parseUuidV7,
  repositoryRevision,
  type ActorId,
  type EvidenceReferenceDraft,
  type ProjectId,
  type SourceFrontierUnitId,
  type SourceId,
  type SourceObservationId,
  type WorkspaceId,
} from "@memoid/domain";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { GitHubAppConfiguration } from "./github-source.js";

const GITHUB_API_VERSION = "2026-03-10";

interface GitHubRepositoryIdentity {
  readonly id: number;
  readonly name: string;
  readonly owner: { readonly id: number; readonly login: string };
  readonly default_branch: string;
}

interface CandidateEntry {
  readonly path: string;
  readonly previousPath: string | null;
  readonly sha: string | null;
  readonly size: number | null;
  readonly mode?: string;
  readonly deleted: boolean;
}

interface GitHubContentIdentity {
  readonly type: string;
  readonly sha?: string;
  readonly size?: number;
}

class CompareFallbackRequired extends Error {}

function safeProviderNumber(value: string, label: string): number {
  if (!/^[1-9][0-9]{0,39}$/u.test(value)) throw new Error(`${label} is malformed`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the SDK safe range`);
  return parsed;
}

function isStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" && error !== null && "status" in error && error.status === status
  );
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export class GitHubSourceIngestionAdapter implements SourceIngestionProviderPort {
  private readonly app: App;

  public constructor(
    private readonly configuration: Pick<GitHubAppConfiguration, "appId" | "privateKey">,
  ) {
    if (configuration.appId.length === 0) throw new Error("GitHub App ID is required");
    this.app = new App({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      Octokit: Octokit.defaults({
        userAgent: "memoid-stage10f-ingestion",
        previews: [],
        request: { headers: { "X-GitHub-Api-Version": GITHUB_API_VERSION } },
        log: { debug() {}, info() {}, warn() {}, error() {} },
      }),
    });
  }

  public async observeRef(
    connection: SourceProviderConnection,
    refKey: string,
  ): Promise<AuthoritativeRefObservation> {
    return this.withRepository(connection, async (client, repository) => {
      const shortRef = refKey.slice("refs/".length);
      try {
        const ref = await client.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
          owner: repository.owner.login,
          repo: repository.name,
          ref: shortRef,
        });
        if (ref.data.object.type !== "commit")
          throw new Error("GitHub branch ref did not resolve to a commit");
        return {
          externalRevision: repositoryRevision(ref.data.object.sha),
          isDefaultRef: refKey === `refs/heads/${repository.default_branch}`,
          observedAt: new Date(),
        };
      } catch (error) {
        if (!isStatus(error, 404)) throw error;
        return {
          externalRevision: null,
          isDefaultRef: refKey === `refs/heads/${repository.default_branch}`,
          observedAt: new Date(),
        };
      }
    });
  }

  public async extractEvidence(input: {
    connection: SourceProviderConnection;
    refKey: string;
    targetRevision: string;
    baseRevision: string | null;
  }): Promise<ExtractedRepositoryEvidence> {
    const target = repositoryRevision(input.targetRevision);
    const base = input.baseRevision === null ? null : repositoryRevision(input.baseRevision);
    return this.withRepository(input.connection, async (client, repository) => {
      let mode: ExtractedRepositoryEvidence["mode"] =
        base === null ? "INITIAL_TREE" : "INCREMENTAL_COMPARE";
      let candidates: CandidateEntry[];
      if (base === null) {
        candidates = await this.readTree(client, repository, target);
      } else if (base === target) {
        candidates = [];
      } else {
        try {
          candidates = await this.compare(client, repository, base, target);
        } catch (error) {
          if (!(error instanceof CompareFallbackRequired)) throw error;
          mode = "BOUNDED_TREE_FALLBACK";
          candidates = await this.readTree(client, repository, target);
        }
      }
      if (candidates.length > INGESTION_LIMITS.maximumCandidateEntries)
        throw new Error("Repository candidate entry bound exceeded");
      const classifications: Record<string, number> = {};
      const references: EvidenceReferenceDraft[] = [];
      let fetchedBytes = 0;
      for (const candidate of candidates) {
        if (references.length >= INGESTION_LIMITS.maximumEvidenceReferences) {
          increment(classifications, "POLICY_EXCLUDED");
          continue;
        }
        if (candidate.deleted) {
          references.push(
            evidenceReferenceDraft({
              kind: "DELETION",
              repositoryRevision: target,
              path: candidate.path,
              previousPath: null,
              providerObjectId: null,
              byteSize: null,
              contentSha256: null,
              structuralLocator: null,
            }),
          );
          continue;
        }
        const reason = classifyRepositoryEntry({
          path: candidate.path,
          byteSize: candidate.size,
          ...(candidate.mode === undefined ? {} : { mode: candidate.mode }),
        });
        if (reason !== null) {
          increment(classifications, reason);
          continue;
        }
        if (!candidate.sha) {
          increment(classifications, "POLICY_EXCLUDED");
          continue;
        }
        const blob = await client.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
          owner: repository.owner.login,
          repo: repository.name,
          file_sha: repositoryRevision(candidate.sha),
        });
        const declaredSize = blob.data.size;
        if (declaredSize === null) {
          increment(classifications, "POLICY_EXCLUDED");
          continue;
        }
        if (declaredSize > INGESTION_LIMITS.maximumFileBytes) {
          increment(classifications, "OVERSIZED");
          continue;
        }
        if (fetchedBytes + declaredSize > INGESTION_LIMITS.maximumFetchedBytes)
          throw new Error("Repository fetched-byte bound exceeded");
        let bytes: Uint8Array;
        try {
          bytes = decodeBoundedUtf8(blob.data.content, declaredSize);
        } catch (error) {
          increment(
            classifications,
            error instanceof Error && error.message.includes("UTF-8")
              ? "UNSUPPORTED_ENCODING"
              : "BINARY",
          );
          continue;
        }
        fetchedBytes += bytes.byteLength;
        if (isGitLfsPointer(bytes)) {
          increment(classifications, "GIT_LFS_POINTER");
          continue;
        }
        if (containsLikelySecret(bytes)) {
          increment(classifications, "SECRET");
          continue;
        }
        references.push(
          evidenceReferenceDraft({
            kind: candidate.previousPath === null ? "FILE" : "RENAMED_FILE",
            repositoryRevision: target,
            path: candidate.path,
            previousPath: candidate.previousPath,
            providerObjectId: repositoryRevision(candidate.sha),
            byteSize: bytes.byteLength,
            contentSha256: createHash("sha256").update(bytes).digest(),
            structuralLocator: null,
          }),
        );
      }
      return { references, classifications, candidateCount: candidates.length, fetchedBytes, mode };
    });
  }

  private async withRepository<T>(
    connection: SourceProviderConnection,
    operation: (client: Octokit, repository: GitHubRepositoryIdentity) => Promise<T>,
  ): Promise<T> {
    if (connection.providerKey !== "GITHUB" || connection.appId !== this.configuration.appId)
      throw new Error("GitHub provider identity mismatch");
    const installationId = safeProviderNumber(connection.installationId, "GitHub installation ID");
    const repositoryId = safeProviderNumber(connection.repositoryId, "GitHub repository ID");
    const installation = await this.app.octokit.request(
      "GET /app/installations/{installation_id}",
      { installation_id: installationId },
    );
    const token = await this.app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
        repository_ids: [repositoryId],
        permissions: { metadata: "read", contents: "read" },
      },
    );
    const client = new Octokit({
      auth: token.data.token,
      userAgent: "memoid-stage10f-installation",
      request: { headers: { "X-GitHub-Api-Version": GITHUB_API_VERSION } },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
    try {
      const response = await client.request("GET /repositories/{repository_id}", {
        repository_id: repositoryId,
      });
      const repository = response.data as GitHubRepositoryIdentity;
      if (
        String(repository.id) !== connection.repositoryId ||
        String(repository.owner.id) !== connection.accountId
      )
        throw new Error("GitHub repository identity changed");
      if (String(installation.data.account?.id) !== connection.accountId)
        throw new Error("GitHub installation account mismatch");
      return await operation(client, repository);
    } finally {
      await client.request("DELETE /installation/token");
    }
  }

  private async compare(
    client: Octokit,
    repository: GitHubRepositoryIdentity,
    base: string,
    target: string,
  ): Promise<CandidateEntry[]> {
    const result = await client.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
      owner: repository.owner.login,
      repo: repository.name,
      basehead: `${base}...${target}`,
      per_page: 100,
      page: 1,
    });
    if (
      !["ahead", "identical"].includes(result.data.status) ||
      result.data.total_commits > 250 ||
      (result.data.files?.length ?? 0) >= 300
    )
      throw new CompareFallbackRequired("GitHub compare is incomplete or non-forward");
    const candidates: CandidateEntry[] = [];
    for (const file of result.data.files ?? []) {
      if (file.status === "removed") {
        candidates.push({
          path: file.filename,
          previousPath: null,
          sha: null,
          size: null,
          deleted: true,
        });
        continue;
      }
      let content: GitHubContentIdentity;
      try {
        const resolved = await client.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: repository.owner.login,
          repo: repository.name,
          path: file.filename,
          ref: target,
        });
        if (Array.isArray(resolved.data))
          throw new CompareFallbackRequired("GitHub compare resolved a directory");
        content = resolved.data as GitHubContentIdentity;
      } catch (error) {
        if (error instanceof CompareFallbackRequired) throw error;
        if (isStatus(error, 404))
          throw new CompareFallbackRequired("GitHub compare path could not be resolved");
        throw error;
      }
      candidates.push({
        path: file.filename,
        previousPath: file.status === "renamed" ? (file.previous_filename ?? null) : null,
        sha: content.sha ?? null,
        size: content.size ?? null,
        ...(content.type === "symlink"
          ? { mode: "120000" }
          : content.type === "submodule"
            ? { mode: "160000" }
            : {}),
        deleted: false,
      });
    }
    return candidates;
  }

  private async readTree(
    client: Octokit,
    repository: GitHubRepositoryIdentity,
    revision: string,
  ): Promise<CandidateEntry[]> {
    const commit = await client.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
      owner: repository.owner.login,
      repo: repository.name,
      commit_sha: revision,
    });
    const recursive = await client.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
      owner: repository.owner.login,
      repo: repository.name,
      tree_sha: commit.data.tree.sha,
      recursive: "1",
    });
    if (
      !recursive.data.truncated &&
      recursive.data.tree.length <= INGESTION_LIMITS.maximumCandidateEntries
    )
      return recursive.data.tree
        .filter((entry) => entry.type === "blob" || entry.mode === "160000")
        .map((entry) => ({
          path: entry.path!,
          previousPath: null,
          sha: entry.sha ?? null,
          size: entry.size ?? null,
          mode: entry.mode,
          deleted: false,
        }));
    const candidates: CandidateEntry[] = [];
    const queue: Array<{ sha: string; prefix: string }> = [
      { sha: commit.data.tree.sha, prefix: "" },
    ];
    let calls = 0;
    while (queue.length > 0) {
      if (++calls > 500) throw new Error("Repository tree API-call bound exceeded");
      const current = queue.shift()!;
      const page = await client.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner: repository.owner.login,
        repo: repository.name,
        tree_sha: current.sha,
      });
      if (page.data.truncated) throw new Error("Non-recursive GitHub tree was truncated");
      for (const entry of page.data.tree) {
        if (!entry.path || !entry.sha) continue;
        const path = current.prefix ? `${current.prefix}/${entry.path}` : entry.path;
        if (entry.type === "tree") queue.push({ sha: entry.sha, prefix: path });
        else if (entry.type === "blob" || entry.mode === "160000")
          candidates.push({
            path,
            previousPath: null,
            sha: entry.sha,
            size: entry.size ?? null,
            mode: entry.mode,
            deleted: false,
          });
        if (candidates.length > INGESTION_LIMITS.maximumCandidateEntries)
          throw new Error("Repository candidate entry bound exceeded");
      }
    }
    return candidates;
  }
}

function securityContext(context: SourceIngestionContext) {
  return {
    accountId: context.accountId,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    actorId: context.actor.id,
  };
}

export class PostgresSourceIngestionRepository implements SourceIngestionRepository {
  private readonly db: Kysely<MemoidDatabase>;
  public constructor(connectionString: string, poolSize = 4) {
    this.db = createDatabase(connectionString, poolSize);
  }

  public async connection(
    context: SourceIngestionContext,
    sourceId: SourceId,
  ): Promise<SourceProviderConnection> {
    return withSecurityTransaction(this.db, securityContext(context), async (trx) => {
      const row = (
        await sql<{
          accountId: string;
          appId: string;
          installationId: string;
          ownerLogin: string;
          repositoryId: string;
          repositoryName: string;
        }>`select account_id as "accountId", app_id as "appId", installation_id as "installationId",
          repository_id as "repositoryId", owner_login as "ownerLogin", repository_name as "repositoryName"
        from memoid.github_source_connections where workspace_id = ${context.workspaceId}::uuid
          and project_id = ${context.projectId}::uuid and source_id = ${sourceId}::uuid
          and connection_state = 'ACTIVE'`.execute(trx)
      ).rows[0];
      if (!row) throw new Error("SOURCE_UNAVAILABLE");
      return { providerKey: "GITHUB", ...row };
    });
  }

  public async schedule(
    context: SourceIngestionContext,
    input: {
      sourceId: SourceId;
      refKey: string;
      observation: AuthoritativeRefObservation;
      correlationId: string;
      causationId?: string;
    },
  ): Promise<ScheduledSourceObservation> {
    return withSecurityTransaction(this.db, securityContext(context), async (trx) => {
      const row = (
        await sql<{
          created: boolean;
          frontierUnitId: string;
          observationId: string;
          observationSequence: string;
        }>`select created, frontier_unit_id::text as "frontierUnitId",
          observation_id::text as "observationId", observation_sequence::text as "observationSequence"
        from memoid.schedule_source_observation(
          ${context.workspaceId}::uuid, ${context.projectId}::uuid, ${input.sourceId}::uuid,
          ${context.actor.id}::uuid, 'repository', ${input.refKey}, ${input.observation.externalRevision},
          ${input.observation.isDefaultRef}, ${input.observation.observedAt},
          ${input.correlationId}::uuid, ${input.causationId ?? null}::uuid
        )`.execute(trx)
      ).rows[0];
      if (!row) throw new Error("Source observation was not scheduled");
      return {
        frontierUnitId: parseUuidV7(
          row.frontierUnitId,
          "SourceFrontierUnitId",
        ) as SourceFrontierUnitId,
        observationId: parseUuidV7(row.observationId, "SourceObservationId") as SourceObservationId,
        observationSequence: Number(row.observationSequence),
        created: row.created,
      };
    });
  }

  public async acquire(
    context: SourceIngestionContext,
    input: { sourceId: SourceId; refKey: string; leaseSeconds: number },
  ): Promise<AcquiredSourceIngestion | null> {
    return withSecurityTransaction(this.db, securityContext(context), async (trx) => {
      const row = (
        await sql<{
          accountId: string;
          appId: string;
          baseRevision: string | null;
          externalRevision: string | null;
          frontierUnitId: string;
          installationId: string;
          leaseToken: string;
          observationId: string;
          observationSequence: string;
          ownerLogin: string;
          repositoryId: string;
          repositoryName: string;
        }>`select account_id as "accountId", app_id as "appId", base_revision as "baseRevision",
          external_revision as "externalRevision", frontier_unit_id::text as "frontierUnitId",
          installation_id as "installationId", lease_token::text as "leaseToken",
          observation_id::text as "observationId", observation_sequence::text as "observationSequence",
          owner_login as "ownerLogin", repository_id as "repositoryId", repository_name as "repositoryName"
        from memoid.acquire_source_ingestion(
          ${context.workspaceId}::uuid, ${context.projectId}::uuid, ${input.sourceId}::uuid,
          ${input.refKey}, ${context.actor.id}::uuid, ${input.leaseSeconds}
        )`.execute(trx)
      ).rows[0];
      if (!row) return null;
      return {
        sourceId: input.sourceId,
        frontierUnitId: parseUuidV7(
          row.frontierUnitId,
          "SourceFrontierUnitId",
        ) as SourceFrontierUnitId,
        observationId: parseUuidV7(row.observationId, "SourceObservationId") as SourceObservationId,
        observationSequence: Number(row.observationSequence),
        externalRevision: row.externalRevision,
        baseRevision: row.baseRevision,
        leaseToken: row.leaseToken,
        connection: {
          providerKey: "GITHUB",
          accountId: row.accountId,
          appId: row.appId,
          installationId: row.installationId,
          repositoryId: row.repositoryId,
          ownerLogin: row.ownerLogin,
          repositoryName: row.repositoryName,
        },
      };
    });
  }

  public async recordReference(
    context: SourceIngestionContext,
    acquired: AcquiredSourceIngestion,
    reference: EvidenceReferenceDraft,
  ): Promise<void> {
    await withSecurityTransaction(this.db, securityContext(context), async (trx) => {
      await sql`select memoid.record_evidence_reference(
        ${context.workspaceId}::uuid, ${context.projectId}::uuid, ${acquired.sourceId}::uuid,
        ${acquired.frontierUnitId}::uuid, ${acquired.observationId}::uuid,
        ${context.actor.id}::uuid, ${acquired.leaseToken}::uuid,
        ${reference.kind}, ${reference.repositoryRevision}, ${reference.path},
        ${reference.previousPath}, ${reference.providerObjectId}, ${reference.byteSize},
        ${reference.contentSha256 ? Buffer.from(reference.contentSha256) : null}::bytea,
        ${reference.structuralLocator}
      )`.execute(trx);
    });
  }

  public async complete(
    context: SourceIngestionContext,
    acquired: AcquiredSourceIngestion,
    extraction: ExtractedRepositoryEvidence,
  ): Promise<{ followUpRequired: boolean }> {
    return withSecurityTransaction(this.db, securityContext(context), async (trx) => {
      const row = (
        await sql<{ followUpRequired: boolean }>`select follow_up_required as "followUpRequired"
        from memoid.complete_source_ingestion(
          ${context.workspaceId}::uuid, ${context.projectId}::uuid,
          ${acquired.sourceId}::uuid,
          ${acquired.frontierUnitId}::uuid, ${acquired.observationId}::uuid,
          ${context.actor.id}::uuid, ${acquired.leaseToken}::uuid, ${extraction.mode},
          ${extraction.candidateCount}, ${extraction.fetchedBytes}, ${JSON.stringify(extraction.classifications)}::jsonb
        )`.execute(trx)
      ).rows[0];
      if (!row) throw new Error("Source ingestion completion returned no result");
      return row;
    });
  }

  public async retry(
    context: SourceIngestionContext,
    acquired: AcquiredSourceIngestion,
    input: {
      nextAttemptAt: Date;
      failureCode: string;
      failureMetadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    await withSecurityTransaction(this.db, securityContext(context), async (trx) => {
      await sql`select memoid.retry_source_ingestion(
        ${context.workspaceId}::uuid, ${context.projectId}::uuid,
        ${acquired.sourceId}::uuid,
        ${acquired.frontierUnitId}::uuid, ${context.actor.id}::uuid, ${acquired.leaseToken}::uuid,
        ${input.nextAttemptAt}, ${input.failureCode}, ${JSON.stringify(input.failureMetadata ?? {})}::jsonb
      )`.execute(trx);
    });
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}

export interface SourceIngestionRuntimeTarget {
  readonly context: SourceIngestionContext;
  readonly sourceId: SourceId;
  readonly refKey: string;
  readonly correlationId: string;
}

export class PostgresSourceIngestionRuntimeRepository {
  private readonly db: Kysely<MemoidDatabase>;

  public constructor(connectionString: string, poolSize = 2) {
    this.db = createDatabase(connectionString, poolSize);
  }

  public async listTargets(input: {
    appId: string;
    installationId?: string;
    repositoryId?: string;
    refKey?: string;
  }): Promise<readonly SourceIngestionRuntimeTarget[]> {
    const rows = (
      await sql<{
        accountId: string;
        workspaceId: string;
        projectId: string;
        sourceId: string;
        workerActorId: string;
        refKey: string;
        correlationId: string;
      }>`select account_id::text as "accountId", workspace_id::text as "workspaceId",
        project_id::text as "projectId", source_id::text as "sourceId",
        worker_actor_id::text as "workerActorId", ref_key as "refKey",
        correlation_id::text as "correlationId"
      from memoid.list_source_ingestion_runtime_targets(
        ${input.appId}, ${input.installationId ?? null},
        ${input.repositoryId ?? null}, ${input.refKey ?? null}
      )`.execute(this.db)
    ).rows;
    return rows.map((row) => {
      const workspaceId = parseUuidV7(row.workspaceId, "WorkspaceId") as WorkspaceId;
      const projectId = parseUuidV7(row.projectId, "ProjectId") as ProjectId;
      const actorId = parseUuidV7(row.workerActorId, "ActorId") as ActorId;
      return {
        context: {
          accountId: row.accountId,
          workspaceId,
          projectId,
          actor: {
            id: actorId,
            kind: "MEMOID_WORKER" as const,
            reference: "worker:source-ingestion",
          },
        },
        sourceId: parseUuidV7(row.sourceId, "SourceId") as SourceId,
        refKey: row.refKey,
        correlationId: row.correlationId,
      };
    });
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
