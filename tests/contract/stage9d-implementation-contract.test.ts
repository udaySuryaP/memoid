import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ContractScenario {
  id: string;
  key: string;
  scenario: string;
  detection: string;
  requiredBehavior: string;
  userVisibleBehavior: string;
  recovery: string;
  idempotencyConcurrency: string;
  auditExpectation: string;
  owners: string[];
  requiredProof: string;
  mechanismStatus: string;
}

interface FailureRaceContract {
  schemaVersion: number;
  canonicalBaseline: string;
  artifactRole: string;
  scenarioCount: number;
  validOwners: string[];
  scenarios: ContractScenario[];
}

interface Stage9dContract {
  schemaVersion: number;
  status: string;
  synchronizedBaseline: string;
  executionAuthorization: {
    ownedBy: string;
    repositoryMayAuthorizeWorkstream: boolean;
    mustVerifyBeforeImplementation: boolean;
    stage10EntryMapDefinesGatesNotLiveAuthorization: boolean;
  };
  exactRepresentationProofGated: boolean;
  failureRaceContract: { path: string; canonicalScenarioCount: number };
  primaryLoop: string[];
  integrityPlanes: Array<{ id: string; trustedOnReceipt: boolean; qualification: string[] }>;
  candidateOriginClasses: string[];
  checkpoint: { means: string; doesNotMean: string; rawTranscriptDefault: boolean };
  reviewPolicy: {
    allowed: string[];
    defaultWhenMissingOrLegacy: string;
    creationPresentsChoice: boolean;
    modelMayApprove: boolean;
    change: Record<string, boolean>;
    protectedAutomaticClasses: string[];
  };
  sourceFrontiers: string[];
  reviewedSourceCoverage: string;
  candidateFrontier: { intake: string; reconciled: string; forbidden: string };
  engine: Record<string, string | boolean>;
  deterministicCandidateIntakeBeforeModel: string[];
  github: Record<string, string | boolean | string[]>;
  gateClasses: Record<string, string>;
}

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

async function loadStage9dContract(): Promise<Stage9dContract> {
  return JSON.parse(
    await read("../../docs/implementation/stage9d-implementation-contract.json"),
  ) as Stage9dContract;
}

async function loadFailureRaceContract(): Promise<FailureRaceContract> {
  return JSON.parse(
    await read("../../docs/implementation/stage9c-failure-race-contract.json"),
  ) as FailureRaceContract;
}

const byKey = (contract: FailureRaceContract, key: string) =>
  contract.scenarios.find((scenario) => scenario.key === key);

