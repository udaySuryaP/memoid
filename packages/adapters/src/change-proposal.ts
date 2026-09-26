import type {
  ChangeProposalDetail,
  ChangeProposalRepository,
  ChangeProposalSummary,
} from "@memoid/application/change-proposal";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import type { ProposalItemLifecycleState } from "@memoid/domain/change-proposal";
import {
  parseUuidV7,
  type ChangeProposalId,
  type ChangeProposalItemId,
  type ContextIdentityId,
  type ContextRecordId,
  type EvidenceReferenceId,
  type ProjectId,
  type ReconciliationId,
  type WorkingContextItemId,
} from "@memoid/domain/identifiers";
import type { ReconciliationClass } from "@memoid/domain/reconciliation";
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

const proposalId = (value: string) => parseUuidV7(value, "ChangeProposalId") as ChangeProposalId;
const itemId = (value: string) =>
  parseUuidV7(value, "ChangeProposalItemId") as ChangeProposalItemId;

interface SummaryRow {
  proposalId: string;
  lifecycleState: "OPEN" | "STALE" | "SUPERSEDED";
  successorProposalId: string | null;
  groupingVersion: string;
  scopeKey: string;
  facetKey: string;
  currentItemCount: string;
  totalItemCount: string;
  createdAt: Date;
  changedAt: Date;
}

function summary(row: SummaryRow): ChangeProposalSummary {
  return {
    proposalId: proposalId(row.proposalId),
    lifecycleState: row.lifecycleState,
    successorProposalId: row.successorProposalId ? proposalId(row.successorProposalId) : null,
    groupingVersion: row.groupingVersion,
    scopeKey: row.scopeKey,
    facetKey: row.facetKey,
    currentItemCount: Number(row.currentItemCount),
    totalItemCount: Number(row.totalItemCount),
    createdAt: row.createdAt.toISOString(),
    changedAt: row.changedAt.toISOString(),
  };
}

export class PostgresChangeProposalRepository implements ChangeProposalRepository {
  private readonly db: Kysely<MemoidDatabase>;
  public constructor(connectionString: string) {
    this.db = createDatabase(connectionString, 4);
  }

  public async findProjectState(
    context: WorkspaceProjectContext,
    projectIdValue: ProjectId,
  ): Promise<ProjectLifecycleState | null> {
    return withSecurityTransaction(this.db, security(context, projectIdValue), async (trx) => {
      const row = (
        await sql<{
          state: string;
        }>`select lifecycle_state state from memoid.projects where workspace_id=${context.workspaceId}::uuid and id=${projectIdValue}::uuid`.execute(
          trx,
        )
      ).rows[0];
      return row ? parseProjectLifecycleState(row.state) : null;
    });
  }

  public async materialize(
    context: WorkspaceProjectContext,
    projectIdValue: ProjectId,
    reconciliationId: ReconciliationId,
  ) {
    return withSecurityTransaction(this.db, security(context, projectIdValue), async (trx) => {
      const row = (
        await sql<{
          proposalId: string;
          proposalItemId: string;
          replayed: boolean;
        }>`select proposal_id::text "proposalId",proposal_item_id::text "proposalItemId",replayed from memoid.materialize_change_proposal(${projectIdValue}::uuid,${reconciliationId}::uuid)`.execute(
          trx,
        )
      ).rows[0];
      return row
        ? {
            proposalId: proposalId(row.proposalId),
            proposalItemId: itemId(row.proposalItemId),
            replayed: row.replayed,
          }
        : null;
    });
  }

  public async refreshCurrentness(
    context: WorkspaceProjectContext,
    projectIdValue: ProjectId,
  ): Promise<number> {
    return withSecurityTransaction(this.db, security(context, projectIdValue), async (trx) => {
      const row = (
        await sql<{
          changed: string;
        }>`select memoid.refresh_change_proposal_backlog(${projectIdValue}::uuid)::text changed`.execute(
          trx,
        )
      ).rows[0];
      return Number(row?.changed ?? 0);
    });
  }

