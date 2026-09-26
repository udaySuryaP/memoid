import { PostgresReconciliationRepository } from "../../packages/adapters/src/reconciliation.js";
import {
  ReconciliationService,
  type ReconciliationModelProvider,
  type StructuredModelRequest,
} from "../../packages/application/src/reconciliation.js";
import { migrateToLatest, type MemoidDatabase } from "../../packages/db/src/index.js";
import type {
  AccountId,
  ActorId,
  CandidateAssertionId,
  ContextIdentityId,
  EvidenceReferenceId,
  ProjectId,
  SourceId,
  WorkspaceId,
} from "../../packages/domain/src/identifiers.js";
import type {
  ModelConfiguration,
  ReconciliationResult,
} from "../../packages/domain/src/reconciliation.js";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

const packetBudget = {
  maxEvidence: 8,
  maxWorkingContext: 8,
  maxCharactersPerItem: 2_000,
  maxSerializedBytes: 64_000,
  maxHistoryDepth: 8,
};
const model: ModelConfiguration = {
  providerId: "integration",
  modelId: "structured-proof",
  configurationVersion: "stage10j-correction",
  privacyClass: "PRIVATE",
  fallbackAllowlist: [],
  pricingVersion: "synthetic",
  inputPerMillionMicrounits: 1,
  outputPerMillionMicrounits: 1,
};

interface Scope {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  actorId: ActorId;
  context: Parameters<ReconciliationService["reconcile"]>[0];
}

interface SourceFixture {
  sourceId: SourceId;
  evidenceReferenceId: EvidenceReferenceId;
  frontierUnitId: string;
  authorityScopeId: string;
  authorityAssignmentId: string;
}

