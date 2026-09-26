import { PostgresChangeProposalRepository } from "../../packages/adapters/src/change-proposal.js";
import { PostgresReconciliationRepository } from "../../packages/adapters/src/reconciliation.js";
import { ChangeProposalService } from "../../packages/application/src/change-proposal.js";
import {
  ReconciliationService,
  type ReconciliationModelProvider,
} from "../../packages/application/src/reconciliation.js";
import { migrateToLatest } from "../../packages/db/src/index.js";
import type {
  AccountId,
  ActorId,
  CandidateAssertionId,
  ChangeProposalId,
  ContextIdentityId,
  ProjectId,
  ReconciliationId,
  WorkspaceId,
} from "../../packages/domain/src/identifiers.js";
import type { ModelConfiguration } from "../../packages/domain/src/reconciliation.js";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const model: ModelConfiguration = {
  providerId: "stage10k",
  modelId: "fixture",
  configurationVersion: "v1",
  privacyClass: "PRIVATE",
  fallbackAllowlist: [],
  pricingVersion: "fixture",
  inputPerMillionMicrounits: 1,
  outputPerMillionMicrounits: 1,
};
const packetBudget = {
  maxEvidence: 4,
  maxWorkingContext: 4,
  maxCharactersPerItem: 1_000,
  maxSerializedBytes: 32_000,
  maxHistoryDepth: 4,
};