  public async listBacklog(
    context: WorkspaceProjectContext,
    projectIdValue: ProjectId,
    includeHistorical: boolean,
  ): Promise<readonly ChangeProposalSummary[]> {
    return withSecurityTransaction(this.db, security(context, projectIdValue), async (trx) => {
      const rows = (
        await sql<SummaryRow>`select proposal.id::text "proposalId",
          case when state.lifecycle_state='OPEN' and exists(
            select 1 from memoid.change_proposal_items stale_item
            join memoid.proposal_item_current_states stale_state on stale_state.workspace_id=stale_item.workspace_id and stale_state.project_id=stale_item.project_id and stale_state.proposal_item_id=stale_item.id
            where stale_item.workspace_id=proposal.workspace_id and stale_item.project_id=proposal.project_id and stale_item.proposal_id=proposal.id and stale_state.lifecycle_state='CURRENT'
              and not memoid.proposal_item_basis_is_current(proposal.project_id,stale_item.id)
          ) then 'STALE' else state.lifecycle_state end "lifecycleState",
          state.successor_proposal_id::text "successorProposalId",proposal.grouping_version "groupingVersion",
          proposal.scope_key "scopeKey",proposal.facet_key "facetKey",
          count(item.id) filter(where item_state.lifecycle_state='CURRENT')::text "currentItemCount",
          count(item.id)::text "totalItemCount",proposal.created_at "createdAt",state.changed_at "changedAt"
        from memoid.change_proposals proposal join memoid.proposal_current_states state
          on state.workspace_id=proposal.workspace_id and state.project_id=proposal.project_id and state.proposal_id=proposal.id
        join memoid.change_proposal_items item on item.workspace_id=proposal.workspace_id and item.project_id=proposal.project_id and item.proposal_id=proposal.id
        join memoid.proposal_item_current_states item_state on item_state.workspace_id=item.workspace_id and item_state.project_id=item.project_id and item_state.proposal_item_id=item.id
        where proposal.workspace_id=${context.workspaceId}::uuid and proposal.project_id=${projectIdValue}::uuid
          and (${includeHistorical}::boolean or state.lifecycle_state='OPEN')
        group by proposal.id,state.lifecycle_state,state.successor_proposal_id,state.changed_at
        order by case state.lifecycle_state when 'OPEN' then 0 when 'STALE' then 1 else 2 end,
          state.changed_at asc,proposal.created_at asc,proposal.id asc`.execute(trx)
      ).rows;
      return rows.map(summary).filter((row) => includeHistorical || row.lifecycleState === "OPEN");
    });
  }

