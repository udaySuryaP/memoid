import { authorize } from "@memoid/domain/authorization";
import type {
  ProjectId,
  SourceAuthorityAssignmentId,
  SourceAuthorityScopeId,
  SourceId,
} from "@memoid/domain/identifiers";
import {
  authorityReasonNote,
  authorityRefKey,
  authorityScopeKey,
  parseAuthorityCategoryFacet,
  parseAuthorityReasonKey,
  parseAuthorityRefSelector,
  parseAuthorityScopeKind,
  type AuthorityAssignmentView,
  type AuthorityReasonKey,
  type AuthorityRefSelector,
  type AuthorityScopeKind,
} from "@memoid/domain/source-authority";
import type { ProjectLifecycleState } from "@memoid/domain/workspace-project";
import type { WorkspaceProjectContext } from "./workspace-project.js";

export interface AuthoritySourceOption {
  readonly id: SourceId;
  readonly label: string;
  readonly available: boolean;
}

export interface SetSourceAuthorityCommand {
  readonly projectId: ProjectId;
  readonly sourceId: SourceId;
  readonly categoryFacet: string;
  readonly scopeKind: AuthorityScopeKind;
  readonly scopeKey?: string | null;
  readonly refSelector: AuthorityRefSelector;
  readonly refKey?: string | null;
  readonly expectedVersion: number;
  readonly reasonKey: AuthorityReasonKey;
  readonly reasonNote?: string | null;
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestFingerprint: Uint8Array;
}

export interface RevokeSourceAuthorityCommand {
  readonly projectId: ProjectId;
  readonly scopeId: SourceAuthorityScopeId;
  readonly expectedVersion: number;
  readonly reasonKey: AuthorityReasonKey;
  readonly reasonNote?: string | null;
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestFingerprint: Uint8Array;
}

export interface SourceAuthorityRepository {
  findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null>;
  listAssignments(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly AuthorityAssignmentView[]>;
  listSources(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly AuthoritySourceOption[]>;
  hasScopedStepUp(context: WorkspaceProjectContext, projectId: ProjectId): Promise<boolean>;
  setAssignment(
    context: WorkspaceProjectContext,
    command: SetSourceAuthorityCommand,
  ): Promise<{
    readonly assignmentId: SourceAuthorityAssignmentId;
    readonly version: number;
    readonly replayed: boolean;
  }>;
  revokeAssignment(
    context: WorkspaceProjectContext,
    command: RevokeSourceAuthorityCommand,
  ): Promise<{
    readonly scopeId: SourceAuthorityScopeId;
    readonly version: number;
    readonly replayed: boolean;
  }>;
  close(): Promise<void>;
}

export class SourceAuthorityAccessError extends Error {
  public constructor(
    public readonly code: "DENIED" | "NOT_FOUND" | "UNAVAILABLE" | "STEP_UP_REQUIRED",
  ) {
    super(code);
  }
}

export class SourceAuthorityService {
  public constructor(private readonly repository: SourceAuthorityRepository) {}

  private async require(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    mutate: boolean,
  ): Promise<void> {
    const state = await this.repository.findProjectState(context, projectId);
    if (!state) throw new SourceAuthorityAccessError("NOT_FOUND");
    const decision = authorize({
      principal: context.principal,
      actor: context.actor,
      capability: mutate ? "PROJECT_MANAGE_SOURCE_AUTHORITY" : "PROJECT_READ",
      workspaceId: context.workspaceId,
      projectId,
      resourceState: state,
      grants: [],
      freshAuthenticationRequired: mutate,
      freshAuthenticationSatisfied: context.freshAuthenticationSatisfied ?? false,
    });
    if (!decision.allowed) {
      if (decision.reason === "RESOURCE_UNAVAILABLE")
        throw new SourceAuthorityAccessError("UNAVAILABLE");
      if (decision.reason === "FRESH_AUTH_REQUIRED")
        throw new SourceAuthorityAccessError("STEP_UP_REQUIRED");
      throw new SourceAuthorityAccessError("DENIED");
    }
    if (mutate && !(await this.repository.hasScopedStepUp(context, projectId)))
      throw new SourceAuthorityAccessError("STEP_UP_REQUIRED");
  }

  public async overview(context: WorkspaceProjectContext, projectId: ProjectId) {
    await this.require(context, projectId, false);
    const [assignments, sources, stepUpSatisfied] = await Promise.all([
      this.repository.listAssignments(context, projectId),
      this.repository.listSources(context, projectId),
      this.repository.hasScopedStepUp(context, projectId),
    ]);
    return { assignments, sources, stepUpSatisfied };
  }

  public async set(context: WorkspaceProjectContext, command: SetSourceAuthorityCommand) {
    await this.require(context, command.projectId, true);
    const { category, facet } = parseAuthorityCategoryFacet(command.categoryFacet);
    const scopeKind = parseAuthorityScopeKind(command.scopeKind);
    const refSelector = parseAuthorityRefSelector(command.refSelector);
    return this.repository.setAssignment(context, {
      ...command,
      categoryFacet: `${category}:${facet}`,
      scopeKind,
      scopeKey: authorityScopeKey(scopeKind, command.scopeKey),
      refSelector,
      refKey: authorityRefKey(refSelector, command.refKey),
      reasonKey: parseAuthorityReasonKey(command.reasonKey),
      reasonNote: authorityReasonNote(command.reasonNote),
    });
  }

  public async revoke(context: WorkspaceProjectContext, command: RevokeSourceAuthorityCommand) {
    await this.require(context, command.projectId, true);
    return this.repository.revokeAssignment(context, {
      ...command,
      reasonKey: parseAuthorityReasonKey(command.reasonKey),
      reasonNote: authorityReasonNote(command.reasonNote),
    });
  }
}