suite("Stage 10J Reconciliation PostgreSQL material and service", () => {
  let isolated: IsolatedTestDatabase;
  let repository: PostgresReconciliationRepository;
  let scope: Scope;
  let sequence = 0;
  let submissionSequence = 0;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10j_reconciliation");
    await migrateToLatest(isolated.db);
    repository = new PostgresReconciliationRepository(
      isolated.connectionString.replace("postgres:postgres", "memoid_app:synthetic-app-password"),
    );
  });

  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
    sequence = 0;
    submissionSequence = 0;
    scope = await createScope();
  });

  afterAll(async () => {
    if (repository) await repository.close();
    if (isolated) await isolated.destroy();
  }, 60_000);

  async function createScope(): Promise<Scope> {
    const accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id as AccountId;
    const workspaceId = (
      await sql<{ id: string }>`insert into memoid.workspaces(account_id) values(${accountId}::uuid)
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id as WorkspaceId;
    const projectId = (
      await sql<{ id: string }>`insert into memoid.projects(workspace_id,display_name)
        values(${workspaceId}::uuid,'Stage 10J correction') returning id::text`.execute(isolated.db)
    ).rows[0]!.id as ProjectId;
    await sql`insert into memoid.project_review_policy_versions(workspace_id,project_id,version,
      policy,effective_at,changed_by_account_id) values(${workspaceId}::uuid,${projectId}::uuid,1,
      'MANUAL',clock_timestamp(),${accountId}::uuid)`.execute(isolated.db);
    const actorId = (
      await sql<{
        id: string;
      }>`insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label)
        values(${workspaceId}::uuid,'HUMAN',${`account:${accountId}`} ,'Stage 10J owner')
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id as ActorId;
    const context = {
      accountId,
      workspaceId,
      sessionCredentialHash: new Uint8Array(32),
      actor: { id: actorId, kind: "HUMAN" as const, reference: `account:${accountId}` },
      principal: {
        kind: "HUMAN" as const,
        id: "stage10j-owner",
        accountId,
        active: true as const,
        sessionRevoked: false as const,
        roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId }] as const,
      },
    };
    return { accountId, workspaceId, projectId, actorId, context };
  }

  async function idempotency(db: Kysely<MemoidDatabase>, key: string): Promise<string> {
    sequence += 1;
    return (
      await sql<{ id: string }>`insert into memoid.idempotency_records(workspace_id,project_id,
        actor_id,action_key,idempotency_key_hash,request_fingerprint,state,result_kind,
        result_reference,result_status_code,expires_at)
        values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${scope.actorId}::uuid,
        'STAGE10J_FIXTURE',sha256(convert_to(${`${key}-${sequence}`},'UTF8')),
        sha256(convert_to(${`request-${key}-${sequence}`},'UTF8')),'COMPLETED','FIXTURE',
        ${`fixture-${sequence}`},200,clock_timestamp()+interval '1 day') returning id::text`.execute(
        db,
      )
    ).rows[0]!.id;
  }

  async function identity(): Promise<ContextIdentityId> {
    return (
      await sql<{ id: string }>`insert into memoid.context_identities(workspace_id,project_id,
        subject_key,scope_key,facet_key,predicate_key) values(${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,'project','architecture','implementation_state:code','database')
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id as ContextIdentityId;
  }

  async function appendReviewed(
    contextIdentityId: ContextIdentityId,
    value: string,
    prior?: { recordId: string; version: number },
  ): Promise<{ recordId: string; version: number }> {
    return isolated.db.transaction().execute(async (trx) => {
      const version = (prior?.version ?? 0) + 1;
      const revisionId = (
        await sql<{ id: string }>`insert into memoid.context_revisions(workspace_id,project_id,
          revision_sequence,review_policy_version,decision_mode,applied_by_account_id)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${version},1,'MANUAL',
          ${scope.accountId}::uuid) returning id::text`.execute(trx)
      ).rows[0]!.id;
      const payload = JSON.stringify({ value });
      const recordId = (
        await sql<{ id: string }>`insert into memoid.context_records(workspace_id,project_id,
          context_identity_id,context_revision_id,assertion_payload,assertion_hash,reviewed_at)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${contextIdentityId}::uuid,
          ${revisionId}::uuid,${payload}::jsonb,sha256(convert_to(${payload}::jsonb::text,'UTF8')),
          clock_timestamp()) returning id::text`.execute(trx)
      ).rows[0]!.id;
      const idempotencyId = await idempotency(trx, `reviewed-${version}`);
      await sql`insert into memoid.context_record_origins(workspace_id,project_id,context_record_id,
        context_identity_id,origin_kind,identity_version,record_version,supersedes_context_record_id,
        created_by_actor_id,idempotency_record_id,correlation_id)
        values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${recordId}::uuid,
        ${contextIdentityId}::uuid,'USER_NATIVE',${version},${version},${prior?.recordId ?? null}::uuid,
        ${scope.actorId}::uuid,${idempotencyId}::uuid,uuidv7())`.execute(trx);
      if (prior) {
        await sql`update memoid.context_identities set version=version+1
          where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
            and id=${contextIdentityId}::uuid`.execute(trx);
        await sql`update memoid.context_identity_current_records set context_record_id=${recordId}::uuid,
          established_by_revision_id=${revisionId}::uuid,established_at=clock_timestamp()
          where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
            and context_identity_id=${contextIdentityId}::uuid`.execute(trx);
      } else {
        await sql`insert into memoid.context_identity_current_records(workspace_id,project_id,
          context_identity_id,context_record_id,established_by_revision_id)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${contextIdentityId}::uuid,
          ${recordId}::uuid,${revisionId}::uuid)`.execute(trx);
      }
      return { recordId, version };
    });
  }

  async function source(input: {
    key: string;
    path: string;
    defaultBranch: string;
    refKey: string;
    authorityDefaultSnapshot: string;
  }): Promise<SourceFixture> {
    return isolated.db.transaction().execute(async (trx) => {
      sequence += 1;
      const sourceId = (
        await sql<{ id: string }>`insert into memoid.sources(workspace_id,project_id,source_kind)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,'GITHUB_REPOSITORY')
          returning id::text`.execute(trx)
      ).rows[0]!.id as SourceId;
      await sql`insert into memoid.github_source_connections(workspace_id,project_id,source_id,app_id,
        installation_id,account_id,repository_id,owner_login,repository_name,full_name,html_url,
        visibility,default_branch,connection_state,verified_at)
        values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${sourceId}::uuid,'1',
        ${String(100 + sequence)},'3',${String(1000 + sequence)},'owner',${input.key},
        ${`owner/${input.key}`},${`https://github.com/owner/${input.key}`},'PRIVATE',
        ${input.defaultBranch},'ACTIVE',clock_timestamp())`.execute(trx);
      const frontierUnitId = (
        await sql<{ id: string }>`insert into memoid.source_frontier_units(workspace_id,project_id,
          source_id,scope_key,ref_key) values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,
          ${sourceId}::uuid,'repository',${input.refKey}) returning id::text`.execute(trx)
      ).rows[0]!.id;
      const revision = sequence.toString(16).padStart(40, "a").slice(-40);
      const observationId = (
        await sql<{ id: string }>`insert into memoid.source_observations(workspace_id,project_id,
          frontier_unit_id,observation_sequence,external_revision,observed_at,metadata)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${frontierUnitId}::uuid,1,
          ${revision},clock_timestamp(),'{}'::jsonb) returning id::text`.execute(trx)
      ).rows[0]!.id;
      await sql`insert into memoid.source_frontier_states(workspace_id,project_id,frontier_unit_id,
        observed_sequence,desired_sequence,ingested_sequence,reconciled_sequence)
        values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${frontierUnitId}::uuid,1,1,1,1)`.execute(
        trx,
      );
      const evidenceReferenceId = (
        await sql<{ id: string }>`insert into memoid.evidence_references(workspace_id,project_id,
          source_id,frontier_unit_id,source_observation_id,observation_sequence,evidence_kind,
          repository_revision,repository_path,provider_object_id,byte_size,content_sha256)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${sourceId}::uuid,
          ${frontierUnitId}::uuid,${observationId}::uuid,1,'FILE',${revision},${input.path},
          ${revision},64,sha256(convert_to(${input.key},'UTF8'))) returning id::text`.execute(trx)
      ).rows[0]!.id as EvidenceReferenceId;
      const authorityScopeId = (
        await sql<{
          id: string;
        }>`insert into memoid.source_authority_scopes(workspace_id,project_id,
          authority_category,authority_facet,scope_kind,scope_key,ref_selector)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,'IMPLEMENTATION_STATE','CODE',
          'PATH_PREFIX',${input.path.split("/").slice(0, -1).join("/")},'DEFAULT_BRANCH')
          returning id::text`.execute(trx)
      ).rows[0]!.id;
      const idempotencyId = await idempotency(trx, `authority-${input.key}`);
      const assignmentId = (
        await sql<{ id: string }>`insert into memoid.source_authority_assignments(workspace_id,
          project_id,authority_scope_id,assignment_version,source_id,source_default_ref_snapshot,
          effective_at,reason_key,created_by_actor_id,correlation_id,idempotency_record_id)
          values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${authorityScopeId}::uuid,1,
          ${sourceId}::uuid,${input.authorityDefaultSnapshot},clock_timestamp(),'INITIAL_REVIEW',
          ${scope.actorId}::uuid,uuidv7(),${idempotencyId}::uuid) returning id::text`.execute(trx)
      ).rows[0]!.id;
      await sql`update memoid.source_authority_scopes set version=1,
        current_assignment_id=${assignmentId}::uuid where workspace_id=${scope.workspaceId}::uuid
        and project_id=${scope.projectId}::uuid and id=${authorityScopeId}::uuid`.execute(trx);
      return {
        sourceId,
        evidenceReferenceId,
        frontierUnitId,
        authorityScopeId,
        authorityAssignmentId: assignmentId,
      };
    });
  }

  async function candidate(
    contextIdentityId: ContextIdentityId,
    value: string,
    evidenceReferenceIds: readonly EvidenceReferenceId[] = [],
    origin: "SOURCE_DERIVED" | "AI_INFERRED" = "SOURCE_DERIVED",
  ): Promise<CandidateAssertionId> {
    submissionSequence += 1;
    const payload = JSON.stringify({ value });
    const submissionId = (
      await sql<{ id: string }>`insert into memoid.candidate_submissions(workspace_id,project_id,
        submission_sequence,submitted_at,payload_hash,source_frontier_basis)
        values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${submissionSequence},
        clock_timestamp(),sha256(convert_to(${payload},'UTF8')),
        ${JSON.stringify(evidenceReferenceIds.map((evidenceReferenceId) => ({ evidenceReferenceId })))}::jsonb)
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const candidateAssertionId = (
      await sql<{ id: string }>`insert into memoid.candidate_assertions(workspace_id,project_id,
        candidate_submission_id,assertion_ordinal,origin_kind,confirmation_kind,assertion_payload,
        assertion_hash) values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,
        ${submissionId}::uuid,1,${origin},'NONE',${payload}::jsonb,
        sha256(convert_to(${payload}::jsonb::text,'UTF8'))) returning id::text`.execute(isolated.db)
    ).rows[0]!.id as CandidateAssertionId;
    await sql`insert into memoid.working_context_items(workspace_id,project_id,context_identity_id,
      candidate_assertion_id,trust_qualification,assertion_payload,assertion_hash)
      values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${contextIdentityId}::uuid,
      ${candidateAssertionId}::uuid,'PENDING_UNRECONCILED',${payload}::jsonb,
      sha256(convert_to(${payload}::jsonb::text,'UTF8')))`.execute(isolated.db);
    return candidateAssertionId;
  }

  async function activateConflict(
    contextIdentityId: ContextIdentityId,
    sourceA: SourceFixture,
    sourceB: SourceFixture,
  ): Promise<void> {
    const idempotencyId = await idempotency(isolated.db, "conflict");
    const conflictId = (
      await sql<{ id: string }>`insert into memoid.integrity_conflicts(workspace_id,project_id,
        context_identity_id) values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,
        ${contextIdentityId}::uuid) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const occurrenceId = (
      await sql<{ id: string }>`insert into memoid.conflict_occurrences(workspace_id,project_id,
        conflict_id,context_identity_id,occurrence_version,lifecycle_state,classification_key,
        participant_set_hash,recorded_by_actor_id,idempotency_record_id,correlation_id)
        values(${scope.workspaceId}::uuid,${scope.projectId}::uuid,${conflictId}::uuid,
        ${contextIdentityId}::uuid,1,'ACTIVE','MATERIAL_CONTRADICTION',
        sha256(convert_to('stage10j-conflict','UTF8')),${scope.actorId}::uuid,
        ${idempotencyId}::uuid,uuidv7()) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    await sql`insert into memoid.conflict_participants(workspace_id,project_id,conflict_id,
      conflict_occurrence_id,participant_ordinal,participant_kind,evidence_reference_id,source_id,
      effective_authority_assignment_id,source_qualification,claim_fingerprint) values
      (${scope.workspaceId}::uuid,${scope.projectId}::uuid,${conflictId}::uuid,${occurrenceId}::uuid,
        1,'SOURCE_EVIDENCE',${sourceA.evidenceReferenceId}::uuid,${sourceA.sourceId}::uuid,
        ${sourceA.authorityAssignmentId}::uuid,'AUTHORITATIVE_CURRENT',
        sha256(convert_to('source-a-claim','UTF8'))),
      (${scope.workspaceId}::uuid,${scope.projectId}::uuid,${conflictId}::uuid,${occurrenceId}::uuid,
        2,'SOURCE_EVIDENCE',${sourceB.evidenceReferenceId}::uuid,${sourceB.sourceId}::uuid,
        ${sourceB.authorityAssignmentId}::uuid,'REVALIDATION_REQUIRED',
        sha256(convert_to('source-b-claim','UTF8')))`.execute(isolated.db);
    await sql`insert into memoid.conflict_current_states(workspace_id,project_id,conflict_id,
      current_occurrence_id,occurrence_version,lifecycle_state) values(${scope.workspaceId}::uuid,
      ${scope.projectId}::uuid,${conflictId}::uuid,${occurrenceId}::uuid,1,'ACTIVE')`.execute(
      isolated.db,
    );
  }

  function provider(beforeResponse?: () => Promise<void>) {
    return {
      providerId: "integration",
      invoke: vi.fn(async (request: StructuredModelRequest) => {
        await beforeResponse?.();
        return {
          output: {
            classification: "CHANGED",
            semanticIdentity: request.packet.semanticIdentity,
            normalizedAssertion: request.packet.candidateAssertion,
            evidenceReferenceIds: request.packet.evidence.map((item) => item.evidenceReferenceId),
            conflict: false,
            uncertain: false,
            reasonCodes: ["MODEL_SEMANTIC_COMPARISON"],
            justification: "bounded integration proof",
          },
          usage: { inputUnits: 10, outputUnits: 5, totalUnits: 15 },
          latencyMs: 1,
          refusal: false,
        };
      }),
    } satisfies ReconciliationModelProvider;
  }

  function command(candidateAssertionId: CandidateAssertionId) {
    return {
      projectId: scope.projectId,
      candidateAssertionId,
      model,
      packetBudget,
      maxAttempts: 1,
    };
  }

  function changed(
    material: Awaited<ReturnType<PostgresReconciliationRepository["loadMaterial"]>>,
  ) {
    return {
      classification: "CHANGED",
      semanticIdentity: material.comparison.semanticIdentity,
      normalizedAssertion: material.comparison.candidateAssertion,
      evidenceReferenceIds: material.comparison.evidenceReferenceIds,
      conflict: false,
      uncertain: false,
      reasonCodes: ["MODEL_SEMANTIC_COMPARISON"],
      justification: "stale-basis proof",
      path: "MODEL",
      schemaVersion: "reconciliation-output.v1",
    } satisfies ReconciliationResult;
  }

  it("assembles canonical evidence and bounded relevant Working Context, then commits CHANGED", async () => {
    const contextIdentityId = await identity();
    await appendReviewed(contextIdentityId, "PostgreSQL 17");
    const sourceA = await source({
      key: "source-a",
      path: "src/a/database.ts",
      defaultBranch: "main",
      refKey: "refs/heads/main",
      authorityDefaultSnapshot: "refs/heads/main",
    });
    const candidateAssertionId = await candidate(contextIdentityId, "PostgreSQL 18", [
      sourceA.evidenceReferenceId,
    ]);
    const peer = await candidate(contextIdentityId, "Use connection pooling", [], "AI_INFERRED");
    const material = await repository.loadMaterial(
      scope.context,
      scope.projectId,
      candidateAssertionId,
    );
    expect(material.comparison).toMatchObject({
      authorityQualification: "EFFECTIVE",
      evidenceReferenceIds: [sourceA.evidenceReferenceId],
      currentAssertion: { value: "PostgreSQL 17" },
    });
    expect(material.evidence[0]).toMatchObject({
      evidenceReferenceId: sourceA.evidenceReferenceId,
      sourceId: sourceA.sourceId,
      authorityQualification: "EFFECTIVE",
    });
    expect(material.workingContext).toEqual([
      expect.objectContaining({
        candidateAssertionId: peer,
        assertion: { value: "Use connection pooling" },
      }),
    ]);
    const proofProvider = provider();
    const result = await new ReconciliationService(
      repository,
      new Map([[proofProvider.providerId, proofProvider]]),
    ).reconcile(scope.context, command(candidateAssertionId));
    expect(result).toMatchObject({ replayed: false });
    expect(proofProvider.invoke).toHaveBeenCalledOnce();
    const stored = (
      await sql<{
        trust: string;
        count: string;
      }>`select max(trust_qualification) trust,count(*)::text count
        from memoid.working_context_items where workspace_id=${scope.workspaceId}::uuid
          and project_id=${scope.projectId}::uuid and candidate_assertion_id=${candidateAssertionId}::uuid`.execute(
        isolated.db,
      )
    ).rows[0]!;
    expect(stored).toEqual({ trust: "RECONCILED_UNREVIEWED", count: "1" });
  });

  it("keeps two Sources isolated and returns real CONFLICTING versus authority-disqualified UNCERTAIN", async () => {
    const contextIdentityId = await identity();
    await appendReviewed(contextIdentityId, "reviewed");
    const sourceA = await source({
      key: "source-a",
      path: "src/a/database.ts",
      defaultBranch: "main",
      refKey: "refs/heads/main",
      authorityDefaultSnapshot: "refs/heads/main",
    });
    const sourceB = await source({
      key: "source-b",
      path: "src/b/database.ts",
      defaultBranch: "develop",
      refKey: "refs/heads/develop",
      authorityDefaultSnapshot: "refs/heads/main",
    });
    const conflicting = await candidate(contextIdentityId, "source-a-change", [
      sourceA.evidenceReferenceId,
    ]);
    const disqualified = await candidate(contextIdentityId, "source-b-change", [
      sourceB.evidenceReferenceId,
    ]);
    await activateConflict(contextIdentityId, sourceA, sourceB);
    const materialA = await repository.loadMaterial(scope.context, scope.projectId, conflicting);
    const materialB = await repository.loadMaterial(scope.context, scope.projectId, disqualified);
    expect(materialA.comparison.authorityQualification).toBe("EFFECTIVE");
    expect(materialB.comparison.authorityQualification).toBe("REVALIDATION_REQUIRED");
    expect(materialA.evidence[0]!.sourceId).toBe(sourceA.sourceId);
    expect(materialB.evidence[0]!.sourceId).toBe(sourceB.sourceId);
    const unused = provider();
    const service = new ReconciliationService(repository, new Map([[unused.providerId, unused]]));
    const first = await service.reconcile(scope.context, command(conflicting));
    const second = await service.reconcile(scope.context, command(disqualified));
    const rows = (
      await sql<{ candidateId: string; classification: string }>`select candidate_assertion_id::text
        "candidateId",classification from memoid.reconciliation_records
        where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
        order by recorded_at`.execute(isolated.db)
    ).rows;
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(rows).toEqual([
      { candidateId: conflicting, classification: "CONFLICTING" },
      { candidateId: disqualified, classification: "UNCERTAIN" },
    ]);
    expect(unused.invoke).not.toHaveBeenCalled();
  });

  it("derives SUPERSEDED only from a deterministic Reviewed Context predecessor chain", async () => {
    const contextIdentityId = await identity();
    const historical = await appendReviewed(contextIdentityId, "historical-value");
    await appendReviewed(contextIdentityId, "current-value", historical);
    const candidateAssertionId = await candidate(
      contextIdentityId,
      "historical-value",
      [],
      "AI_INFERRED",
    );
    const material = await repository.loadMaterial(
      scope.context,
      scope.projectId,
      candidateAssertionId,
    );
    expect(material.comparison.currentIsKnownHistorical).toBe(true);
    const unused = provider();
    await new ReconciliationService(repository, new Map([[unused.providerId, unused]])).reconcile(
      scope.context,
      command(candidateAssertionId),
    );
    const classification = (
      await sql<{ classification: string }>`select classification from memoid.reconciliation_records
        where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
          and candidate_assertion_id=${candidateAssertionId}::uuid`.execute(isolated.db)
    ).rows[0]!.classification;
    expect(classification).toBe("SUPERSEDED");
    expect(unused.invoke).not.toHaveBeenCalled();
  });

  it("fails closed on stale authority, frontier, and Reviewed Context bases", async () => {
    const contextIdentityId = await identity();
    const reviewed = await appendReviewed(contextIdentityId, "reviewed");
    const sourceA = await source({
      key: "source-a",
      path: "src/a/database.ts",
      defaultBranch: "main",
      refKey: "refs/heads/main",
      authorityDefaultSnapshot: "refs/heads/main",
    });
    const authorityCandidate = await candidate(contextIdentityId, "authority-stale", [
      sourceA.evidenceReferenceId,
    ]);
    const authorityMaterial = await repository.loadMaterial(
      scope.context,
      scope.projectId,
      authorityCandidate,
    );
    await source({
      key: "source-b",
      path: "src/b/database.ts",
      defaultBranch: "main",
      refKey: "refs/heads/main",
      authorityDefaultSnapshot: "refs/heads/main",
    });
    await expect(
      repository.commit(scope.context, authorityMaterial, changed(authorityMaterial)),
    ).rejects.toThrow("STALE_AUTHORITY_BASIS");

    const frontierCandidate = await candidate(contextIdentityId, "frontier-stale", [
      sourceA.evidenceReferenceId,
    ]);
    const frontierMaterial = await repository.loadMaterial(
      scope.context,
      scope.projectId,
      frontierCandidate,
    );
    await sql`update memoid.source_frontier_states set desired_sequence=desired_sequence+1
      where workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid
        and frontier_unit_id=${sourceA.frontierUnitId}::uuid`.execute(isolated.db);
    await expect(
      repository.commit(scope.context, frontierMaterial, changed(frontierMaterial)),
    ).rejects.toThrow("STALE_FRONTIER_BASIS");

    const contextCandidate = await candidate(contextIdentityId, "context-stale", [], "AI_INFERRED");
    const contextMaterial = await repository.loadMaterial(
      scope.context,
      scope.projectId,
      contextCandidate,
    );
    await appendReviewed(contextIdentityId, "reviewed-after-load", reviewed);
    await expect(
      repository.commit(scope.context, contextMaterial, changed(contextMaterial)),
    ).rejects.toThrow("STALE_REVIEWED_CONTEXT_BASIS");
  });

  it("serializes concurrent reconciliation, replays idempotently, and prevents late overwrite", async () => {
    const contextIdentityId = await identity();
    await appendReviewed(contextIdentityId, "reviewed");
    const sourceA = await source({
      key: "source-a",
      path: "src/a/database.ts",
      defaultBranch: "main",
      refKey: "refs/heads/main",
      authorityDefaultSnapshot: "refs/heads/main",
    });
    const candidateAssertionId = await candidate(contextIdentityId, "concurrent-change", [
      sourceA.evidenceReferenceId,
    ]);
    let arrivals = 0;
    let release!: () => void;
    const bothLoaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    const proofProvider = provider(async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await bothLoaded;
    });
    const service = new ReconciliationService(
      repository,
      new Map([[proofProvider.providerId, proofProvider]]),
    );
    const results = await Promise.all([
      service.reconcile(scope.context, command(candidateAssertionId)),
      service.reconcile(scope.context, command(candidateAssertionId)),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    const counts = (
      await sql<{ reconciliations: string; working: string; current: string }>`select
        (select count(*)::text from memoid.reconciliation_records where workspace_id=${scope.workspaceId}::uuid
          and project_id=${scope.projectId}::uuid and candidate_assertion_id=${candidateAssertionId}::uuid) reconciliations,
        (select count(*)::text from memoid.working_context_items where workspace_id=${scope.workspaceId}::uuid
          and project_id=${scope.projectId}::uuid and candidate_assertion_id=${candidateAssertionId}::uuid) working,
        (select count(*)::text from memoid.reconciliation_current_states where workspace_id=${scope.workspaceId}::uuid
          and project_id=${scope.projectId}::uuid and candidate_assertion_id=${candidateAssertionId}::uuid) current`.execute(
        isolated.db,
      )
    ).rows[0]!;
    expect(counts).toEqual({ reconciliations: "1", working: "1", current: "1" });
  });
});
