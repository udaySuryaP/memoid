import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ContractScenario {
  id: string;
  owners: string[];
  required: string;
  forbidden: string;
  input?: unknown;
}

interface Stage9dContract {
  schemaVersion: number;
  status: string;
  stage10Authorized: boolean;
  exactRepresentationProofGated: boolean;
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
  scenarios: ContractScenario[];
}

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

async function loadContract(): Promise<Stage9dContract> {
  return JSON.parse(
    await read("../../docs/implementation/stage9d-implementation-contract.json"),
  ) as Stage9dContract;
}

const scenarioIds = [
  "CHECKPOINT_IS_NOT_BLANKET_CONFIRMATION",
  "AI_CONFIDENCE_CANNOT_APPROVE",
  "CANDIDATE_GAP_49",
  "SOURCE_LOST_WAKEUP_105_106",
  "MODEL_OUTAGE_AFTER_ACCEPTED_CHECKPOINT",
  "CONCURRENT_POLICY_OR_FRONTIER_CHANGE",
  "MANUAL_TO_AUTOMATIC_WITH_BACKLOG",
  "AUTOMATIC_TO_MANUAL",
  "FIFTY_PUSH_BURST",
  "NON_DEFAULT_BRANCH_ASSERTION",
  "MISSING_DELAYED_WEBHOOK",
] as const;

describe("Stage 9D implementation contract", () => {
  it("keeps Stage 10 blocked and the four integrity planes distinct", async () => {
    const contract = await loadContract();

    expect(contract.schemaVersion).toBe(1);
    expect(contract.status).toBe("IMPLEMENTATION_CONTRACT_ONLY");
    expect(contract.stage10Authorized).toBe(false);
    expect(contract.exactRepresentationProofGated).toBe(true);
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
    const contract = await loadContract();

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

  it("preserves review-policy defaults, transitions, and current-basis checks", async () => {
    const contract = await loadContract();

    expect(contract.reviewPolicy.allowed).toEqual(["MANUAL", "AUTOMATIC"]);
    expect(contract.reviewPolicy.defaultWhenMissingOrLegacy).toBe("MANUAL");
    expect(contract.reviewPolicy.creationPresentsChoice).toBe(true);
    expect(Object.values(contract.reviewPolicy.change).every(Boolean)).toBe(true);
    expect(
      contract.scenarios.find(({ id }) => id === "MANUAL_TO_AUTOMATIC_WITH_BACKLOG"),
    ).toMatchObject({
      forbidden: "SILENT_MASS_ACCEPTANCE",
    });
    expect(
      contract.scenarios.find(({ id }) => id === "CONCURRENT_POLICY_OR_FRONTIER_CHANGE"),
    ).toMatchObject({
      required: "RE_READ_CURRENT_BASIS_ABORT_STALE_AUTO_ACCEPT_AND_REEVALUATE",
    });
  });

  it("locks gap-preserving Candidate and lost-wakeup Source frontier semantics", async () => {
    const contract = await loadContract();

    expect(contract.candidateFrontier.reconciled).toContain("CONTIGUOUS");
    expect(contract.candidateFrontier.forbidden).toBe("MAX_SEQUENCE_PROCESSED_WHEN_GAPS_EXIST");
    expect(contract.sourceFrontiers).toEqual([
      "OBSERVED_OR_DESIRED",
      "INGESTED",
      "RECONCILED",
      "REVIEWED_CONTEXT_SOURCE_COVERAGE",
    ]);
    expect(contract.reviewedSourceCoverage).toBe("VECTOR_MAP_OR_RECORD_LEVEL_RELATIONSHIP");
    expect(contract.scenarios.find(({ id }) => id === "CANDIDATE_GAP_49")).toMatchObject({
      required: "CONTIGUOUS_WATERMARK_48_WITH_EXPLICIT_LATER_COMPLETION_50",
    });
    expect(contract.scenarios.find(({ id }) => id === "SOURCE_LOST_WAKEUP_105_106")).toMatchObject({
      required: "DURABLE_FOLLOW_UP_FOR_106_BEFORE_QUIESCENCE",
    });
  });

  it("keeps deterministic pending continuity available through provider failure", async () => {
    const contract = await loadContract();

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
    expect(
      contract.scenarios.find(({ id }) => id === "MODEL_OUTAGE_AFTER_ACCEPTED_CHECKPOINT"),
    ).toMatchObject({
      required: "SAFE_PENDING_UNRECONCILED_LOWER_TRUST_CONTINUITY_REMAINS_RESUMABLE",
    });
  });

  it("preserves GitHub signal, catch-up, branch, burst, and gate-class boundaries", async () => {
    const contract = await loadContract();

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
    expect(contract.scenarios.map(({ id }) => id)).toEqual(scenarioIds);
    expect(new Set(contract.scenarios.flatMap(({ owners }) => owners))).toEqual(
      new Set([
        "10A",
        "10B",
        "10D",
        "10E",
        "10F",
        "10G",
        "10H",
        "10J",
        "10L",
        "10M",
        "10O",
        "10P",
        "10T",
      ]),
    );
  });

  it("keeps repository entry guidance aligned with the Stage 9D gate", async () => {
    const [readme, agents, governance, map] = await Promise.all([
      read("../../README.md"),
      read("../../AGENTS.md"),
      read("../../docs/governance/repository.md"),
      read("../../docs/implementation/stage10-entry-map.md"),
    ]);

    for (const guidance of [readme, agents, governance]) {
      expect(guidance).toContain("Stage 9D");
      expect(guidance).toContain("Stage 10/10A");
      expect(guidance).toContain("BLOCKED UNTIL STAGE 9D HQ RECONCILIATION");
      expect(guidance).not.toContain("Stage 9B **ACTIVE");
    }
    expect(map).toContain("Candidate Reconciled Frontier");
    expect(map).toContain("checkpoint request authorizes submission");
    expect(map).toContain("does not authorize Stage 10");
  });
});
