import { authorize } from "@memoid/domain/authorization";
import {
  assertIntegrityTransition,
  conflictParticipants,
  parseConflictClassification,
  parseConflictEndReason,
  parseUncertaintyEndReason,
  parseUncertaintyReason,
  resolutionLink,
  type ConflictClassification,
  type ConflictEndReason,
  type ConflictParticipantReference,
  type IntegrityLifecycleState,
  type UncertaintyEndReason,
  type UncertaintyReason,
  type UncertaintyTargetReference,
} from "@memoid/domain/conflict-uncertainty";
import type {
  ConflictId,
  ConflictOccurrenceId,
  ContextIdentityId,
  ContextRevisionId,
  EvidenceReferenceId,
  ProjectId,
  SourceAuthorityAssignmentId,
  SourceId,
  UncertaintyId,
  UncertaintyOccurrenceId,
} from "@memoid/domain/identifiers";
import type { ProjectLifecycleState } from "@memoid/domain/workspace-project";
import type { WorkspaceProjectContext } from "./workspace-project.js";

interface MutationProof {
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestFingerprint: Uint8Array;
}

export interface EstablishConflictCommand extends MutationProof {
  readonly projectId: ProjectId;
  readonly contextIdentityId: ContextIdentityId;
  readonly expectedVersion: number;
  readonly classification: ConflictClassification;
  readonly participants: readonly ConflictParticipantReference[];
}

export interface EndConflictCommand extends MutationProof {
  readonly projectId: ProjectId;
  readonly conflictId: ConflictId;
  readonly expectedVersion: number;
  readonly reason: ConflictEndReason;
  readonly resolvedByContextRevisionId?: ContextRevisionId | null;
}

export interface EstablishUncertaintyCommand extends MutationProof {
  readonly projectId: ProjectId;
  readonly contextIdentityId: ContextIdentityId;
  readonly expectedVersion: number;
  readonly target: UncertaintyTargetReference;
  readonly reason: UncertaintyReason;
  readonly basisEvidenceReferenceId?: EvidenceReferenceId | null;
}

export interface EndUncertaintyCommand extends MutationProof {
  readonly projectId: ProjectId;
  readonly uncertaintyId: UncertaintyId;
  readonly expectedVersion: number;
  readonly reason: UncertaintyEndReason;
  readonly resolvedByContextRevisionId?: ContextRevisionId | null;
}

export type ConflictParticipantView = ConflictParticipantReference & {
  readonly ordinal: number;
  readonly sourceId?: SourceId;
  readonly effectiveAuthorityAssignmentId?: SourceAuthorityAssignmentId;
  readonly sourceQualification?: string;
};

export interface ConflictView {
  readonly conflictId: ConflictId;
  readonly occurrenceId: ConflictOccurrenceId;
  readonly contextIdentityId: ContextIdentityId;
  readonly version: number;
  readonly lifecycleState: IntegrityLifecycleState;
  readonly classification: ConflictClassification;
  readonly endingReason: ConflictEndReason | null;
  readonly resolvedByContextRevisionId: ContextRevisionId | null;
  readonly participants: readonly ConflictParticipantView[];
  readonly occurredAt: string;
}

export interface UncertaintyView {
  readonly uncertaintyId: UncertaintyId;
  readonly occurrenceId: UncertaintyOccurrenceId;
  readonly contextIdentityId: ContextIdentityId;
  readonly version: number;
  readonly lifecycleState: IntegrityLifecycleState;
  readonly target: UncertaintyTargetReference;
  readonly reason: UncertaintyReason | null;
  readonly endingReason: UncertaintyEndReason | null;
  readonly basisEvidenceReferenceId: EvidenceReferenceId | null;
  readonly sourceQualification: string | null;
  readonly resolvedByContextRevisionId: ContextRevisionId | null;
  readonly occurredAt: string;
}

