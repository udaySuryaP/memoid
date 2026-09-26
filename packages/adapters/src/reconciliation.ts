import { createHash } from "node:crypto";
import type {
  ReconciliationRepository,
  ReconciliationMaterial,
} from "@memoid/application/reconciliation";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import {
  parseUuidV7,
  type CandidateAssertionId,
  type ContextIdentityId,
  type ContextRecordId,
  type EvidenceReferenceId,
  type ProjectId,
  type SourceId,
  type WorkingContextItemId,
} from "@memoid/domain/identifiers";
import {
  type ModelInvocationAccounting,
  type ReconciliationBasis,
  type ReconciliationResult,
} from "@memoid/domain/reconciliation";
import type { AuthorityQualification } from "@memoid/domain/source-authority";
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
const basisHash = (basis: ReconciliationBasis) =>
  createHash("sha256").update(JSON.stringify(basis)).digest();

export class PostgresReconciliationRepository implements ReconciliationRepository {
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

  public async loadMaterial(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    candidateAssertionId: string,
  ): Promise<ReconciliationMaterial> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const row = (
        await sql<{
          candidateId: string;
          candidateSubmissionId: string;
          contextIdentityId: string;
          origin: string;
          candidate: Record<string, unknown>;
          candidateHash: string;
          subject: string;
          scope: string;
          facet: string;
          predicate: string;
          identityVersion: string;
          currentRecordId: string | null;
          currentPayload: Record<string, unknown> | null;
          currentHash: string | null;
          duplicate: boolean;
          workingVersion: string;
          authorityVersion: string;
          frontierVersion: string;
          integrityVersion: string;
          activeConflict: boolean;
          activeUncertainty: boolean;
        }>`with candidate_identity as (
          select min(w.context_identity_id::text)::uuid context_identity_id
          from memoid.working_context_items w
          where w.workspace_id=${context.workspaceId}::uuid and w.project_id=${projectId}::uuid
            and w.candidate_assertion_id=${candidateAssertionId}::uuid
            and w.context_identity_id is not null
          having count(distinct w.context_identity_id)=1
        )
        select a.id::text "candidateId",a.candidate_submission_id::text "candidateSubmissionId",
          i.id::text "contextIdentityId",a.origin_kind origin,a.assertion_payload candidate,
          encode(a.assertion_hash,'hex') "candidateHash",i.subject_key subject,i.scope_key scope,
          i.facet_key facet,i.predicate_key predicate,i.version::text "identityVersion",
          current_state.context_record_id::text "currentRecordId",r.assertion_payload "currentPayload",
          encode(r.assertion_hash,'hex') "currentHash",
          exists(select 1 from memoid.candidate_assertions duplicate
            join memoid.working_context_items duplicate_working
              on duplicate_working.workspace_id=duplicate.workspace_id
              and duplicate_working.project_id=duplicate.project_id
              and duplicate_working.candidate_assertion_id=duplicate.id
            where duplicate.workspace_id=a.workspace_id and duplicate.project_id=a.project_id
              and duplicate.id<>a.id and duplicate.assertion_hash=a.assertion_hash
              and duplicate_working.context_identity_id=i.id) duplicate,
          coalesce((select floor(extract(epoch from max(coalesce(wc.reconciled_at,wc.recorded_at)))*1000000)::bigint::text
            from memoid.working_context_items wc where wc.workspace_id=a.workspace_id
              and wc.project_id=a.project_id and wc.context_identity_id=i.id),'0') "workingVersion",
          coalesce((select sum(authority_scope.version)::text from memoid.source_authority_scopes authority_scope
            where authority_scope.workspace_id=a.workspace_id and authority_scope.project_id=a.project_id),'0') "authorityVersion",
          coalesce((select sum(coalesce(fs.observed_sequence,0)+coalesce(fs.desired_sequence,0)
              +coalesce(fs.ingested_sequence,0)+coalesce(fs.reconciled_sequence,0))::text
            from memoid.source_frontier_states fs where fs.workspace_id=a.workspace_id
              and fs.project_id=a.project_id),'0') "frontierVersion",
          (coalesce((select sum(cs.occurrence_version) from memoid.integrity_conflicts c
              join memoid.conflict_current_states cs on cs.workspace_id=c.workspace_id
                and cs.project_id=c.project_id and cs.conflict_id=c.id
              where c.workspace_id=a.workspace_id and c.project_id=a.project_id
                and c.context_identity_id=i.id),0)
            +coalesce((select sum(us.occurrence_version) from memoid.integrity_uncertainties u
              join memoid.uncertainty_current_states us on us.workspace_id=u.workspace_id
                and us.project_id=u.project_id and us.uncertainty_id=u.id
              where u.workspace_id=a.workspace_id and u.project_id=a.project_id
                and u.context_identity_id=i.id),0))::text "integrityVersion",
          exists(select 1 from memoid.integrity_conflicts c
            join memoid.conflict_current_states cs on cs.workspace_id=c.workspace_id
              and cs.project_id=c.project_id and cs.conflict_id=c.id
            where c.workspace_id=a.workspace_id and c.project_id=a.project_id
              and c.context_identity_id=i.id and cs.lifecycle_state='ACTIVE') "activeConflict",
          exists(select 1 from memoid.integrity_uncertainties u
            join memoid.uncertainty_current_states us on us.workspace_id=u.workspace_id
              and us.project_id=u.project_id and us.uncertainty_id=u.id
            where u.workspace_id=a.workspace_id and u.project_id=a.project_id
              and u.context_identity_id=i.id and us.lifecycle_state='ACTIVE') "activeUncertainty"
        from memoid.candidate_assertions a join candidate_identity selected on true
        join memoid.context_identities i on i.workspace_id=a.workspace_id and i.project_id=a.project_id
          and i.id=selected.context_identity_id and i.lifecycle_state='ACTIVE'
        left join memoid.context_identity_current_records current_state on current_state.workspace_id=i.workspace_id
          and current_state.project_id=i.project_id and current_state.context_identity_id=i.id
        left join memoid.context_records r on r.workspace_id=current_state.workspace_id
          and r.project_id=current_state.project_id and r.id=current_state.context_record_id
        where a.workspace_id=${context.workspaceId}::uuid and a.project_id=${projectId}::uuid
          and a.id=${candidateAssertionId}::uuid`.execute(trx)
      ).rows[0];
      if (!row) throw new Error("RECONCILIATION_CANDIDATE_OR_IDENTITY_NOT_FOUND");
      const sourceDerived = row.origin === "SOURCE_DERIVED";
      const evidenceRows = (
        await sql<{
          referenceId: string;
          sourceId: string;
          sourceObservationId: string;
          evidenceKind: string;
          repositoryRevision: string;
          repositoryPath: string;
          previousRepositoryPath: string | null;
          providerObjectId: string | null;
          byteSize: string | null;
          contentHash: string | null;
          structuralLocator: string | null;
          observationSequence: string;
          resolvedSourceId: string | null;
          qualification: AuthorityQualification;
        }>`with basis_items as (
          select distinct case
            when jsonb_typeof(item)='string' then item #>> '{}'
            when jsonb_typeof(item)='object' then coalesce(item->>'evidenceReferenceId',item->>'evidence_reference_id')
            else null end reference_id
          from memoid.candidate_submissions submission
          cross join lateral jsonb_array_elements(submission.source_frontier_basis) item
          where submission.workspace_id=${context.workspaceId}::uuid
            and submission.project_id=${projectId}::uuid
            and submission.id=${row.candidateSubmissionId}::uuid
        )
        select evidence.id::text "referenceId",evidence.source_id::text "sourceId",
          evidence.source_observation_id::text "sourceObservationId",evidence.evidence_kind "evidenceKind",
          evidence.repository_revision "repositoryRevision",evidence.repository_path "repositoryPath",
          evidence.previous_repository_path "previousRepositoryPath",
          evidence.provider_object_id "providerObjectId",evidence.byte_size::text "byteSize",
          encode(evidence.content_sha256,'hex') "contentHash",evidence.structural_locator "structuralLocator",
          evidence.observation_sequence::text "observationSequence",resolved.source_id::text "resolvedSourceId",
          resolved.qualification
        from basis_items basis join memoid.evidence_references evidence
          on evidence.workspace_id=${context.workspaceId}::uuid and evidence.project_id=${projectId}::uuid
            and evidence.id::text=basis.reference_id
        left join lateral memoid.resolve_effective_source_authority(
          evidence.workspace_id,evidence.project_id,${row.facet},evidence.id
        ) resolved on true
        order by evidence.id limit 64`.execute(trx)
      ).rows;
      const evidence = evidenceRows.map((item) => {
        const authorityQualification: AuthorityQualification | "SHADOWED" =
          item.qualification === "EFFECTIVE" && item.resolvedSourceId !== item.sourceId
            ? "SHADOWED"
            : item.qualification;
        return {
          evidenceReferenceId: parseUuidV7(
            item.referenceId,
            "EvidenceReferenceId",
          ) as EvidenceReferenceId,
          sourceId: parseUuidV7(item.sourceId, "SourceId") as SourceId,
          contentClassification: "PUBLIC_PROJECT_TEXT" as const,
          content: JSON.stringify({
            evidenceKind: item.evidenceKind,
            repositoryRevision: item.repositoryRevision,
            repositoryPath: item.repositoryPath,
            previousRepositoryPath: item.previousRepositoryPath,
            providerObjectId: item.providerObjectId,
            byteSize: item.byteSize === null ? null : Number(item.byteSize),
            contentSha256: item.contentHash,
            structuralLocator: item.structuralLocator,
            sourceObservationId: item.sourceObservationId,
            observationSequence: Number(item.observationSequence),
          }),
          authorityQualification,
        };
      });
      const disqualified = evidence.find((item) => item.authorityQualification !== "EFFECTIVE");
      const authorityQualification: AuthorityQualification | "SHADOWED" =
        evidence.length === 0 ? "MISSING" : (disqualified?.authorityQualification ?? "EFFECTIVE");
      const workingContext = (
        await sql<{
          payload: Record<string, unknown>;
          candidateId: string;
          trust: string;
          recordedAt: Date;
          reconciledAt: Date | null;
        }>`
          select selected.payload,selected."candidateId",selected.trust,
            selected."recordedAt",selected."reconciledAt"
          from (select distinct on (wc.candidate_assertion_id) wc.assertion_payload payload,
              wc.candidate_assertion_id::text "candidateId",wc.trust_qualification trust,
              wc.recorded_at "recordedAt",wc.reconciled_at "reconciledAt",wc.id
            from memoid.working_context_items wc
            where wc.workspace_id=${context.workspaceId}::uuid and wc.project_id=${projectId}::uuid
              and wc.context_identity_id=${row.contextIdentityId}::uuid
              and wc.candidate_assertion_id<>${row.candidateId}::uuid
            order by wc.candidate_assertion_id,coalesce(wc.reconciled_at,wc.recorded_at) desc,wc.id desc
          ) selected
          order by coalesce(selected."reconciledAt",selected."recordedAt") desc,selected.id desc
          limit 64`.execute(trx)
      ).rows
        .sort(
          (left, right) =>
            (right.reconciledAt ?? right.recordedAt).getTime() -
            (left.reconciledAt ?? left.recordedAt).getTime(),
        )
        .map((item) => ({
          candidateAssertionId: item.candidateId,
          trustQualification: item.trust,
          recordedAt: item.recordedAt.toISOString(),
          reconciledAt: item.reconciledAt?.toISOString() ?? null,
          assertion: item.payload,
        }));
      const currentIsKnownHistorical = row.currentRecordId
        ? (
            await sql<{ known: boolean }>`with recursive history(record_id) as (
              select origin.supersedes_context_record_id
              from memoid.context_record_origins origin
              where origin.workspace_id=${context.workspaceId}::uuid and origin.project_id=${projectId}::uuid
                and origin.context_identity_id=${row.contextIdentityId}::uuid
                and origin.context_record_id=${row.currentRecordId}::uuid
              union all
              select predecessor.supersedes_context_record_id
              from memoid.context_record_origins predecessor join history
                on predecessor.context_record_id=history.record_id
              where predecessor.workspace_id=${context.workspaceId}::uuid
                and predecessor.project_id=${projectId}::uuid
                and predecessor.context_identity_id=${row.contextIdentityId}::uuid
                and history.record_id is not null
            )
            select exists(select 1 from history join memoid.context_records historical
              on historical.workspace_id=${context.workspaceId}::uuid and historical.project_id=${projectId}::uuid
                and historical.context_identity_id=${row.contextIdentityId}::uuid
                and historical.id=history.record_id
              where historical.assertion_hash=decode(${row.candidateHash},'hex')) known`.execute(
              trx,
            )
          ).rows[0]?.known === true
        : false;
      const basis: ReconciliationBasis = {
        projectId,
        candidateAssertionId: parseUuidV7(
          row.candidateId,
          "CandidateAssertionId",
        ) as CandidateAssertionId,
        contextIdentityId: parseUuidV7(
          row.contextIdentityId,
          "ContextIdentityId",
        ) as ContextIdentityId,
        currentContextRecordId: row.currentRecordId
          ? (parseUuidV7(row.currentRecordId, "ContextRecordId") as ContextRecordId)
          : null,
        currentContextVersion: Number(row.identityVersion),
        workingContextVersion: Number(row.workingVersion),
        authorityVersion: Number(row.authorityVersion),
        evidenceFrontierVersion: Number(row.frontierVersion),
        integrityVersion: Number(row.integrityVersion),
        engineContractVersion: "stage10j.v1",
      };
      return {
        comparison: {
          semanticIdentity: [row.subject, row.scope, row.facet, row.predicate].join("/"),
          candidateAssertion: row.candidate,
          candidateHash: row.candidateHash,
          duplicateCandidate: row.duplicate,
          currentAssertion: row.currentPayload,
          currentHash: row.currentHash,
          currentIsKnownHistorical,
          authorityQualification: sourceDerived ? authorityQualification : "EFFECTIVE",
          evidenceRequired: sourceDerived,
          evidenceReferenceIds: evidence.map((item) => item.evidenceReferenceId),
          activeConflict: row.activeConflict,
          activeUncertainty: row.activeUncertainty,
        },
        basis,
        workingContext,
        evidence,
      };
    });
  }

  public async recordInvocation(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    basis: ReconciliationBasis,
    accounting: ModelInvocationAccounting,
  ): Promise<void> {
    await withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      await sql`select memoid.record_model_invocation_attempt(${projectId}::uuid,${basis.candidateAssertionId}::uuid,${basisHash(basis)}::bytea,${accounting.providerId}::varchar,${accounting.modelId}::varchar,${accounting.configurationVersion}::varchar,${accounting.pricingVersion}::varchar,${accounting.attempt},${accounting.inputUnits},${accounting.outputUnits},${accounting.totalUnits},${accounting.estimatedCostMicrounits},${accounting.latencyMs},${accounting.succeeded},${accounting.failureCode}::varchar)`.execute(
        trx,
      );
    });
  }

  public async commit(
    context: WorkspaceProjectContext,
    material: ReconciliationMaterial,
    result: ReconciliationResult,
  ) {
    const row = await withSecurityTransaction(
      this.db,
      security(context, material.basis.projectId),
      async (trx) =>
        (
          await sql<{
            reconciliationId: string;
            workingContextItemId: string | null;
            replayed: boolean;
          }>`select reconciliation_id::text "reconciliationId",working_context_item_id::text "workingContextItemId",replayed from memoid.commit_reconciliation_result(${material.basis.projectId}::uuid,${material.basis.candidateAssertionId}::uuid,${material.basis.contextIdentityId}::uuid,${basisHash(material.basis)}::bytea,${material.basis.currentContextRecordId}::uuid,${material.basis.currentContextVersion},${material.basis.workingContextVersion},${material.basis.authorityVersion},${material.basis.evidenceFrontierVersion},${material.basis.integrityVersion},${material.basis.engineContractVersion}::varchar,${result.path}::varchar,${result.classification}::varchar,${result.semanticIdentity}::varchar,${result.normalizedAssertion === null ? null : JSON.stringify(result.normalizedAssertion)}::jsonb,${JSON.stringify(result.evidenceReferenceIds)}::jsonb,${result.conflict},${result.uncertain},${JSON.stringify(result.reasonCodes)}::jsonb,${result.justification}::varchar,null::uuid)`.execute(
            trx,
          )
        ).rows[0],
    );
    if (!row) throw new Error("Reconciliation commit returned no result");
    return {
      reconciliationId: row.reconciliationId,
      workingContextItemId: row.workingContextItemId
        ? (parseUuidV7(row.workingContextItemId, "WorkingContextItemId") as WorkingContextItemId)
        : null,
      replayed: row.replayed,
    };
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