describe("Stage 9D implementation contract", () => {
  it("keeps durable repository contract separate from live HQ authorization", async () => {
    const contract = await loadStage9dContract();

    expect(contract.schemaVersion).toBe(2);
    expect(contract.status).toBe("IMPLEMENTATION_CONTRACT_ONLY");
    expect(contract.synchronizedBaseline).toBe("HQ_RECONCILED_STAGE_9C");
    expect(contract.executionAuthorization).toEqual({
      ownedBy: "CANONICAL_HQ_PROJECT_STATE",
      repositoryMayAuthorizeWorkstream: false,
      mustVerifyBeforeImplementation: true,
      stage10EntryMapDefinesGatesNotLiveAuthorization: true,
    });
    expect(contract.failureRaceContract).toEqual({
      path: "docs/implementation/stage9c-failure-race-contract.json",
      canonicalScenarioCount: 83,
    });
  });

  it("keeps the four integrity planes distinct", async () => {
    const contract = await loadStage9dContract();

    expect(contract.integrityPlanes.map(({ id }) => id)).toEqual([
      "SOURCE_OBSERVATION",
      "CANDIDATE_SUBMISSION",
      "WORKING_CONTEXT",
      "REVIEWED_DURABLE_CONTEXT",
    ]);
    expect(new Set(contract.integrityPlanes.map(({ id }) => id)).size).toBe(4);
    expect(contract.integrityPlanes.every(({ trustedOnReceipt }) => !trustedOnReceipt)).toBe(true);
  });

  it("separates checkpoint consent, assertion origin, and automatic eligibility", async () => {
    const contract = await loadStage9dContract();

    expect(contract.candidateOriginClasses).toEqual([
      "EXPLICIT_USER_AUTHORED_OR_SUFFICIENTLY_CONFIRMED",
      "AI_INFERRED",
      "SOURCE_OR_SYSTEM_DERIVED",
    ]);
    expect(contract.checkpoint.means).toBe("SUBMIT_EXTRACTED_CHECKPOINT");
    expect(contract.checkpoint.doesNotMean).toBe("USER_CONFIRMS_EVERY_EXTRACTED_ASSERTION");
    expect(contract.checkpoint.rawTranscriptDefault).toBe(false);
    expect(contract.reviewPolicy.modelMayApprove).toBe(false);
    expect(contract.reviewPolicy.protectedAutomaticClasses).toContain(
      "INSUFFICIENT_ORIGIN_EVIDENCE_OR_PROVENANCE",
    );
    expect(contract.reviewPolicy.protectedAutomaticClasses).toContain(
      "NOT_POSITIVELY_PROVEN_ELIGIBLE",
    );
  });

  it("preserves review-policy and frontier invariants", async () => {
    const contract = await loadStage9dContract();

    expect(contract.reviewPolicy.allowed).toEqual(["MANUAL", "AUTOMATIC"]);
    expect(contract.reviewPolicy.defaultWhenMissingOrLegacy).toBe("MANUAL");
    expect(contract.reviewPolicy.creationPresentsChoice).toBe(true);
    expect(Object.values(contract.reviewPolicy.change).every(Boolean)).toBe(true);
    expect(contract.candidateFrontier.reconciled).toContain("CONTIGUOUS");
    expect(contract.candidateFrontier.forbidden).toBe("MAX_SEQUENCE_PROCESSED_WHEN_GAPS_EXIST");
    expect(contract.sourceFrontiers).toEqual([
      "OBSERVED_OR_DESIRED",
      "INGESTED",
      "RECONCILED",
      "REVIEWED_CONTEXT_SOURCE_COVERAGE",
    ]);
    expect(contract.reviewedSourceCoverage).toBe("VECTOR_MAP_OR_RECORD_LEVEL_RELATIONSHIP");
  });

  it("keeps deterministic pending continuity and GitHub boundaries", async () => {
    const contract = await loadStage9dContract();

    expect(contract.engine).toMatchObject({
      architecture: "DETERMINISTIC_PLUS_MODEL_ASSISTED",
      modelTrusted: false,
      providerNeutralPort: true,
      reconciliationAndResumeSeparate: true,
      wholeRepositoryToModel: false,
      embeddingsInitially: false,
    });
    expect(contract.deterministicCandidateIntakeBeforeModel).toEqual([
      "AUTHORIZATION",
      "EXACT_PROJECT_BINDING",
      "PAYLOAD_VALIDATION",
      "SECRET_SCANNING",
      "SIZE_ENFORCEMENT",
      "NORMALIZATION_AND_MINIMIZATION",
      "SAFE_PENDING_QUALIFICATION",
    ]);
    expect(contract.github).toMatchObject({
      role: "COMPLEMENTARY_AUTHORITATIVE_SOURCE",
      webhookPayload: "SIGNAL_NOT_AUTHORITATIVE_SEMANTIC_MUTATION",
      stableIdentity: "PROVIDER_REPOSITORY_ID",
      externalClientMayTriggerRefresh: false,
      serverCatchUpRequired: true,
      commitCountEqualsSemanticChangeCount: false,
    });
    expect(contract.gateClasses.A).toContain("10A_SCHEMA_OR_DOMAIN_COMMITMENT");
    expect(contract.gateClasses.B).toBe("BEFORE_NAMED_AFFECTED_VERTICAL");
  });
});

