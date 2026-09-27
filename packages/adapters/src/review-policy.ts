import type {
  PolicyEvaluationView,
  ProposalPolicyEvaluation,
  ReviewPolicyRepository,
} from "@memoid/application/review-policy";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import type { ChangeProposalId, ChangeProposalItemId, ProjectId } from "@memoid/domain/identifiers";
import type { ReviewPolicyDecision, ReviewPolicyReasonCode } from "@memoid/domain/review-policy";
import type { ReviewPolicy } from "@memoid/domain/values";
import {
  parseProjectLifecycleState,
  type ProjectLifecycleState,
} from "@memoid/domain/workspace-project";
import { sql, type Kysely } from "kysely";

const security = (context: WorkspaceProjectContext, projectId: ProjectId) => ({
  accountId: context.accountId,
  workspaceId: context.workspaceId,
  projectId,
  actorId: context.actor.id,
});
interface EvaluationRow {
  evaluationId: string;
  proposalItemId: string;
  projectPolicyVersion: string;
  projectPolicy: ReviewPolicy;
  decision: ReviewPolicyDecision;
  reasonCodes: string[];
  engineVersion: string;
  basisHash: string;
  current: boolean;
  supersedesEvaluationId: string | null;
  evaluatedAt: Date;
}
const view = (row: EvaluationRow): PolicyEvaluationView => ({
  evaluationId: row.evaluationId,
  proposalItemId: row.proposalItemId as ChangeProposalItemId,
  projectPolicyVersion: Number(row.projectPolicyVersion),
  projectPolicy: row.projectPolicy,
  decision: row.decision,
  reasonCodes: row.reasonCodes as ReviewPolicyReasonCode[],
  engineVersion: row.engineVersion,
  basisHash: row.basisHash,
  current: row.current,
  supersedesEvaluationId: row.supersedesEvaluationId,
  evaluatedAt: row.evaluatedAt.toISOString(),
});
const projection = sql<EvaluationRow>`select evaluation.id::text "evaluationId",evaluation.proposal_item_id::text "proposalItemId",evaluation.project_policy_version::text "projectPolicyVersion",evaluation.project_policy "projectPolicy",evaluation.decision,evaluation.reason_codes "reasonCodes",evaluation.policy_engine_version "engineVersion",encode(evaluation.evaluated_basis_hash,'hex') "basisHash",memoid.review_policy_evaluation_is_current(evaluation.project_id,evaluation.id) current,evaluation.supersedes_evaluation_id::text "supersedesEvaluationId",evaluation.evaluated_at "evaluatedAt" from memoid.review_policy_evaluations evaluation`;

export class PostgresReviewPolicyRepository implements ReviewPolicyRepository {
  private readonly db: Kysely<MemoidDatabase>;
  public constructor(connectionString: string) {
    this.db = createDatabase(connectionString, 4);
  }
  public async findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const row = (
        await sql<{
          state: string;
        }>`select lifecycle_state state from memoid.projects where workspace_id=${context.workspaceId}::uuid and id=${projectId}::uuid`.execute(
          trx,
        )
      ).rows[0];
      return row ? parseProjectLifecycleState(row.state) : null;
    });
  }
  public async evaluateItem(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<PolicyEvaluationView> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const result = (
        await sql<{
          evaluationId: string;
        }>`select memoid.evaluate_proposal_item_review_policy(${projectId}::uuid,${itemId}::uuid)::text "evaluationId"`.execute(
          trx,
        )
      ).rows[0];
      if (!result) throw new Error("REVIEW_POLICY_EVALUATION_FAILED");
      const row = (
        await sql<EvaluationRow>`${projection} where evaluation.id=${result.evaluationId}::uuid`.execute(
          trx,
        )
      ).rows[0];
      if (!row) throw new Error("REVIEW_POLICY_EVALUATION_NOT_FOUND");
      return view(row);
    });
  }
  public async evaluateProposal(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    proposalId: ChangeProposalId,
  ): Promise<ProposalPolicyEvaluation> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      await sql`select memoid.evaluate_proposal_review_policy(${projectId}::uuid,${proposalId}::uuid)`.execute(
        trx,
      );
      const rows = (
        await sql<EvaluationRow>`${projection} join memoid.review_policy_current_states current_state on current_state.workspace_id=evaluation.workspace_id and current_state.project_id=evaluation.project_id and current_state.evaluation_id=evaluation.id join memoid.change_proposal_items item on item.workspace_id=evaluation.workspace_id and item.project_id=evaluation.project_id and item.id=evaluation.proposal_item_id where evaluation.project_id=${projectId}::uuid and item.proposal_id=${proposalId}::uuid order by item.created_at,item.id`.execute(
          trx,
        )
      ).rows.map(view);
      return {
        proposalId,
        state:
          rows.length === 0
            ? "NO_CURRENT_ITEMS"
            : rows.every((item) => item.decision === "AUTOMATIC_ELIGIBLE" && item.current)
              ? "FULLY_AUTOMATIC_ELIGIBLE"
              : "MANUAL_REVIEW_REMAINS",
        items: rows,
      };
    });
  }
  public async revalidateProject(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<number> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) =>
      Number(
        (
          await sql<{
            count: string;
          }>`select memoid.revalidate_project_review_policy(${projectId}::uuid)::text count`.execute(
            trx,
          )
        ).rows[0]?.count ?? 0,
      ),
    );
  }
  public async getCurrent(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<PolicyEvaluationView | null> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const row = (
        await sql<EvaluationRow>`${projection} join memoid.review_policy_current_states current_state on current_state.workspace_id=evaluation.workspace_id and current_state.project_id=evaluation.project_id and current_state.evaluation_id=evaluation.id where evaluation.project_id=${projectId}::uuid and evaluation.proposal_item_id=${itemId}::uuid`.execute(
          trx,
        )
      ).rows[0];
      return row ? view(row) : null;
    });
  }
  public async getHistory(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    itemId: ChangeProposalItemId,
  ): Promise<readonly PolicyEvaluationView[]> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) =>
      (
        await sql<EvaluationRow>`${projection} where evaluation.project_id=${projectId}::uuid and evaluation.proposal_item_id=${itemId}::uuid order by evaluation.evaluated_at desc,evaluation.id desc`.execute(
          trx,
        )
      ).rows.map(view),
    );
  }
  public async changeProjectPolicy(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    expectedVersion: number,
    policy: ReviewPolicy,
    effectiveAt?: Date,
  ) {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const row = (
        await sql<{
          version: string;
          policy: ReviewPolicy;
          effectiveAt: Date;
        }>`select version::text,policy,effective_at "effectiveAt" from memoid.change_project_review_policy(${projectId}::uuid,${expectedVersion},${policy}::varchar,${effectiveAt ?? null}::timestamptz)`.execute(
          trx,
        )
      ).rows[0];
      if (!row) throw new Error("REVIEW_POLICY_CHANGE_FAILED");
      return {
        version: Number(row.version),
        policy: row.policy,
        effectiveAt: row.effectiveAt.toISOString(),
      };
    });
  }
  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
