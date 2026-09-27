import { authorize } from "@memoid/domain/authorization";
import type {
  ChangeProposalId,
  ChangeProposalItemId,
  ProjectId,
  ReconciliationId,
} from "@memoid/domain/identifiers";
import type { ProposalItemSnapshot, ProposalLifecycleState } from "@memoid/domain/change-proposal";
import type { ProjectLifecycleState } from "@memoid/domain/workspace-project";
import type { WorkspaceProjectContext } from "./workspace-project.js";

export interface MaterializedProposal {
  readonly proposalId: ChangeProposalId;
  readonly proposalItemId: ChangeProposalItemId;
  readonly replayed: boolean;
}

export interface ChangeProposalSummary {
  readonly proposalId: ChangeProposalId;
  readonly lifecycleState: ProposalLifecycleState;
  readonly successorProposalId: ChangeProposalId | null;
  readonly groupingVersion: string;
  readonly scopeKey: string;
  readonly facetKey: string;
  readonly currentItemCount: number;
  readonly totalItemCount: number;
  readonly createdAt: string;
  readonly changedAt: string;
}

export interface ChangeProposalDetail extends ChangeProposalSummary {
  readonly items: readonly ProposalItemSnapshot[];
  readonly lineage: readonly {
    readonly proposalId: ChangeProposalId;
    readonly successorProposalId: ChangeProposalId | null;
    readonly state: string;
    readonly reason: string;
    readonly occurredAt: string;
  }[];
}

export interface ChangeProposalRepository {
  findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null>;
  materialize(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    reconciliationId: ReconciliationId,
  ): Promise<MaterializedProposal | null>;
  refreshCurrentness(context: WorkspaceProjectContext, projectId: ProjectId): Promise<number>;
  listBacklog(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    includeHistorical: boolean,
  ): Promise<readonly ChangeProposalSummary[]>;
  getProposal(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    proposalId: ChangeProposalId,
  ): Promise<ChangeProposalDetail | null>;
  close(): Promise<void>;
}

export class ChangeProposalService {
  public constructor(private readonly repository: ChangeProposalRepository) {}

  private async require(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    mutation: boolean,
  ): Promise<void> {
    const state = await this.repository.findProjectState(context, projectId);
    if (!state) throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
    const decision = authorize({
      principal: context.principal,
      actor: context.actor,
      capability: mutation ? "PROJECT_MANAGE_CONTEXT" : "PROJECT_READ",
      workspaceId: context.workspaceId,
      projectId,
      resourceState: state,
      grants: [],
    });
    if (!decision.allowed)
      throw new Error(
        decision.reason === "RESOURCE_UNAVAILABLE"
          ? "CHANGE_PROPOSAL_PROJECT_UNAVAILABLE"
          : "CHANGE_PROPOSAL_DENIED",
      );
  }

  public async materializeFromReconciliation(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    reconciliationId: ReconciliationId,
  ): Promise<MaterializedProposal | null> {
    await this.require(context, projectId, true);
    if (context.principal.kind !== "SYSTEM" && context.principal.kind !== "WORKER")
      throw new Error("CHANGE_PROPOSAL_INTERNAL_OPERATION_REQUIRED");
    return this.repository.materialize(context, projectId, reconciliationId);
  }

  public async refreshBacklogCurrentness(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<number> {
    await this.require(context, projectId, true);
    if (context.principal.kind !== "SYSTEM" && context.principal.kind !== "WORKER")
      throw new Error("CHANGE_PROPOSAL_INTERNAL_OPERATION_REQUIRED");
    return this.repository.refreshCurrentness(context, projectId);
  }

  public async listCurrentBacklog(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly ChangeProposalSummary[]> {
    await this.require(context, projectId, false);
    return this.repository.listBacklog(context, projectId, false);
  }

  public async listProposalHistory(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly ChangeProposalSummary[]> {
    await this.require(context, projectId, false);
    return this.repository.listBacklog(context, projectId, true);
  }

  public async getProposal(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    proposalId: ChangeProposalId,
  ): Promise<ChangeProposalDetail> {
    await this.require(context, projectId, false);
    const proposal = await this.repository.getProposal(context, projectId, proposalId);
    if (!proposal) throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
    return proposal;
  }
}