  public async getProposal(
    context: WorkspaceProjectContext,
    projectIdValue: ProjectId,
    proposalIdValue: ChangeProposalId,
  ): Promise<ChangeProposalDetail | null> {
    return withSecurityTransaction(this.db, security(context, projectIdValue), async (trx) => {
      const header = (
        await sql<SummaryRow>`select proposal.id::text "proposalId",
          case when state.lifecycle_state='OPEN' and exists(select 1 from memoid.change_proposal_items stale_item join memoid.proposal_item_current_states stale_state on stale_state.workspace_id=stale_item.workspace_id and stale_state.project_id=stale_item.project_id and stale_state.proposal_item_id=stale_item.id where stale_item.workspace_id=proposal.workspace_id and stale_item.project_id=proposal.project_id and stale_item.proposal_id=proposal.id and stale_state.lifecycle_state='CURRENT' and not memoid.proposal_item_basis_is_current(proposal.project_id,stale_item.id)) then 'STALE' else state.lifecycle_state end "lifecycleState",
          state.successor_proposal_id::text "successorProposalId",proposal.grouping_version "groupingVersion",
          proposal.scope_key "scopeKey",proposal.facet_key "facetKey",
          count(item.id) filter(where item_state.lifecycle_state='CURRENT')::text "currentItemCount",
          count(item.id)::text "totalItemCount",proposal.created_at "createdAt",state.changed_at "changedAt"
        from memoid.change_proposals proposal join memoid.proposal_current_states state on state.workspace_id=proposal.workspace_id and state.project_id=proposal.project_id and state.proposal_id=proposal.id
        join memoid.change_proposal_items item on item.workspace_id=proposal.workspace_id and item.project_id=proposal.project_id and item.proposal_id=proposal.id
        join memoid.proposal_item_current_states item_state on item_state.workspace_id=item.workspace_id and item_state.project_id=item.project_id and item_state.proposal_item_id=item.id
        where proposal.workspace_id=${context.workspaceId}::uuid and proposal.project_id=${projectIdValue}::uuid and proposal.id=${proposalIdValue}::uuid
        group by proposal.id,state.lifecycle_state,state.successor_proposal_id,state.changed_at`.execute(
          trx,
        )
      ).rows[0];
      if (!header) return null;
      const items = (
        await sql<{
          proposalItemId: string;
          reconciliationId: string;
          contextIdentityId: string;
          classification: ReconciliationClass;
          normalizedAssertion: Record<string, unknown>;
          currentContextRecordId: string | null;
          workingContextItemId: string;
          evidenceReferenceIds: unknown;
          conflictQualified: boolean;
          uncertaintyQualified: boolean;
          destructive: boolean;
          lifecycleState: ProposalItemLifecycleState;
          successorItemId: string | null;
        }>`select item.id::text "proposalItemId",item.reconciliation_id::text "reconciliationId",
          item.context_identity_id::text "contextIdentityId",item.reconciliation_class classification,
          item.normalized_assertion "normalizedAssertion",item.current_context_record_id::text "currentContextRecordId",
          item.working_context_item_id::text "workingContextItemId",item.evidence_reference_ids "evidenceReferenceIds",
          item.conflict_qualified "conflictQualified",item.uncertainty_qualified "uncertaintyQualified",
          item.destructive,case when state.lifecycle_state='CURRENT' and not memoid.proposal_item_basis_is_current(item.project_id,item.id) then 'STALE' else state.lifecycle_state end "lifecycleState",state.successor_item_id::text "successorItemId"
        from memoid.change_proposal_items item join memoid.proposal_item_current_states state on state.workspace_id=item.workspace_id and state.project_id=item.project_id and state.proposal_item_id=item.id
        where item.workspace_id=${context.workspaceId}::uuid and item.project_id=${projectIdValue}::uuid and item.proposal_id=${proposalIdValue}::uuid
        order by item.created_at,item.id`.execute(trx)
      ).rows;
      const lineage = (
        await sql<{
          proposalId: string;
          successorProposalId: string | null;
          state: string;
          reason: string;
          occurredAt: Date;
        }>`select proposal_id::text "proposalId",successor_proposal_id::text "successorProposalId",to_state state,reason,occurred_at "occurredAt" from memoid.proposal_state_events where workspace_id=${context.workspaceId}::uuid and project_id=${projectIdValue}::uuid and target_kind='PROPOSAL' and (proposal_id=${proposalIdValue}::uuid or successor_proposal_id=${proposalIdValue}::uuid) order by occurred_at,id`.execute(
          trx,
        )
      ).rows;
      return {
        ...summary(header),
        items: items.map((row) => ({
          proposalItemId: itemId(row.proposalItemId),
          proposalId: proposalIdValue,
          projectId: projectIdValue,
          reconciliationId: parseUuidV7(
            row.reconciliationId,
            "ReconciliationId",
          ) as ReconciliationId,
          contextIdentityId: parseUuidV7(
            row.contextIdentityId,
            "ContextIdentityId",
          ) as ContextIdentityId,
          classification: row.classification,
          normalizedAssertion: row.normalizedAssertion,
          currentContextRecordId: row.currentContextRecordId
            ? (parseUuidV7(row.currentContextRecordId, "ContextRecordId") as ContextRecordId)
            : null,
          workingContextItemId: parseUuidV7(
            row.workingContextItemId,
            "WorkingContextItemId",
          ) as WorkingContextItemId,
          evidenceReferenceIds: (Array.isArray(row.evidenceReferenceIds)
            ? row.evidenceReferenceIds
            : []
          ).map(
            (value) => parseUuidV7(String(value), "EvidenceReferenceId") as EvidenceReferenceId,
          ),
          conflictQualified: row.conflictQualified,
          uncertaintyQualified: row.uncertaintyQualified,
          destructive: row.destructive,
          lifecycleState: row.lifecycleState,
          successorItemId: row.successorItemId ? itemId(row.successorItemId) : null,
        })),
        lineage: lineage.map((row) => ({
          proposalId: proposalId(row.proposalId),
          successorProposalId: row.successorProposalId ? proposalId(row.successorProposalId) : null,
          state: row.state,
          reason: row.reason,
          occurredAt: row.occurredAt.toISOString(),
        })),
      };
    });
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
