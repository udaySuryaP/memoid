import type {
  ConflictParticipantView,
  ConflictUncertaintyRepository,
  ConflictView,
  EndConflictCommand,
  EndUncertaintyCommand,
  EstablishConflictCommand,
  EstablishUncertaintyCommand,
  UncertaintyView,
} from "@memoid/application/conflict-uncertainty";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import type {
  ConflictEndReason,
  ConflictParticipantReference,
  IntegrityLifecycleState,
  UncertaintyEndReason,
  UncertaintyReason,
  UncertaintyTargetReference,
} from "@memoid/domain/conflict-uncertainty";
import {
  parseUuidV7,
  type ConflictId,
  type ConflictOccurrenceId,
  type ContextIdentityId,
  type ContextRecordId,
  type ContextRevisionId,
  type EvidenceReferenceId,
  type ProjectId,
  type SourceAuthorityAssignmentId,
  type SourceId,
  type UncertaintyId,
  type UncertaintyOccurrenceId,
  type WorkingContextItemId,
} from "@memoid/domain/identifiers";
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

function participantPayload(participant: ConflictParticipantReference) {
  switch (participant.kind) {
    case "SOURCE_EVIDENCE":
      return { kind: participant.kind, referenceId: participant.evidenceReferenceId };
    case "WORKING_CONTEXT":
      return { kind: participant.kind, referenceId: participant.workingContextItemId };
    case "REVIEWED_CONTEXT":
      return { kind: participant.kind, referenceId: participant.contextRecordId };
  }
}

function targetPayload(target: UncertaintyTargetReference): { kind: string; referenceId: string } {
  switch (target.kind) {
    case "SEMANTIC_IDENTITY":
      return { kind: target.kind, referenceId: target.contextIdentityId };
    case "SOURCE_EVIDENCE":
      return { kind: target.kind, referenceId: target.evidenceReferenceId };
    case "WORKING_CONTEXT":
      return { kind: target.kind, referenceId: target.workingContextItemId };
    case "REVIEWED_CONTEXT":
      return { kind: target.kind, referenceId: target.contextRecordId };
  }
}