describe("complete Stage 9C failure/race contract", () => {
  it("contains exactly 83 unique canonical scenarios with complete required fields", async () => {
    const contract = await loadFailureRaceContract();
    const ids = contract.scenarios.map(({ id }) => id);

    expect(contract.canonicalBaseline).toBe("HQ_RECONCILED_STAGE_9C");
    expect(contract.scenarioCount).toBe(83);
    expect(contract.scenarios).toHaveLength(83);
    expect(new Set(ids).size).toBe(83);
    expect(ids).toEqual(
      Array.from({ length: 83 }, (_, index) => `S9C-FR-${String(index + 1).padStart(3, "0")}`),
    );

    for (const scenario of contract.scenarios) {
      expect(scenario.key.trim()).not.toBe("");
      expect(scenario.scenario.trim()).not.toBe("");
      expect(scenario.detection.trim()).not.toBe("");
      expect(scenario.requiredBehavior.trim()).not.toBe("");
      expect(scenario.userVisibleBehavior.trim()).not.toBe("");
      expect(scenario.recovery.trim()).not.toBe("");
      expect(scenario.idempotencyConcurrency.trim()).not.toBe("");
      expect(scenario.auditExpectation.trim()).not.toBe("");
      expect(scenario.owners.length).toBeGreaterThan(0);
      expect(scenario.requiredProof.trim()).not.toBe("");
      expect(scenario.mechanismStatus).toBe("SEMANTICS_LOCKED_MECHANISM_PROOF_GATED");

      for (const owner of scenario.owners) {
        expect(contract.validOwners).toContain(owner);
      }
    }
  });

  it("preserves controlling checkpoint, policy, frontier, outage and branch semantics", async () => {
    const contract = await loadFailureRaceContract();

    expect(byKey(contract, "CHECKPOINT_IS_NOT_BLANKET_CONFIRMATION")?.requiredBehavior).toContain(
      "not 'the user confirms every extracted fact'",
    );
    expect(byKey(contract, "AI_INFERRED_HIGH_CONFIDENCE_CANNOT_APPROVE")?.requiredBehavior).toContain(
      "Model confidence/classification/checkpoint invocation alone never proves eligibility",
    );
    expect(byKey(contract, "CANDIDATE_RECONCILIATION_GAP")?.requiredBehavior).toContain(
      "highest contiguous stable disposition (48)",
    );
    expect(byKey(contract, "PUSH_DURING_SOURCE_WORKER")?.requiredBehavior).toContain(
      "durably require follow-up processing",
    );
    expect(byKey(contract, "MODEL_OUTAGE_AFTER_ACCEPTED_CHECKPOINT")?.requiredBehavior).toContain(
      "recent work does not disappear",
    );
    expect(byKey(contract, "POLICY_OR_FRONTIER_CHANGE_BEFORE_AUTO_COMMIT")?.requiredBehavior).toContain(
      "Abort stale automatic acceptance",
    );
    expect(byKey(contract, "MANUAL_TO_AUTOMATIC_WITH_BACKLOG")?.requiredBehavior).toContain(
      "no silent mass acceptance",
    );
    expect(byKey(contract, "NON_DEFAULT_BRANCH_ASSERTION")?.requiredBehavior).toContain(
      "must not silently replace current default-branch implementation truth",
    );
    expect(byKey(contract, "EXTERNAL_AI_ATTEMPTS_SOURCE_REFRESH")?.requiredBehavior).toContain(
      "Source catch-up remains Memoid/server-controlled",
    );
  });

  it("preserves degraded Resume, revocation, deletion and archive fencing semantics", async () => {
    const contract = await loadFailureRaceContract();

    expect(byKey(contract, "RESUME_WHILE_MODEL_DEGRADED")?.userVisibleBehavior).toContain(
      "recent work does not disappear",
    );
    expect(byKey(contract, "WORKING_VS_REVIEWED_CONFLICT")?.requiredBehavior).toContain(
      "cannot silently replace Reviewed Durable Context",
    );
    expect(byKey(contract, "WORKING_VS_SOURCE_CONFLICT")?.requiredBehavior).toContain(
      "Authoritative Source evidence wins",
    );
    expect(byKey(contract, "PROJECT_GRANT_REVOKED_MID_REQUEST")?.requiredBehavior).toContain(
      "Fail closed before side effect",
    );
    expect(byKey(contract, "DELETE_PENDING_WITH_NEW_WRITES")?.requiredBehavior).toContain(
      "Fence new writes",
    );
    expect(byKey(contract, "ARCHIVE_FENCES_QUEUED_WORK")?.requiredBehavior).toContain(
      "Fence or reauthorize queued/mid-flight work",
    );
  });
});
