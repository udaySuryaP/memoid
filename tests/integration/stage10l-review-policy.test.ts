import {
  migrateToLatest,
  withSecurityTransaction,
  type MemoidDatabase,
} from "../../packages/db/src/index.js";
import { sql, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("Stage 10L review-policy evaluation and transitions", () => {
  let isolated: IsolatedTestDatabase;
  let accountId: string;
  let workspaceId: string;
  let projectId: string;
  let humanActorId: string;
  let workerActorId: string;
  let itemId: string;

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10l_policy");
    await migrateToLatest(isolated.db);
    accountId = (
      await sql<{
        id: string;
      }>`insert into memoid.accounts default values returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    workspaceId = (
      await sql<{
        id: string;
      }>`insert into memoid.workspaces(account_id) values(${accountId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    projectId = (
      await sql<{
        id: string;
      }>`insert into memoid.projects(workspace_id,display_name) values(${workspaceId}::uuid,'Stage 10L') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.project_review_policy_versions(workspace_id,project_id,version,policy,effective_at,changed_by_account_id) values(${workspaceId}::uuid,${projectId}::uuid,1,'MANUAL',clock_timestamp(),${accountId}::uuid)`.execute(
      isolated.db,
    );
    humanActorId = (
      await sql<{
        id: string;
      }>`insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label) values(${workspaceId}::uuid,'HUMAN',${`account:${accountId}`},'Owner') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    workerActorId = (
      await sql<{
        id: string;
      }>`insert into memoid.actors(workspace_id,actor_kind,actor_reference,display_label) values(${workspaceId}::uuid,'MEMOID_WORKER','worker:stage10l','Worker') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    itemId = await seedItem("CHANGED", false, false, false, "eligible");
  }, 60_000);
  afterAll(async () => isolated?.destroy(), 60_000);

  async function seedItem(
    classification: "CHANGED" | "CONFLICTING",
    conflict: boolean,
    uncertain: boolean,
    destructive: boolean,
    suffix: string,
  ): Promise<string> {
    const sourceId = (
      await sql<{
        id: string;
      }>`insert into memoid.sources(workspace_id,project_id,source_kind) values(${workspaceId}::uuid,${projectId}::uuid,'GITHUB') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const unitId = (
      await sql<{
        id: string;
      }>`insert into memoid.source_frontier_units(workspace_id,project_id,source_id,scope_key,ref_key) values(${workspaceId}::uuid,${projectId}::uuid,${sourceId}::uuid,'project','refs/heads/main') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const observationId = (
      await sql<{
        id: string;
      }>`insert into memoid.source_observations(workspace_id,project_id,frontier_unit_id,observation_sequence,external_revision,observed_at,metadata) values(${workspaceId}::uuid,${projectId}::uuid,${unitId}::uuid,1,${"a".repeat(40)},clock_timestamp(),'{"IS_DEFAULT_REF":true}'::jsonb) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.source_frontier_states(workspace_id,project_id,frontier_unit_id,observed_sequence,desired_sequence,ingested_sequence,reconciled_sequence) values(${workspaceId}::uuid,${projectId}::uuid,${unitId}::uuid,1,1,1,1)`.execute(
      isolated.db,
    );
    const evidenceId = (
      await sql<{
        id: string;
      }>`insert into memoid.evidence_references(workspace_id,project_id,source_id,frontier_unit_id,source_observation_id,observation_sequence,evidence_kind,repository_revision,repository_path,provider_object_id,byte_size,content_sha256) values(${workspaceId}::uuid,${projectId}::uuid,${sourceId}::uuid,${unitId}::uuid,${observationId}::uuid,1,'FILE',${"a".repeat(40)},${`src/${suffix}.ts`},${"b".repeat(40)},1,sha256(convert_to(${suffix},'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const submissionId = (
      await sql<{
        id: string;
      }>`insert into memoid.candidate_submissions(workspace_id,project_id,submission_sequence,submitted_at,payload_hash) values(${workspaceId}::uuid,${projectId}::uuid,(select coalesce(max(submission_sequence),0)+1 from memoid.candidate_submissions where project_id=${projectId}::uuid),clock_timestamp(),sha256(convert_to(${`submission-${suffix}`},'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const candidateId = (
      await sql<{
        id: string;
      }>`insert into memoid.candidate_assertions(workspace_id,project_id,candidate_submission_id,assertion_ordinal,origin_kind,assertion_payload,assertion_hash) values(${workspaceId}::uuid,${projectId}::uuid,${submissionId}::uuid,1,'SOURCE_DERIVED',${JSON.stringify({ value: suffix })}::jsonb,sha256(convert_to(${suffix},'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const identityId = (
      await sql<{
        id: string;
      }>`insert into memoid.context_identities(workspace_id,project_id,subject_key,scope_key,facet_key,predicate_key) values(${workspaceId}::uuid,${projectId}::uuid,'project','architecture','implementation_state:code',${suffix}) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const workingId = (
      await sql<{
        id: string;
      }>`insert into memoid.working_context_items(workspace_id,project_id,context_identity_id,candidate_assertion_id,trust_qualification,assertion_payload,assertion_hash,reconciled_at) values(${workspaceId}::uuid,${projectId}::uuid,${identityId}::uuid,${candidateId}::uuid,'RECONCILED_UNREVIEWED',${JSON.stringify({ value: suffix })}::jsonb,sha256(convert_to(${suffix},'UTF8')),clock_timestamp()) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const frontier = await sql<{
      value: string;
    }>`select coalesce(sum(coalesce(observed_sequence,0)+coalesce(desired_sequence,0)+coalesce(ingested_sequence,0)+coalesce(reconciled_sequence,0)),0)::text value from memoid.source_frontier_states where project_id=${projectId}::uuid`.execute(
      isolated.db,
    );
    const evidence = JSON.stringify([evidenceId]);
    const recId = (
      await sql<{
        id: string;
      }>`insert into memoid.reconciliation_records(workspace_id,project_id,candidate_assertion_id,context_identity_id,basis_hash,current_context_version,working_context_version,authority_version,evidence_frontier_version,integrity_version,engine_contract_version,schema_version,prompt_version,compaction_version,normalization_version,decision_path,classification,semantic_identity,normalized_assertion,evidence_reference_ids,conflict_indicated,uncertainty_indicated,reason_codes,working_context_item_id,recorded_by_actor_id) values(${workspaceId}::uuid,${projectId}::uuid,${candidateId}::uuid,${identityId}::uuid,sha256(convert_to(${`basis-${suffix}`},'UTF8')),1,0,0,${frontier.rows[0]!.value},0,'stage10j.v1','reconciliation-output.v1','reconciliation-prompt.v1','reasoning-packet.v1','semantic-normalization.v1','DETERMINISTIC',${classification},${`project/architecture/${suffix}`},${JSON.stringify({ value: suffix })}::jsonb,${evidence}::jsonb,${conflict},${uncertain},'[]'::jsonb,${workingId}::uuid,${workerActorId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.reconciliation_current_states(workspace_id,project_id,candidate_assertion_id,reconciliation_id,basis_hash) values(${workspaceId}::uuid,${projectId}::uuid,${candidateId}::uuid,${recId}::uuid,sha256(convert_to(${`basis-${suffix}`},'UTF8')))`.execute(
      isolated.db,
    );
    const operationId = (
      await sql<{
        id: string;
      }>`insert into memoid.operations(workspace_id,project_id,initiating_actor_id,operation_kind,state,correlation_id,attempt_count,max_attempts,terminal_at) values(${workspaceId}::uuid,${projectId}::uuid,${workerActorId}::uuid,'MATERIALIZE_CHANGE_PROPOSAL','SUCCEEDED',uuidv7(),1,1,clock_timestamp()) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const proposalId = (
      await sql<{
        id: string;
      }>`insert into memoid.change_proposals(workspace_id,project_id,grouping_version,grouping_key,submission_id,scope_key,facet_key,operation_id,created_by_actor_id) values(${workspaceId}::uuid,${projectId}::uuid,'proposal-grouping.v1',sha256(convert_to(${`group-${suffix}`},'UTF8')),${submissionId}::uuid,'architecture','implementation_state:code',${operationId}::uuid,${workerActorId}::uuid) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    const proposalItemId = (
      await sql<{
        id: string;
      }>`insert into memoid.change_proposal_items(workspace_id,project_id,proposal_id,reconciliation_id,candidate_assertion_id,context_identity_id,semantic_fingerprint,semantic_identity,reconciliation_class,normalized_assertion,working_context_item_id,evidence_reference_ids,conflict_qualified,uncertainty_qualified,destructive,current_context_version,working_context_version,authority_version,evidence_frontier_version,integrity_version,engine_contract_version,basis_hash) values(${workspaceId}::uuid,${projectId}::uuid,${proposalId}::uuid,${recId}::uuid,${candidateId}::uuid,${identityId}::uuid,sha256(convert_to(${`fingerprint-${suffix}`},'UTF8')),${`project/architecture/${suffix}`},${classification},${JSON.stringify({ value: suffix })}::jsonb,${workingId}::uuid,${evidence}::jsonb,${conflict},${uncertain},${destructive},1,0,0,${frontier.rows[0]!.value},0,'stage10j.v1',sha256(convert_to(${`basis-${suffix}`},'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    await sql`insert into memoid.proposal_current_states(workspace_id,project_id,proposal_id,lifecycle_state) values(${workspaceId}::uuid,${projectId}::uuid,${proposalId}::uuid,'OPEN')`.execute(
      isolated.db,
    );
    await sql`insert into memoid.proposal_item_current_states(workspace_id,project_id,proposal_item_id,lifecycle_state) values(${workspaceId}::uuid,${projectId}::uuid,${proposalItemId}::uuid,'CURRENT')`.execute(
      isolated.db,
    );
    return proposalItemId;
  }

  async function asActor<T>(
    actorId: string,
    fn: (trx: Transaction<MemoidDatabase>) => Promise<T>,
  ): Promise<T> {
    return withSecurityTransaction(isolated.db, { accountId, workspaceId, projectId, actorId }, fn);
  }

  it("binds immutable MANUAL evaluation history to policy version and replays idempotently", async () => {
    const ids = await asActor(workerActorId, async (trx) => {
      const one = (
        await sql<{
          id: string;
        }>`select memoid.evaluate_proposal_item_review_policy(${projectId}::uuid,${itemId}::uuid)::text id`.execute(
          trx,
        )
      ).rows[0]!.id;
      const two = (
        await sql<{
          id: string;
        }>`select memoid.evaluate_proposal_item_review_policy(${projectId}::uuid,${itemId}::uuid)::text id`.execute(
          trx,
        )
      ).rows[0]!.id;
      return [one, two];
    });
    expect(ids[0]).toBe(ids[1]);
    const row = (
      await sql<{
        decision: string;
        reasons: string[];
        version: string;
      }>`select decision,reason_codes reasons,project_policy_version::text version from memoid.review_policy_evaluations where id=${ids[0]}::uuid`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(row).toEqual({
      decision: "MANUAL_REQUIRED",
      reasons: ["PROJECT_POLICY_MANUAL"],
      version: "1",
    });
  });

  it("re-evaluates MANUAL to AUTOMATIC and invalidates eligibility when the Proposal becomes stale", async () => {
    await asActor(humanActorId, async (trx) => {
      await sql`select * from memoid.change_project_review_policy(${projectId}::uuid,1,'AUTOMATIC',null)`.execute(
        trx,
      );
    });
    const current = await asActor(workerActorId, (trx) =>
      sql<{
        decision: string;
        version: string;
        current: boolean;
      }>`select evaluation.decision,evaluation.project_policy_version::text version,memoid.review_policy_evaluation_is_current(${projectId}::uuid,evaluation.id) current from memoid.review_policy_evaluations evaluation join memoid.review_policy_current_states state on state.evaluation_id=evaluation.id where evaluation.proposal_item_id=${itemId}::uuid`.execute(
        trx,
      ),
    );
    expect(current.rows[0]).toEqual({
      decision: "AUTOMATIC_ELIGIBLE",
      version: "2",
      current: true,
    });
    await sql`update memoid.proposal_item_current_states set lifecycle_state='STALE',reason='TEST_BASIS_ADVANCED',version=version+1,changed_at=clock_timestamp() where proposal_item_id=${itemId}::uuid`.execute(
      isolated.db,
    );
    const actionable = await asActor(workerActorId, (trx) =>
      sql<{
        current: boolean;
      }>`select memoid.review_policy_evaluation_is_current(${projectId}::uuid,evaluation_id) current from memoid.review_policy_current_states where proposal_item_id=${itemId}::uuid`.execute(
        trx,
      ),
    );
    expect(actionable.rows[0]!.current).toBe(false);
    const stale = await asActor(
      workerActorId,
      async (trx) =>
        (
          await sql<{
            id: string;
          }>`select memoid.evaluate_proposal_item_review_policy(${projectId}::uuid,${itemId}::uuid)::text id`.execute(
            trx,
          )
        ).rows[0]!.id,
    );
    const staleRow = (
      await sql<{
        decision: string;
        reasons: string[];
      }>`select decision,reason_codes reasons from memoid.review_policy_evaluations where id=${stale}::uuid`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(staleRow).toEqual({ decision: "MANUAL_REQUIRED", reasons: ["PROPOSAL_STALE"] });
  });

  it("protects Conflict under AUTOMATIC and keeps the eligible sibling independent", async () => {
    const protectedItem = await seedItem("CONFLICTING", true, false, false, "conflict");
    const id = await asActor(
      workerActorId,
      async (trx) =>
        (
          await sql<{
            id: string;
          }>`select memoid.evaluate_proposal_item_review_policy(${projectId}::uuid,${protectedItem}::uuid)::text id`.execute(
            trx,
          )
        ).rows[0]!.id,
    );
    const row = (
      await sql<{
        decision: string;
        reasons: string[];
      }>`select decision,reason_codes reasons from memoid.review_policy_evaluations where id=${id}::uuid`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(row).toEqual({ decision: "MANUAL_REQUIRED", reasons: ["PROTECTED_CONFLICT"] });
  });

  it("re-evaluates current automatic eligibility when AUTOMATIC transitions to MANUAL", async () => {
    const currentItem = await seedItem("CHANGED", false, false, false, "automatic-to-manual");
    const automaticId = await asActor(
      workerActorId,
      async (trx) =>
        (
          await sql<{
            id: string;
          }>`select memoid.evaluate_proposal_item_review_policy(${projectId}::uuid,${currentItem}::uuid)::text id`.execute(
            trx,
          )
        ).rows[0]!.id,
    );
    expect(
      (
        await sql<{
          decision: string;
        }>`select decision from memoid.review_policy_evaluations where id=${automaticId}::uuid`.execute(
          isolated.db,
        )
      ).rows[0]!.decision,
    ).toBe("AUTOMATIC_ELIGIBLE");
    await asActor(humanActorId, async (trx) => {
      await sql`select * from memoid.change_project_review_policy(${projectId}::uuid,2,'MANUAL',null)`.execute(
        trx,
      );
    });
    const manual = (
      await sql<{
        decision: string;
        version: string;
        reasons: string[];
      }>`select evaluation.decision,evaluation.project_policy_version::text version,evaluation.reason_codes reasons from memoid.review_policy_evaluations evaluation join memoid.review_policy_current_states state on state.evaluation_id=evaluation.id where evaluation.proposal_item_id=${currentItem}::uuid`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(manual).toEqual({
      decision: "MANUAL_REQUIRED",
      version: "3",
      reasons: ["PROJECT_POLICY_MANUAL"],
    });
  });

  it("serializes two concurrent policy transitions without a lost update", async () => {
    const transition = async (policy: "MANUAL" | "AUTOMATIC") =>
      asActor(humanActorId, async (trx) =>
        sql`select * from memoid.change_project_review_policy(${projectId}::uuid,3,${policy}::varchar,null)`.execute(
          trx,
        ),
      );
    const results = await Promise.allSettled([transition("AUTOMATIC"), transition("MANUAL")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const versions = (
      await sql<{
        count: string;
        maximum: string;
      }>`select count(*) filter(where version=4)::text count,max(version)::text maximum from memoid.project_review_policy_versions where project_id=${projectId}::uuid`.execute(
        isolated.db,
      )
    ).rows[0];
    expect(versions).toEqual({ count: "1", maximum: "4" });
  });
});