suite("Stage 10K Change Proposals PostgreSQL", () => {
  let isolated: IsolatedTestDatabase;
  let reconciliationRepository: PostgresReconciliationRepository;
  let proposalRepository: PostgresChangeProposalRepository;
  let proposalService: ChangeProposalService;
  let accountId: AccountId;
  let workspaceId: WorkspaceId;
  let projectId: ProjectId;
  let humanActorId: ActorId;
  let workerActorId: ActorId;
  let sequence = 0;
  let revisionSequence = 0;
  let humanContext: Parameters<ReconciliationService["reconcile"]>[0];
  let workerContext: Parameters<ChangeProposalService["listCurrentBacklog"]>[0];

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10k_proposals");
    await migrateToLatest(isolated.db);
    const appUrl = isolated.connectionString.replace(
      "postgres:postgres",
      "memoid_app:synthetic-app-password",
    );
    reconciliationRepository = new PostgresReconciliationRepository(appUrl);
    proposalRepository = new PostgresChangeProposalRepository(appUrl);
    proposalService = new ChangeProposalService(proposalRepository);
  });

  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
    sequence = 0;
    revisionSequence = 0;
    accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id as AccountId;
    workspaceId = (
      await sql<{
        id: string;
      }>`insert into memoid.workspaces(account_id) values(${accountId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as WorkspaceId;
    projectId = await createProject("Stage 10K");
    humanActorId = (
      await sql<{
        id: string;
      }>`insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label) values(${workspaceId}::uuid,'HUMAN',${`account:${accountId}`},'Stage 10K owner') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as ActorId;
    workerActorId = (
      await sql<{
        id: string;
      }>`insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label) values(${workspaceId}::uuid,'MEMOID_WORKER','worker:stage10k','Stage 10K worker') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as ActorId;
    humanContext = context("HUMAN", humanActorId);
    workerContext = context("WORKER", workerActorId);
  });

  afterAll(async () => {
    if (reconciliationRepository) await reconciliationRepository.close();
    if (proposalRepository) await proposalRepository.close();
    if (isolated) await isolated.destroy();
  }, 60_000);

  function context(kind: "HUMAN" | "WORKER", actorId: ActorId) {
    return {
      accountId,
      workspaceId,
      sessionCredentialHash: new Uint8Array(32),
      principal:
        kind === "HUMAN"
          ? {
              kind,
              id: "stage10k-owner",
              accountId,
              active: true as const,
              sessionRevoked: false as const,
              roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId }],
            }
          : {
              kind,
              id: "stage10k-worker",
              boundActorId: actorId,
              active: true as const,
              sessionRevoked: false as const,
              roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId }],
            },
      actor: {
        id: actorId,
        kind: kind === "HUMAN" ? ("HUMAN" as const) : ("MEMOID_WORKER" as const),
        reference: kind === "HUMAN" ? `account:${accountId}` : "worker:stage10k",
      },
    };
  }

  async function createProject(name: string): Promise<ProjectId> {
    const id = (
      await sql<{
        id: string;
      }>`insert into memoid.projects(workspace_id,display_name) values(${workspaceId}::uuid,${name}) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as ProjectId;
    await sql`insert into memoid.project_review_policy_versions(workspace_id,project_id,version,policy,effective_at,changed_by_account_id) values(${workspaceId}::uuid,${id}::uuid,1,'MANUAL',clock_timestamp(),${accountId}::uuid)`.execute(
      isolated.db,
    );
    return id;
  }

  async function identity(predicate: string): Promise<ContextIdentityId> {
    return (
      await sql<{
        id: string;
      }>`insert into memoid.context_identities(workspace_id,project_id,subject_key,scope_key,facet_key,predicate_key) values(${workspaceId}::uuid,${projectId}::uuid,'project','architecture','implementation_state:code',${predicate}) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as ContextIdentityId;
  }

  async function reviewed(identityId: ContextIdentityId, value: string): Promise<void> {
    revisionSequence += 1;
    await isolated.db.transaction().execute(async (trx) => {
      const revisionId = (
        await sql<{
          id: string;
        }>`insert into memoid.context_revisions(workspace_id,project_id,revision_sequence,review_policy_version,decision_mode,applied_by_account_id) values(${workspaceId}::uuid,${projectId}::uuid,${revisionSequence},1,'MANUAL',${accountId}::uuid) returning id::text`.execute(
          trx,
        )
      ).rows[0]!.id;
      const payload = JSON.stringify({ value });
      const recordId = (
        await sql<{
          id: string;
        }>`insert into memoid.context_records(workspace_id,project_id,context_identity_id,context_revision_id,assertion_payload,assertion_hash,reviewed_at) values(${workspaceId}::uuid,${projectId}::uuid,${identityId}::uuid,${revisionId}::uuid,${payload}::jsonb,sha256(convert_to(${payload}::jsonb::text,'UTF8')),clock_timestamp()) returning id::text`.execute(
          trx,
        )
      ).rows[0]!.id;
      const idempotencyId = (
        await sql<{
          id: string;
        }>`insert into memoid.idempotency_records(workspace_id,project_id,actor_id,action_key,idempotency_key_hash,request_fingerprint,state,result_kind,result_reference,result_status_code,expires_at) values(${workspaceId}::uuid,${projectId}::uuid,${humanActorId}::uuid,'STAGE10K_FIXTURE',sha256(convert_to(${`reviewed-${revisionSequence}`},'UTF8')),sha256(convert_to(${`reviewed-request-${revisionSequence}`},'UTF8')),'COMPLETED','FIXTURE',${recordId},200,clock_timestamp()+interval '1 day') returning id::text`.execute(
          trx,
        )
      ).rows[0]!.id;
      await sql`insert into memoid.context_record_origins(workspace_id,project_id,context_record_id,context_identity_id,origin_kind,identity_version,record_version,created_by_actor_id,idempotency_record_id,correlation_id) values(${workspaceId}::uuid,${projectId}::uuid,${recordId}::uuid,${identityId}::uuid,'USER_NATIVE',1,1,${humanActorId}::uuid,${idempotencyId}::uuid,uuidv7())`.execute(
        trx,
      );
      await sql`insert into memoid.context_identity_current_records(workspace_id,project_id,context_identity_id,context_record_id,established_by_revision_id) values(${workspaceId}::uuid,${projectId}::uuid,${identityId}::uuid,${recordId}::uuid,${revisionId}::uuid)`.execute(
        trx,
      );
    });
  }

  async function submission(): Promise<string> {
    sequence += 1;
    return (
      await sql<{
        id: string;
      }>`insert into memoid.candidate_submissions(workspace_id,project_id,submission_sequence,submitted_at,payload_hash) values(${workspaceId}::uuid,${projectId}::uuid,${sequence},clock_timestamp(),sha256(convert_to(${`submission-${sequence}`},'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
  }

  async function candidate(
    submissionId: string,
    identityId: ContextIdentityId,
    ordinal: number,
    value: string,
  ): Promise<CandidateAssertionId> {
    const payload = JSON.stringify({ value });
    const candidateId = (
      await sql<{
        id: string;
      }>`insert into memoid.candidate_assertions(workspace_id,project_id,candidate_submission_id,assertion_ordinal,origin_kind,assertion_payload,assertion_hash) values(${workspaceId}::uuid,${projectId}::uuid,${submissionId}::uuid,${ordinal},'AI_INFERRED',${payload}::jsonb,sha256(convert_to(${payload}::jsonb::text,'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as CandidateAssertionId;
    await sql`insert into memoid.working_context_items(workspace_id,project_id,context_identity_id,candidate_assertion_id,trust_qualification,assertion_payload,assertion_hash) values(${workspaceId}::uuid,${projectId}::uuid,${identityId}::uuid,${candidateId}::uuid,'PENDING_UNRECONCILED',${payload}::jsonb,sha256(convert_to(${payload}::jsonb::text,'UTF8')))`.execute(
      isolated.db,
    );
    return candidateId;
  }

  function provider(classification: string): ReconciliationModelProvider {
    return {
      providerId: "stage10k",
      invoke: async (request) => ({
        output: {
          classification,
          semanticIdentity: request.packet.semanticIdentity,
          normalizedAssertion: request.packet.candidateAssertion,
          evidenceReferenceIds: [],
          conflict: classification === "CONFLICTING",
          uncertain: classification === "UNCERTAIN",
          reasonCodes: ["MODEL_SEMANTIC_COMPARISON"],
          justification: null,
        },
        usage: { inputUnits: 1, outputUnits: 1, totalUnits: 2 },
        latencyMs: 1,
        refusal: false,
      }),
    };
  }

  async function reconcile(
    candidateAssertionId: CandidateAssertionId,
    classification: string = "CHANGED",
  ): Promise<ReconciliationId> {
    const result = await new ReconciliationService(
      reconciliationRepository,
      new Map([["stage10k", provider(classification)]]),
    ).reconcile(humanContext, {
      projectId,
      candidateAssertionId,
      model,
      packetBudget,
      maxAttempts: 1,
    });
    return result.reconciliationId as ReconciliationId;
  }

  it("materializes all reviewable classes and creates no UNCHANGED review noise", async () => {
    const classes = ["NEW", "CHANGED", "CONFLICTING", "UNCERTAIN", "OBSOLETE"] as const;
    for (const [index, classification] of classes.entries()) {
      const identityId = await identity(`class-${index}`);
      if (classification !== "NEW") await reviewed(identityId, `old-${index}`);
      const submissionId = await submission();
      const candidateId = await candidate(submissionId, identityId, 1, `new-${index}`);
      const reconciliationId = await reconcile(candidateId, classification);
      const materialized = await proposalService.materializeFromReconciliation(
        workerContext,
        projectId,
        reconciliationId,
      );
      expect(materialized).not.toBeNull();
      const detail = await proposalService.getProposal(
        humanContext,
        projectId,
        materialized!.proposalId,
      );
      expect(detail.items[0]).toEqual(
        expect.objectContaining({
          classification,
          conflictQualified: classification === "CONFLICTING",
          uncertaintyQualified: classification === "UNCERTAIN",
          destructive: classification === "OBSOLETE",
        }),
      );
    }
    const duplicateIdentity = await identity("unchanged");
    const duplicateSubmission = await submission();
    await reconcile(await candidate(duplicateSubmission, duplicateIdentity, 1, "same"));
    const unchangedSubmission = await submission();
    const unchangedId = await reconcile(
      await candidate(unchangedSubmission, duplicateIdentity, 1, "same"),
    );
    await expect(
      proposalService.materializeFromReconciliation(workerContext, projectId, unchangedId),
    ).resolves.toBeNull();
  });

  it("groups compatible submission items while keeping each independently inspectable", async () => {
    const submissionId = await submission();
    const first = await reconcile(await candidate(submissionId, await identity("group-a"), 1, "a"));
    const second = await reconcile(
      await candidate(submissionId, await identity("group-b"), 2, "b"),
    );
    const left = await proposalService.materializeFromReconciliation(
      workerContext,
      projectId,
      first,
    );
    const right = await proposalService.materializeFromReconciliation(
      workerContext,
      projectId,
      second,
    );
    expect(right?.proposalId).toBe(left?.proposalId);
    expect(
      (await proposalService.getProposal(humanContext, projectId, left!.proposalId)).items,
    ).toHaveLength(2);
  });

  it("serializes duplicate delivery and replays one durable Proposal Item", async () => {
    const reconciliationId = await reconcile(
      await candidate(await submission(), await identity("concurrent"), 1, "value"),
    );
    const results = await Promise.all([
      proposalService.materializeFromReconciliation(workerContext, projectId, reconciliationId),
      proposalService.materializeFromReconciliation(workerContext, projectId, reconciliationId),
    ]);
    expect(results.map((result) => result?.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.proposalItemId).toBe(results[1]?.proposalItemId);
  });

  it("creates one monotonic successor chain for competing newer reconciliations", async () => {
    const identityId = await identity("successor");
    const firstId = await reconcile(await candidate(await submission(), identityId, 1, "first"));
    const first = await proposalService.materializeFromReconciliation(
      workerContext,
      projectId,
      firstId,
    );
    const secondId = await reconcile(await candidate(await submission(), identityId, 1, "second"));
    const thirdId = await reconcile(await candidate(await submission(), identityId, 1, "third"));
    await Promise.all([
      proposalService.materializeFromReconciliation(workerContext, projectId, secondId),
      proposalService.materializeFromReconciliation(workerContext, projectId, thirdId),
    ]);
    const historical = await proposalService.getProposal(
      humanContext,
      projectId,
      first!.proposalId,
    );
    expect(historical.lifecycleState).toBe("SUPERSEDED");
    expect(historical.items[0]?.lifecycleState).toBe("SUPERSEDED");
    const counts = (
      await sql<{ current: string; superseded: string }>`select
        count(*) filter(where state.lifecycle_state='CURRENT')::text current,
        count(*) filter(where state.lifecycle_state='SUPERSEDED')::text superseded
        from memoid.change_proposal_items item join memoid.proposal_item_current_states state
          on state.workspace_id=item.workspace_id and state.project_id=item.project_id and state.proposal_item_id=item.id
        where item.workspace_id=${workspaceId}::uuid and item.project_id=${projectId}::uuid and item.context_identity_id=${identityId}::uuid`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(counts).toEqual({ current: "1", superseded: "2" });
  });

  it("fails closed on stale basis and known foreign Proposal IDs", async () => {
    const identityId = await identity("stale");
    const materialized = await proposalService.materializeFromReconciliation(
      workerContext,
      projectId,
      await reconcile(await candidate(await submission(), identityId, 1, "value")),
    );
    await sql`update memoid.context_identities set version=version+1 where workspace_id=${workspaceId}::uuid and project_id=${projectId}::uuid and id=${identityId}::uuid`.execute(
      isolated.db,
    );
    expect(await proposalService.listCurrentBacklog(humanContext, projectId)).toHaveLength(0);
    expect(await proposalService.refreshBacklogCurrentness(workerContext, projectId)).toBe(1);
    expect(
      (await proposalService.getProposal(humanContext, projectId, materialized!.proposalId))
        .lifecycleState,
    ).toBe("STALE");
    const foreignProject = await createProject("Foreign");
    await expect(
      proposalService.getProposal(
        humanContext,
        foreignProject,
        materialized!.proposalId as ChangeProposalId,
      ),
    ).rejects.toThrow("CHANGE_PROPOSAL_NOT_FOUND");
  });
});
