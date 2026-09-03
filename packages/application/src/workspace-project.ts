import {
  authorize,
  type AuthenticatedPrincipal,
  type AuthorizationActor,
  type Capability,
} from "@memoid/domain/authorization";
import type { AccountId, ProjectId, WorkspaceId } from "@memoid/domain/identifiers";
import type { ReviewPolicy } from "@memoid/domain/values";
import {
  projectDescription,
  projectDisplayName,
  type PersonalWorkspace,
  type ProjectSummary,
} from "@memoid/domain/workspace-project";

export interface WorkspaceProjectContext {
  readonly accountId: AccountId;
  readonly workspaceId: WorkspaceId;
  readonly sessionCredentialHash: Uint8Array;
  readonly principal: AuthenticatedPrincipal;
  readonly actor: AuthorizationActor;
}

export interface CreateProjectCommand {
  readonly displayName: string;
  readonly description?: string | null;
  readonly reviewPolicy?: ReviewPolicy;
  readonly idempotencyKeyHash: Uint8Array;
  readonly requestFingerprint: Uint8Array;
}

export interface UpdateProjectCommand {
  readonly projectId: ProjectId;
  readonly expectedVersion: number;
  readonly displayName: string;
  readonly description?: string | null;
}

export interface ProjectLifecycleRepository {
  findPersonalWorkspace(accountId: AccountId): Promise<PersonalWorkspace | null>;
  ensureHumanActor(accountId: AccountId, workspaceId: WorkspaceId): Promise<AuthorizationActor>;
  createProject(
    context: WorkspaceProjectContext,
    command: CreateProjectCommand,
  ): Promise<{ readonly project: ProjectSummary; readonly replayed: boolean }>;
  listProjects(context: WorkspaceProjectContext): Promise<readonly ProjectSummary[]>;
  findProject(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectSummary | null>;
  updateProject(
    context: WorkspaceProjectContext,
    command: UpdateProjectCommand,
  ): Promise<ProjectSummary>;
  close(): Promise<void>;
}

export class WorkspaceProjectAccessError extends Error {
  public constructor(public readonly code: "DENIED" | "NOT_FOUND" | "UNAVAILABLE") {
    super(code);
  }
}

function requireCapability(
  context: WorkspaceProjectContext,
  capability: Capability,
  project?: ProjectSummary,
): void {
  const decision = authorize({
    principal: context.principal,
    actor: context.actor,
    capability,
    workspaceId: context.workspaceId,
    ...(project === undefined
      ? {}
      : { projectId: project.id, resourceState: project.lifecycleState }),
    grants: [],
  });
  if (!decision.allowed)
    throw new WorkspaceProjectAccessError(
      decision.reason === "RESOURCE_UNAVAILABLE" ? "UNAVAILABLE" : "DENIED",
    );
}

export class WorkspaceProjectService {
  public constructor(private readonly repository: ProjectLifecycleRepository) {}

  public async createProject(
    context: WorkspaceProjectContext,
    command: CreateProjectCommand,
  ): Promise<{ readonly project: ProjectSummary; readonly replayed: boolean }> {
    requireCapability(context, "PROJECT_CONTROL");
    return this.repository.createProject(context, {
      ...command,
      displayName: projectDisplayName(command.displayName),
      description: projectDescription(command.description),
      reviewPolicy: command.reviewPolicy ?? "MANUAL",
    });
  }

  public async listProjects(context: WorkspaceProjectContext): Promise<readonly ProjectSummary[]> {
    requireCapability(context, "PROJECT_DISCOVER");
    return this.repository.listProjects(context);
  }

  public async readProject(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectSummary> {
    const project = await this.repository.findProject(context, projectId);
    if (!project) throw new WorkspaceProjectAccessError("NOT_FOUND");
    requireCapability(context, "PROJECT_READ", project);
    return project;
  }

  public async updateProject(
    context: WorkspaceProjectContext,
    command: UpdateProjectCommand,
  ): Promise<ProjectSummary> {
    const project = await this.repository.findProject(context, command.projectId);
    if (!project) throw new WorkspaceProjectAccessError("NOT_FOUND");
    requireCapability(context, "PROJECT_CONTROL", project);
    return this.repository.updateProject(context, {
      ...command,
      displayName: projectDisplayName(command.displayName),
      description: projectDescription(command.description),
    });
  }
}