export class PostgresConflictUncertaintyRepository implements ConflictUncertaintyRepository {
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
        await sql<{ state: string }>`select lifecycle_state as state from memoid.projects
          where workspace_id=${context.workspaceId}::uuid and id=${projectId}::uuid`.execute(trx)
      ).rows[0];
      return row ? parseProjectLifecycleState(row.state) : null;
    });
  }

  public async listConflicts(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    activeOnly: boolean,
  ): Promise<readonly ConflictView[]> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const rows = (
        await sql<{
          conflictId: string;
          occurrenceId: string;
          contextIdentityId: string;
          version: string;
          lifecycleState: IntegrityLifecycleState;
          classification: "MATERIAL_CONTRADICTION";
          endingReason: ConflictEndReason | null;
          resolvedRevisionId: string | null;
          occurredAt: Date;
          participants: Array<{
            ordinal: number;
            kind: "SOURCE_EVIDENCE" | "WORKING_CONTEXT" | "REVIEWED_CONTEXT";
            evidenceReferenceId: string | null;
            workingContextItemId: string | null;
            contextRecordId: string | null;
            sourceId: string | null;
            authorityAssignmentId: string | null;
            sourceQualification: string | null;
          }>;
        }>`select c.id::text as "conflictId",o.id::text as "occurrenceId",
          c.context_identity_id::text as "contextIdentityId",s.occurrence_version::text as version,
          s.lifecycle_state as "lifecycleState",o.classification_key as classification,
          o.ending_reason as "endingReason",
          o.resolved_by_context_revision_id::text as "resolvedRevisionId",o.occurred_at as "occurredAt",
          jsonb_agg(jsonb_build_object('ordinal',p.participant_ordinal,'kind',p.participant_kind,
            'evidenceReferenceId',p.evidence_reference_id::text,
            'workingContextItemId',p.working_context_item_id::text,
            'contextRecordId',p.context_record_id::text,'sourceId',p.source_id::text,
            'authorityAssignmentId',p.effective_authority_assignment_id::text,
            'sourceQualification',p.source_qualification) order by p.participant_ordinal) as participants
        from memoid.integrity_conflicts c join memoid.conflict_current_states s
          on s.workspace_id=c.workspace_id and s.project_id=c.project_id and s.conflict_id=c.id
        join memoid.conflict_occurrences o on o.workspace_id=s.workspace_id and o.project_id=s.project_id
          and o.conflict_id=s.conflict_id and o.id=s.current_occurrence_id
        join memoid.conflict_participants p on p.workspace_id=o.workspace_id and p.project_id=o.project_id
          and p.conflict_id=o.conflict_id and p.conflict_occurrence_id=o.id
        where c.workspace_id=${context.workspaceId}::uuid and c.project_id=${projectId}::uuid
          and (${activeOnly}::boolean=false or s.lifecycle_state='ACTIVE')
        group by c.id,o.id,c.context_identity_id,s.occurrence_version,s.lifecycle_state,
          o.classification_key,o.ending_reason,o.resolved_by_context_revision_id,o.occurred_at
        order by o.occurred_at desc`.execute(trx)
      ).rows;
      return rows.map((row) => ({
        conflictId: parseUuidV7(row.conflictId, "ConflictId") as ConflictId,
        occurrenceId: parseUuidV7(row.occurrenceId, "ConflictOccurrenceId") as ConflictOccurrenceId,
        contextIdentityId: parseUuidV7(
          row.contextIdentityId,
          "ContextIdentityId",
        ) as ContextIdentityId,
        version: Number(row.version),
        lifecycleState: row.lifecycleState,
        classification: row.classification,
        endingReason: row.endingReason,
        resolvedByContextRevisionId: row.resolvedRevisionId
          ? (parseUuidV7(row.resolvedRevisionId, "ContextRevisionId") as ContextRevisionId)
          : null,
        participants: row.participants.map((participant): ConflictParticipantView => {
          const common = {
            ordinal: participant.ordinal,
            ...(participant.sourceId
              ? { sourceId: parseUuidV7(participant.sourceId, "SourceId") as SourceId }
              : {}),
            ...(participant.authorityAssignmentId
              ? {
                  effectiveAuthorityAssignmentId: parseUuidV7(
                    participant.authorityAssignmentId,
                    "SourceAuthorityAssignmentId",
                  ) as SourceAuthorityAssignmentId,
                }
              : {}),
            ...(participant.sourceQualification
              ? { sourceQualification: participant.sourceQualification }
              : {}),
          };
          if (participant.kind === "SOURCE_EVIDENCE")
            return {
              ...common,
              kind: participant.kind,
              evidenceReferenceId: parseUuidV7(
                participant.evidenceReferenceId!,
                "EvidenceReferenceId",
              ) as EvidenceReferenceId,
            };
          if (participant.kind === "WORKING_CONTEXT")
            return {
              ...common,
              kind: participant.kind,
              workingContextItemId: parseUuidV7(
                participant.workingContextItemId!,
                "WorkingContextItemId",
              ) as WorkingContextItemId,
            };
          return {
            ...common,
            kind: participant.kind,
            contextRecordId: parseUuidV7(
              participant.contextRecordId!,
              "ContextRecordId",
            ) as ContextRecordId,
          };
        }),
        occurredAt: row.occurredAt.toISOString(),
      }));
    });
  }

  public async listUncertainties(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    activeOnly: boolean,
  ): Promise<readonly UncertaintyView[]> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const rows = (
        await sql<{
          uncertaintyId: string;
          occurrenceId: string;
          contextIdentityId: string;
          version: string;
          lifecycleState: IntegrityLifecycleState;
          targetKind: UncertaintyTargetReference["kind"];
          evidenceReferenceId: string | null;
          workingContextItemId: string | null;
          contextRecordId: string | null;
          reason: UncertaintyReason | null;
          endingReason: UncertaintyEndReason | null;
          basisEvidenceReferenceId: string | null;
          sourceQualification: string | null;
          resolvedRevisionId: string | null;
          occurredAt: Date;
        }>`select u.id::text as "uncertaintyId",o.id::text as "occurrenceId",
          u.context_identity_id::text as "contextIdentityId",s.occurrence_version::text as version,
          s.lifecycle_state as "lifecycleState",u.target_kind as "targetKind",
          u.evidence_reference_id::text as "evidenceReferenceId",
          u.working_context_item_id::text as "workingContextItemId",
          u.context_record_id::text as "contextRecordId",o.reason_key as reason,
          o.ending_reason as "endingReason",o.basis_evidence_reference_id::text as "basisEvidenceReferenceId",
          o.source_qualification as "sourceQualification",
          o.resolved_by_context_revision_id::text as "resolvedRevisionId",o.occurred_at as "occurredAt"
        from memoid.integrity_uncertainties u join memoid.uncertainty_current_states s
          on s.workspace_id=u.workspace_id and s.project_id=u.project_id and s.uncertainty_id=u.id
        join memoid.uncertainty_occurrences o on o.workspace_id=s.workspace_id and o.project_id=s.project_id
          and o.uncertainty_id=s.uncertainty_id and o.id=s.current_occurrence_id
        where u.workspace_id=${context.workspaceId}::uuid and u.project_id=${projectId}::uuid
          and (${activeOnly}::boolean=false or s.lifecycle_state='ACTIVE')
        order by o.occurred_at desc`.execute(trx)
      ).rows;
      return rows.map((row) => {
        const contextIdentityId = parseUuidV7(
          row.contextIdentityId,
          "ContextIdentityId",
        ) as ContextIdentityId;
        let target: UncertaintyTargetReference;
        if (row.targetKind === "SEMANTIC_IDENTITY")
          target = { kind: row.targetKind, contextIdentityId };
        else if (row.targetKind === "SOURCE_EVIDENCE")
          target = {
            kind: row.targetKind,
            evidenceReferenceId: parseUuidV7(
              row.evidenceReferenceId!,
              "EvidenceReferenceId",
            ) as EvidenceReferenceId,
          };
        else if (row.targetKind === "WORKING_CONTEXT")
          target = {
            kind: row.targetKind,
            workingContextItemId: parseUuidV7(
              row.workingContextItemId!,
              "WorkingContextItemId",
            ) as WorkingContextItemId,
          };
        else
          target = {
            kind: row.targetKind,
            contextRecordId: parseUuidV7(
              row.contextRecordId!,
              "ContextRecordId",
            ) as ContextRecordId,
          };
        return {
          uncertaintyId: parseUuidV7(row.uncertaintyId, "UncertaintyId") as UncertaintyId,
          occurrenceId: parseUuidV7(
            row.occurrenceId,
            "UncertaintyOccurrenceId",
          ) as UncertaintyOccurrenceId,
          contextIdentityId,
          version: Number(row.version),
          lifecycleState: row.lifecycleState,
          target,
          reason: row.reason,
          endingReason: row.endingReason,
          basisEvidenceReferenceId: row.basisEvidenceReferenceId
            ? (parseUuidV7(
                row.basisEvidenceReferenceId,
                "EvidenceReferenceId",
              ) as EvidenceReferenceId)
            : null,
          sourceQualification: row.sourceQualification,
          resolvedByContextRevisionId: row.resolvedRevisionId
            ? (parseUuidV7(row.resolvedRevisionId, "ContextRevisionId") as ContextRevisionId)
            : null,
          occurredAt: row.occurredAt.toISOString(),
        };
      });
    });
  }

  public async recordConflict(
    context: WorkspaceProjectContext,
    command:
      | (EstablishConflictCommand & { readonly lifecycleState: "ACTIVE" })
      | (EndConflictCommand & { readonly lifecycleState: "ENDED" }),
  ) {
    const active = command.lifecycleState === "ACTIVE";
    const row = await withSecurityTransaction(
      this.db,
      security(context, command.projectId),
      async (trx) =>
        (
          await sql<{
            conflictId: string;
            occurrenceId: string;
            version: string;
            replayed: boolean;
          }>`select
          conflict_id::text as "conflictId",occurrence_id::text as "occurrenceId",
          occurrence_version::text as version,replayed from memoid.record_conflict_state(
          ${Buffer.from(context.sessionCredentialHash)}::bytea,${command.projectId}::uuid,
          ${active ? command.contextIdentityId : null}::uuid,${active ? null : command.conflictId}::uuid,
          ${command.expectedVersion},${command.lifecycleState}::varchar,
          ${active ? command.classification : null}::varchar,
          ${active ? JSON.stringify(command.participants.map(participantPayload)) : null}::jsonb,
          ${active ? null : command.reason}::varchar,
          ${active ? null : (command.resolvedByContextRevisionId ?? null)}::uuid,
          ${Buffer.from(command.idempotencyKeyHash)}::bytea,${Buffer.from(command.requestFingerprint)}::bytea,
          uuidv7(),null)`.execute(trx)
        ).rows[0],
    );
    if (!row) throw new Error("Conflict mutation returned no result");
    return {
      conflictId: parseUuidV7(row.conflictId, "ConflictId") as ConflictId,
      occurrenceId: parseUuidV7(row.occurrenceId, "ConflictOccurrenceId") as ConflictOccurrenceId,
      version: Number(row.version),
      replayed: row.replayed,
    };
  }

  public async recordUncertainty(
    context: WorkspaceProjectContext,
    command:
      | (EstablishUncertaintyCommand & { readonly lifecycleState: "ACTIVE" })
      | (EndUncertaintyCommand & { readonly lifecycleState: "ENDED" }),
  ) {
    const active = command.lifecycleState === "ACTIVE";
    const target = active ? targetPayload(command.target) : null;
    const row = await withSecurityTransaction(
      this.db,
      security(context, command.projectId),
      async (trx) =>
        (
          await sql<{
            uncertaintyId: string;
            occurrenceId: string;
            version: string;
            replayed: boolean;
          }>`select
          uncertainty_id::text as "uncertaintyId",occurrence_id::text as "occurrenceId",
          occurrence_version::text as version,replayed from memoid.record_uncertainty_state(
          ${Buffer.from(context.sessionCredentialHash)}::bytea,${command.projectId}::uuid,
          ${active ? command.contextIdentityId : null}::uuid,${active ? null : command.uncertaintyId}::uuid,
          ${command.expectedVersion},${command.lifecycleState}::varchar,${target?.kind ?? null}::varchar,
          ${target?.referenceId ?? null}::uuid,${active ? command.reason : null}::varchar,
          ${active ? (command.basisEvidenceReferenceId ?? null) : null}::uuid,
          ${active ? null : command.reason}::varchar,
          ${active ? null : (command.resolvedByContextRevisionId ?? null)}::uuid,
          ${Buffer.from(command.idempotencyKeyHash)}::bytea,${Buffer.from(command.requestFingerprint)}::bytea,
          uuidv7(),null)`.execute(trx)
        ).rows[0],
    );
    if (!row) throw new Error("Uncertainty mutation returned no result");
    return {
      uncertaintyId: parseUuidV7(row.uncertaintyId, "UncertaintyId") as UncertaintyId,
      occurrenceId: parseUuidV7(
        row.occurrenceId,
        "UncertaintyOccurrenceId",
      ) as UncertaintyOccurrenceId,
      version: Number(row.version),
      replayed: row.replayed,
    };
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
