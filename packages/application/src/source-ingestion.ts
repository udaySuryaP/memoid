import type {
  AuthorizationActor,
  EvidenceReferenceDraft,
  ProjectId,
  SourceFrontierUnitId,
  SourceId,
  SourceObservationId,
  WorkspaceId,
} from "@memoid/domain";
import { sourceRefKey } from "@memoid/domain";

export interface SourceIngestionContext {
  readonly accountId: string;
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
  readonly actor: AuthorizationActor;
}

export interface SourceProviderConnection {
  readonly providerKey: "GITHUB";
  readonly appId: string;
  readonly installationId: string;
  readonly repositoryId: string;
  readonly accountId: string;
  readonly ownerLogin: string;
  readonly repositoryName: string;
}

export interface AuthoritativeRefObservation {
  readonly externalRevision: string | null;
  readonly isDefaultRef: boolean;
  readonly observedAt: Date;
}

export interface ExtractedRepositoryEvidence {
  readonly references: readonly EvidenceReferenceDraft[];
  readonly classifications: Readonly<Record<string, number>>;
  readonly candidateCount: number;
  readonly fetchedBytes: number;
  readonly mode: "INITIAL_TREE" | "INCREMENTAL_COMPARE" | "BOUNDED_TREE_FALLBACK" | "REF_DELETED";
}

export interface SourceIngestionProviderPort {
  observeRef(
    connection: SourceProviderConnection,
    refKey: string,
  ): Promise<AuthoritativeRefObservation>;
  extractEvidence(input: {
    connection: SourceProviderConnection;
    refKey: string;
    targetRevision: string;
    baseRevision: string | null;
  }): Promise<ExtractedRepositoryEvidence>;
}

export interface ScheduledSourceObservation {
  readonly frontierUnitId: SourceFrontierUnitId;
  readonly observationId: SourceObservationId;
  readonly observationSequence: number;
  readonly created: boolean;
}

export interface AcquiredSourceIngestion {
  readonly sourceId: SourceId;
  readonly frontierUnitId: SourceFrontierUnitId;
  readonly observationId: SourceObservationId;
  readonly observationSequence: number;
  readonly externalRevision: string | null;
  readonly baseRevision: string | null;
  readonly leaseToken: string;
  readonly connection: SourceProviderConnection;
}

export interface SourceIngestionRepository {
  connection(
    context: SourceIngestionContext,
    sourceId: SourceId,
  ): Promise<SourceProviderConnection>;
  schedule(
    context: SourceIngestionContext,
    input: {
      sourceId: SourceId;
      refKey: string;
      observation: AuthoritativeRefObservation;
      correlationId: string;
      causationId?: string;
    },
  ): Promise<ScheduledSourceObservation>;
  acquire(
    context: SourceIngestionContext,
    input: {
      sourceId: SourceId;
      refKey: string;
      leaseSeconds: number;
    },
  ): Promise<AcquiredSourceIngestion | null>;
  recordReference(
    context: SourceIngestionContext,
    acquired: AcquiredSourceIngestion,
    reference: EvidenceReferenceDraft,
  ): Promise<void>;
  complete(
    context: SourceIngestionContext,
    acquired: AcquiredSourceIngestion,
    extraction: ExtractedRepositoryEvidence,
  ): Promise<{ followUpRequired: boolean }>;
  retry(
    context: SourceIngestionContext,
    acquired: AcquiredSourceIngestion,
    input: {
      nextAttemptAt: Date;
      failureCode: string;
      failureMetadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<void>;
  close(): Promise<void>;
}

export class SourceIngestionError extends Error {
  public constructor(
    public readonly code:
      "DENIED" | "PROVIDER_UNAVAILABLE" | "SOURCE_UNAVAILABLE" | "BOUNDS_EXCEEDED" | "STALE_LEASE",
  ) {
    super(code);
  }
}

function requireWorker(context: SourceIngestionContext): void {
  if (context.actor.kind !== "MEMOID_WORKER" && context.actor.kind !== "MEMOID_SYSTEM")
    throw new SourceIngestionError("DENIED");
}

export class SourceIngestionService {
  public constructor(
    private readonly repository: SourceIngestionRepository,
    private readonly provider: SourceIngestionProviderPort,
  ) {}

  public async observe(
    context: SourceIngestionContext,
    input: { sourceId: SourceId; refKey: string; correlationId: string; causationId?: string },
  ): Promise<ScheduledSourceObservation> {
    requireWorker(context);
    const refKey = sourceRefKey(input.refKey);
    const connection = await this.repository.connection(context, input.sourceId);
    let observation: AuthoritativeRefObservation;
    try {
      observation = await this.provider.observeRef(connection, refKey);
    } catch {
      throw new SourceIngestionError("PROVIDER_UNAVAILABLE");
    }
    return this.repository.schedule(context, { ...input, refKey, observation });
  }

  public async processNext(
    context: SourceIngestionContext,
    input: { sourceId: SourceId; refKey: string; leaseSeconds?: number },
  ): Promise<{ processed: boolean; followUpRequired: boolean }> {
    requireWorker(context);
    const refKey = sourceRefKey(input.refKey);
    const acquired = await this.repository.acquire(context, {
      sourceId: input.sourceId,
      refKey,
      leaseSeconds: input.leaseSeconds ?? 300,
    });
    if (!acquired) return { processed: false, followUpRequired: false };
    let extraction: ExtractedRepositoryEvidence;
    try {
      extraction =
        acquired.externalRevision === null
          ? {
              references: [],
              classifications: {},
              candidateCount: 0,
              fetchedBytes: 0,
              mode: "REF_DELETED" as const,
            }
          : await this.provider.extractEvidence({
              connection: acquired.connection,
              refKey,
              targetRevision: acquired.externalRevision,
              baseRevision: acquired.baseRevision,
            });
    } catch (error) {
      const nextAttemptAt = new Date(Date.now() + 60_000);
      try {
        await this.repository.retry(context, acquired, {
          nextAttemptAt,
          failureCode: error instanceof SourceIngestionError ? error.code : "PROVIDER_UNAVAILABLE",
          failureMetadata: { RETRY_CLASS: "TRANSIENT" },
        });
      } catch {
        // Preserve the original provider failure if the lease expired concurrently.
      }
      throw error;
    }
    for (const reference of extraction.references)
      await this.repository.recordReference(context, acquired, reference);
    const completed = await this.repository.complete(context, acquired, extraction);
    return { processed: true, followUpRequired: completed.followUpRequired };
  }
}
