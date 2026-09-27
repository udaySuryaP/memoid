import { authorize } from "@memoid/domain/authorization";
import type { ChangeProposalId, ChangeProposalItemId, ProjectId } from "@memoid/domain/identifiers";
import type { ReviewPolicyDecision, ReviewPolicyReasonCode } from "@memoid/domain/review-policy";
import type { ReviewPolicy } from "@memoid/domain/values";
import type { ProjectLifecycleState } from "@memoid/domain/workspace-project";
import type { WorkspaceProjectContext } from "./workspace-project.js";

export interface PolicyEvaluationView {
  readonly evaluationId: string;
  readonly proposalItemId: ChangeProposalItemId;
  readonly projectPolicyVersion: number;
  readonly projectPolicy: ReviewPolicy;
  readonly decision: ReviewPolicyDecision;
  readonly reasonCodes: readonly ReviewPolicyReasonCode[];
  readonly engineVersion: string;
  readonly basisHash: string;
  readonly current: boolean;
  readonly supersedesEvaluationId: string | null;
  readonly evaluatedAt: string;
}

export interface ProposalPolicyEvaluation {
  readonly proposalId: ChangeProposalId;
  readonly state: "NO_CURRENT_ITEMS" | "FULLY_AUTOMATIC_ELIGIBLE" | "MANUAL_REVIEW_REMAINS";
  readonly items: readonly PolicyEvaluationView[];
}

export interface ReviewPolicyRepository {
  findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null>;
  evaluateItem(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<PolicyEvaluationView>;
  evaluateProposal(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    proposalId: ChangeProposalId,
  ): Promise<ProposalPolicyEvaluation>;
  revalidateProject(context: WorkspaceProjectContext, projectId: ProjectId): Promise<number>;
  getCurrent(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<PolicyEvaluationView | null>;
  getHistory(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<readonly PolicyEvaluationView[]>;
  changeProjectPolicy(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    expectedVersion: number,
    policy: ReviewPolicy,
    effectiveAt?: Date,
  ): Promise<{ version: number; policy: ReviewPolicy; effectiveAt: string }>;
  close(): Promise<void>;
}

export class ReviewPolicyService {
  public constructor(private readonly repository: ReviewPolicyRepository) {}

  private async require(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    mode: "READ" | "EVALUATE" | "CONTROL",
  ): Promise<void> {
    const state = await this.repository.findProjectState(context, projectId);
    if (!state) throw new Error("REVIEW_POLICY_NOT_FOUND");
    const decision = authorize({
      principal: context.principal,
      actor: context.actor,
      capability:
        mode === "READ"
          ? "PROJECT_READ"
          : mode === "CONTROL"
            ? "PROJECT_CONTROL"
            : "PROJECT_MANAGE_CONTEXT",
      workspaceId: context.workspaceId,
      projectId,
      resourceState: state,
      freshAuthenticationRequired: mode === "CONTROL",
      ...(context.freshAuthenticationSatisfied === undefined
        ? {}
        : { freshAuthenticationSatisfied: context.freshAuthenticationSatisfied }),
      grants: [],
    });
    if (!decision.allowed)
      throw new Error(
        decision.reason === "RESOURCE_UNAVAILABLE"
          ? "REVIEW_POLICY_PROJECT_UNAVAILABLE"
          : "REVIEW_POLICY_DENIED",
      );
    if (
      mode === "EVALUATE" &&
      context.principal.kind !== "SYSTEM" &&
      context.principal.kind !== "WORKER"
    )
      throw new Error("REVIEW_POLICY_INTERNAL_OPERATION_REQUIRED");
    if (mode === "CONTROL" && context.principal.kind !== "HUMAN")
      throw new Error("REVIEW_POLICY_HUMAN_CONTROL_REQUIRED");
  }

  public async evaluateItem(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<PolicyEvaluationView> {
    await this.require(context, projectId, "EVALUATE");
    return this.repository.evaluateItem(context, projectId, itemId);
  }
  public async evaluateProposal(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    proposalId: ChangeProposalId,
  ): Promise<ProposalPolicyEvaluation> {
    await this.require(context, projectId, "EVALUATE");
    return this.repository.evaluateProposal(context, projectId, proposalId);
  }
  public async revalidateProject(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<number> {
    await this.require(context, projectId, "EVALUATE");
    return this.repository.revalidateProject(context, projectId);
  }
  public async getCurrent(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<PolicyEvaluationView | null> {
    await this.require(context, projectId, "READ");
    return this.repository.getCurrent(context, projectId, itemId);
  }
  public async getHistory(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<readonly PolicyEvaluationView[]> {
    await this.require(context, projectId, "READ");
    return this.repository.getHistory(context, projectId, itemId);
  }
  public async changeProjectPolicy(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    expectedVersion: number,
    policy: ReviewPolicy,
    effectiveAt?: Date,
  ) {
    await this.require(context, projectId, "CONTROL");
    return this.repository.changeProjectPolicy(
      context,
      projectId,
      expectedVersion,
      policy,
      effectiveAt,
    );
  }
}
