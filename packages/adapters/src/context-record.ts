import type {
  ContextRecordRepository,
  EndContextIdentityCommand,
  PutContextRecordCommand,
} from "@memoid/application/context-record";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import {
  parseContextOriginKind,
  sourceFreshness,
  type ContextLifecycleState,
  type ContextRecordView,
} from "@memoid/domain/context-record";
import {
  parseUuidV7,
  type ContextIdentityId,
  type ContextRecordId,
  type EvidenceReferenceId,
  type ProjectId,
  type SourceAuthorityAssignmentId,
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

export class PostgresContextRecordRepository implements ContextRecordRepository {
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

  public async listCurrent(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly ContextRecordView[]> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const rows = (
        await sql<{
          contextIdentityId: string;
          contextRecordId: string;
          subject: string;
          scope: string;
          facet: string;
          predicate: string;
          lifecycleState: ContextLifecycleState;
          identityVersion: string;
          recordVersion: string;
          payload: Record<string, unknown>;
          originKind: string;
          supersedesContextRecordId: string | null;
          evidenceReferenceId: string | null;
          sourceAuthorityAssignmentId: string | null;
          reviewedAt: Date;
          sourceBacked: boolean;
          sourceAvailable: boolean;
          authorityCurrent: boolean;
          defaultRefCurrent: boolean;
          coveredSequence: string | null;
          ingestedSequence: string | null;
        }>`select i.id::text as "contextIdentityId", r.id::text as "contextRecordId",
        i.subject_key as subject,i.scope_key as scope,i.facet_key as facet,i.predicate_key as predicate,
        i.lifecycle_state as "lifecycleState",i.version::text as "identityVersion",
        o.record_version::text as "recordVersion",r.assertion_payload as payload,o.origin_kind as "originKind",
        o.supersedes_context_record_id::text as "supersedesContextRecordId",
        ep.evidence_reference_id::text as "evidenceReferenceId",
        ep.source_authority_assignment_id::text as "sourceAuthorityAssignmentId",r.reviewed_at as "reviewedAt",
        ep.context_record_id is not null as "sourceBacked",
        coalesce(g.connection_state='ACTIVE',false) as "sourceAvailable",
        coalesce(resolved.assignment_id=ep.source_authority_assignment_id
          and resolved.qualification='EFFECTIVE',false) as "authorityCurrent",
        coalesce(s.ref_selector<>'DEFAULT_BRANCH' or (a.source_default_ref_snapshot='refs/heads/'||g.default_branch),false) as "defaultRefCurrent",
        ep.covered_observation_sequence::text as "coveredSequence",fs.ingested_sequence::text as "ingestedSequence"
      from memoid.context_identities i join memoid.context_identity_current_records h
        on h.workspace_id=i.workspace_id and h.project_id=i.project_id and h.context_identity_id=i.id
      join memoid.context_records r on r.workspace_id=h.workspace_id and r.project_id=h.project_id and r.id=h.context_record_id
      join memoid.context_record_origins o on o.workspace_id=r.workspace_id and o.project_id=r.project_id and o.context_record_id=r.id
      left join memoid.context_record_evidence_provenance ep on ep.workspace_id=r.workspace_id and ep.project_id=r.project_id and ep.context_record_id=r.id
      left join memoid.source_authority_assignments a on a.workspace_id=ep.workspace_id and a.project_id=ep.project_id and a.id=ep.source_authority_assignment_id
      left join memoid.source_authority_scopes s on s.workspace_id=a.workspace_id and s.project_id=a.project_id and s.id=a.authority_scope_id
      left join memoid.github_source_connections g on g.workspace_id=ep.workspace_id and g.project_id=ep.project_id and g.source_id=ep.source_id
      left join memoid.source_frontier_states fs on fs.workspace_id=ep.workspace_id and fs.project_id=ep.project_id and fs.frontier_unit_id=ep.frontier_unit_id
      left join lateral memoid.resolve_effective_source_authority(
        ep.workspace_id,ep.project_id,i.facet_key,ep.evidence_reference_id
      ) resolved on ep.context_record_id is not null
      where i.workspace_id=${context.workspaceId}::uuid and i.project_id=${projectId}::uuid
      order by i.subject_key,i.scope_key,i.facet_key,i.predicate_key`.execute(trx)
      ).rows;
      return rows.map((row) => ({
        contextIdentityId: parseUuidV7(
          row.contextIdentityId,
          "ContextIdentityId",
        ) as ContextIdentityId,
        contextRecordId: parseUuidV7(row.contextRecordId, "ContextRecordId") as ContextRecordId,
        subject: row.subject,
        scope: row.scope,
        facet: row.facet,
        predicate: row.predicate,
        lifecycleState: row.lifecycleState,
        identityVersion: Number(row.identityVersion),
        recordVersion: Number(row.recordVersion),
        payload: row.payload,
        originKind: parseContextOriginKind(row.originKind),
        supersedesContextRecordId: row.supersedesContextRecordId
          ? (parseUuidV7(row.supersedesContextRecordId, "ContextRecordId") as ContextRecordId)
          : null,
        evidenceReferenceId: row.evidenceReferenceId
          ? (parseUuidV7(row.evidenceReferenceId, "EvidenceReferenceId") as EvidenceReferenceId)
          : null,
        sourceAuthorityAssignmentId: row.sourceAuthorityAssignmentId
          ? (parseUuidV7(
              row.sourceAuthorityAssignmentId,
              "SourceAuthorityAssignmentId",
            ) as SourceAuthorityAssignmentId)
          : null,
        freshness: sourceFreshness({
          sourceBacked: row.sourceBacked,
          sourceAvailable: row.sourceAvailable,
          authorityCurrent: row.authorityCurrent,
          defaultRefCurrent: row.defaultRefCurrent,
          coveredObservationSequence:
            row.coveredSequence === null ? null : Number(row.coveredSequence),
          latestIngestedSequence:
            row.ingestedSequence === null ? null : Number(row.ingestedSequence),
        }),
        reviewedAt: row.reviewedAt.toISOString(),
      }));
    });
  }

  public async put(context: WorkspaceProjectContext, command: PutContextRecordCommand) {
    const row = await withSecurityTransaction(
      this.db,
      security(context, command.projectId),
      async (trx) =>
        (
          await sql<{
            contextIdentityId: string;
            contextRecordId: string;
            identityVersion: string;
            recordVersion: string;
            replayed: boolean;
          }>`select
        context_identity_id::text as "contextIdentityId",context_record_id::text as "contextRecordId",
        identity_version::text as "identityVersion",record_version::text as "recordVersion",replayed
        from memoid.put_context_record_v2(${Buffer.from(context.sessionCredentialHash)}::bytea,${command.projectId}::uuid,
        ${command.identity.subject}::varchar,${command.identity.scope}::varchar,${command.identity.facet}::varchar,${command.identity.predicate}::varchar,
        ${command.expectedIdentityVersion},${command.expectedCurrentRecordId ?? null}::uuid,${JSON.stringify(command.payload)}::jsonb,
        ${command.originKind}::varchar,${command.evidenceReferenceId ?? null}::uuid,${command.sourceAuthorityAssignmentId ?? null}::uuid,
        ${Buffer.from(command.idempotencyKeyHash)}::bytea,${Buffer.from(command.requestFingerprint)}::bytea,uuidv7(),null)`.execute(
            trx,
          )
        ).rows[0],
    );
    if (!row) throw new Error("Context mutation returned no result");
    return {
      contextIdentityId: parseUuidV7(
        row.contextIdentityId,
        "ContextIdentityId",
      ) as ContextIdentityId,
      contextRecordId: parseUuidV7(row.contextRecordId, "ContextRecordId") as ContextRecordId,
      identityVersion: Number(row.identityVersion),
      recordVersion: Number(row.recordVersion),
      replayed: row.replayed,
    };
  }

  public async end(context: WorkspaceProjectContext, command: EndContextIdentityCommand) {
    const row = await withSecurityTransaction(
      this.db,
      security(context, command.projectId),
      async (trx) =>
        (
          await sql<{
            contextIdentityId: string;
            identityVersion: string;
            replayed: boolean;
          }>`select context_identity_id::text as "contextIdentityId",
      identity_version::text as "identityVersion",replayed from memoid.end_context_identity(
      ${Buffer.from(context.sessionCredentialHash)}::bytea,${command.projectId}::uuid,${command.contextIdentityId}::uuid,
      ${command.expectedIdentityVersion},${command.expectedCurrentRecordId}::uuid,${command.reasonKey}::varchar,
      ${command.reasonNote ?? null}::varchar,${Buffer.from(command.idempotencyKeyHash)}::bytea,
      ${Buffer.from(command.requestFingerprint)}::bytea,uuidv7(),null)`.execute(trx)
        ).rows[0],
    );
    if (!row) throw new Error("Context ending returned no result");
    return {
      contextIdentityId: parseUuidV7(
        row.contextIdentityId,
        "ContextIdentityId",
      ) as ContextIdentityId,
      identityVersion: Number(row.identityVersion),
      replayed: row.replayed,
    };
  }
  public async close() {
    await this.db.destroy();
  }
}
