import { authorize } from "@memoid/domain/authorization";
import {
  contextMutationInput,
  parseContextEndReason,
  type ContextEndReason,
  type ContextOriginKind,
  type ContextRecordView,
} from "@memoid/domain/context-record";
import type {
  ContextIdentityId,
  ContextRecordId,
  EvidenceReferenceId,
  ProjectId,
  SourceAuthorityAssignmentId,
} from "@memoid/domain/identifiers";
import type { ContextIdentityComponents } from "@memoid/domain/context-identity";
import type { ProjectLifecycleState } from "@memoid/domain/workspace-project";
import type { WorkspaceProjectContext } from "./workspace-project.js";

export interface PutContextRecordCommand {
  readonly projectId: ProjectId;
  readonly identity: ContextIdentityComponents;
  readonly expectedIdentityVersion: number;
  readonly expectedCurrentRecordId?: ContextRecordId | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly originKind: Exclude<ContextOriginKind, "MEMOID_OPERATION">;
  readonly evidenceReferenceId?: EvidenceReferenceId | null;
  readonly sourceAuthorityAssignmentId?: SourceAuthorityAssignmentId | null;
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestFingerprint: Uint8Array;
}

export interface EndContextIdentityCommand {
  readonly projectId: ProjectId;
  readonly contextIdentityId: ContextIdentityId;
  readonly expectedIdentityVersion: number;
  readonly expectedCurrentRecordId: ContextRecordId;
  readonly reasonKey: ContextEndReason;
  readonly reasonNote?: string | null;
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestFingerprint: Uint8Array;
}

export interface ContextRecordRepository {
  findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null>;
  listCurrent(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly ContextRecordView[]>;
  put(
    context: WorkspaceProjectContext,
    command: PutContextRecordCommand,
  ): Promise<{
    readonly contextIdentityId: ContextIdentityId;
    readonly contextRecordId: ContextRecordId;
    readonly identityVersion: number;
    readonly recordVersion: number;
    readonly replayed: boolean;
  }>;
  end(
    context: WorkspaceProjectContext,
    command: EndContextIdentityCommand,
  ): Promise<{
    readonly contextIdentityId: ContextIdentityId;
    readonly identityVersion: number;
    readonly replayed: boolean;
  }>;
  close(): Promise<void>;
}

export class ContextAccessError extends Error {
  public constructor(public readonly code: "DENIED" | "NOT_FOUND" | "UNAVAILABLE") {
    super(code);
  }
}

export class ContextRecordService {
  public constructor(private readonly repository: ContextRecordRepository) {}

  private async require(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    mutate: boolean,
  ): Promise<void> {
    const state = await this.repository.findProjectState(context, projectId);
    if (!state) throw new ContextAccessError("NOT_FOUND");
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
      throw new ContextAccessError(
        decision.reason === "RESOURCE_UNAVAILABLE" ? "UNAVAILABLE" : "DENIED",
      );
  }

  public async list(context: WorkspaceProjectContext, projectId: ProjectId) {
    await this.require(context, projectId, false);
    return this.repository.listCurrent(context, projectId);
  }

  public async put(context: WorkspaceProjectContext, command: PutContextRecordCommand) {
    await this.require(context, command.projectId, true);
    if (
      !Number.isSafeInteger(command.expectedIdentityVersion) ||
      command.expectedIdentityVersion < 0
    )
      throw new Error("Expected Context identity version must be a non-negative integer");
    const validated = contextMutationInput(
      command.identity,
      command.payload,
      command.originKind,
      command.evidenceReferenceId,
      command.sourceAuthorityAssignmentId,
    );
    return this.repository.put(context, {
      ...command,
      ...validated,
      expectedCurrentRecordId: command.expectedCurrentRecordId ?? null,
    });
  }

  public async end(context: WorkspaceProjectContext, command: EndContextIdentityCommand) {
    await this.require(context, command.projectId, true);
    if (
      !Number.isSafeInteger(command.expectedIdentityVersion) ||
      command.expectedIdentityVersion < 1
    )
      throw new Error("Expected Context identity version must be positive");
    const reasonNote = command.reasonNote?.trim() || null;
    if (
      reasonNote &&
      (reasonNote.length > 500 ||
        [...reasonNote].some((value) => {
          const code = value.codePointAt(0) ?? 0;
          return code < 32 || code === 127;
        }))
    )
      throw new Error("Context ending note is invalid");
    return this.repository.end(context, {
      ...command,
      reasonKey: parseContextEndReason(command.reasonKey),
      reasonNote,
    });
  }
}