export interface ConflictUncertaintyRepository {
  findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null>;
  listConflicts(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    activeOnly: boolean,
  ): Promise<readonly ConflictView[]>;
  listUncertainties(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    activeOnly: boolean,
  ): Promise<readonly UncertaintyView[]>;
  recordConflict(
    context: WorkspaceProjectContext,
    command:
      | (EstablishConflictCommand & { readonly lifecycleState: "ACTIVE" })
      | (EndConflictCommand & { readonly lifecycleState: "ENDED" }),
  ): Promise<{
    readonly conflictId: ConflictId;
    readonly occurrenceId: ConflictOccurrenceId;
    readonly version: number;
    readonly replayed: boolean;
  }>;
  recordUncertainty(
    context: WorkspaceProjectContext,
    command:
      | (EstablishUncertaintyCommand & { readonly lifecycleState: "ACTIVE" })
      | (EndUncertaintyCommand & { readonly lifecycleState: "ENDED" }),
  ): Promise<{
    readonly uncertaintyId: UncertaintyId;
    readonly occurrenceId: UncertaintyOccurrenceId;
    readonly version: number;
    readonly replayed: boolean;
  }>;
  close(): Promise<void>;
}

export class IntegrityAccessError extends Error {
  public constructor(public readonly code: "DENIED" | "NOT_FOUND" | "UNAVAILABLE") {
    super(code);
  }
}

export class ConflictUncertaintyService {
  public constructor(private readonly repository: ConflictUncertaintyRepository) {}

  private async require(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    mutate: boolean,
  ): Promise<void> {
    const state = await this.repository.findProjectState(context, projectId);
    if (!state) throw new IntegrityAccessError("NOT_FOUND");
    const decision = authorize({
      principal: context.principal,
      actor: context.actor,
      capability: mutate ? "PROJECT_MANAGE_CONTEXT" : "PROJECT_READ",
      workspaceId: context.workspaceId,
      projectId,
      resourceState: state,
      grants: [],
    });
    if (!decision.allowed)
      throw new IntegrityAccessError(
        decision.reason === "RESOURCE_UNAVAILABLE" ? "UNAVAILABLE" : "DENIED",
      );
  }

  private expectedVersion(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Expected integrity version must be a non-negative integer");
  }

  public async list(context: WorkspaceProjectContext, projectId: ProjectId, activeOnly = true) {
    await this.require(context, projectId, false);
    const [conflicts, uncertainties] = await Promise.all([
      this.repository.listConflicts(context, projectId, activeOnly),
      this.repository.listUncertainties(context, projectId, activeOnly),
    ]);
    return { conflicts, uncertainties } as const;
  }

  public async establishConflict(
    context: WorkspaceProjectContext,
    command: EstablishConflictCommand,
  ) {
    await this.require(context, command.projectId, true);
    this.expectedVersion(command.expectedVersion);
    assertIntegrityTransition(command.expectedVersion === 0 ? null : "ACTIVE", "ACTIVE");
    return this.repository.recordConflict(context, {
      ...command,
      classification: parseConflictClassification(command.classification),
      participants: conflictParticipants(command.participants),
      lifecycleState: "ACTIVE",
    });
  }

  public async endConflict(context: WorkspaceProjectContext, command: EndConflictCommand) {
    await this.require(context, command.projectId, true);
    this.expectedVersion(command.expectedVersion);
    if (command.expectedVersion === 0) throw new Error("Conflict must exist before it can end");
    return this.repository.recordConflict(context, {
      ...command,
      reason: parseConflictEndReason(command.reason),
      resolvedByContextRevisionId: resolutionLink(
        command.reason,
        command.resolvedByContextRevisionId,
      ),
      lifecycleState: "ENDED",
    });
  }

  public async establishUncertainty(
    context: WorkspaceProjectContext,
    command: EstablishUncertaintyCommand,
  ) {
    await this.require(context, command.projectId, true);
    this.expectedVersion(command.expectedVersion);
    return this.repository.recordUncertainty(context, {
      ...command,
      reason: parseUncertaintyReason(command.reason),
      basisEvidenceReferenceId: command.basisEvidenceReferenceId ?? null,
      lifecycleState: "ACTIVE",
    });
  }

  public async endUncertainty(context: WorkspaceProjectContext, command: EndUncertaintyCommand) {
    await this.require(context, command.projectId, true);
    this.expectedVersion(command.expectedVersion);
    if (command.expectedVersion === 0) throw new Error("Uncertainty must exist before it can end");
    return this.repository.recordUncertainty(context, {
      ...command,
      reason: parseUncertaintyEndReason(command.reason),
      resolvedByContextRevisionId: resolutionLink(
        command.reason,
        command.resolvedByContextRevisionId,
      ),
      lifecycleState: "ENDED",
    });
  }
}
