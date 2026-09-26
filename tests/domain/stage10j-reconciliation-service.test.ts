import { describe, expect, it, vi } from "vitest";
import {
  ReconciliationProviderError,
  ReconciliationService,
  type ReconciliationModelProvider,
  type ReconciliationRepository,
} from "../../packages/application/src/reconciliation.js";
import type { WorkspaceProjectContext } from "../../packages/application/src/workspace-project.js";
import type {
  ActorId,
  CandidateAssertionId,
  ContextIdentityId,
  EvidenceReferenceId,
  ProjectId,
  SourceId,
  WorkspaceId,
  AccountId,
} from "../../packages/domain/src/identifiers.js";
import {
  stableAssertionHash,
  type ModelConfiguration,
  type ReconciliationBasis,
} from "../../packages/domain/src/reconciliation.js";

const projectId = "01990000-0000-7000-8000-000000000001" as ProjectId;
const evidenceId = "01990000-0000-7000-8000-000000000002" as EvidenceReferenceId;
const sourceId = "01990000-0000-7000-8000-000000000008" as SourceId;
const basis: ReconciliationBasis = {
  projectId,
  candidateAssertionId: "01990000-0000-7000-8000-000000000003" as CandidateAssertionId,
  contextIdentityId: "01990000-0000-7000-8000-000000000004" as ContextIdentityId,
  currentContextRecordId: null,
  currentContextVersion: 0,
  workingContextVersion: 0,
  authorityVersion: 1,
  evidenceFrontierVersion: 1,
  integrityVersion: 0,
  engineContractVersion: "10j.v1",
};
const context = {
  accountId: "01990000-0000-7000-8000-000000000005" as AccountId,
  workspaceId: "01990000-0000-7000-8000-000000000006" as WorkspaceId,
  sessionCredentialHash: new Uint8Array(32),
  principal: {
    kind: "HUMAN" as const,
    id: "user-stage10j",
    accountId: "01990000-0000-7000-8000-000000000005" as AccountId,
    active: true,
    sessionRevoked: false,
    roleAssignments: [
      {
        role: "PERSONAL_WORKSPACE_OWNER" as const,
        workspaceId: "01990000-0000-7000-8000-000000000006" as WorkspaceId,
      },
    ],
  },
  actor: {
    id: "01990000-0000-7000-8000-000000000007" as ActorId,
    kind: "HUMAN" as const,
    reference: "account:01990000-0000-7000-8000-000000000005",
  },
} satisfies WorkspaceProjectContext;
const model: ModelConfiguration = {
  providerId: "primary",
  modelId: "proof-model",
  configurationVersion: "v1",
  privacyClass: "PRIVATE",
  fallbackAllowlist: [],
  pricingVersion: "test",
  inputPerMillionMicrounits: 1_000_000,
  outputPerMillionMicrounits: 1_000_000,
};
const packetBudget = {
  maxEvidence: 2,
  maxWorkingContext: 2,
  maxCharactersPerItem: 500,
  maxSerializedBytes: 20_000,
  maxHistoryDepth: 2,
};

function repository(current: Readonly<Record<string, unknown>> | null = { value: "old" }) {
  const recordInvocation = vi.fn(async () => undefined);
  const commit = vi.fn(async (_context, _material, result) => ({
    reconciliationId: result.classification,
    workingContextItemId: null,
    replayed: false,
  }));
  const value: ReconciliationRepository = {
    findProjectState: async () => "ACTIVE",
    loadMaterial: async () => ({
      comparison: {
        semanticIdentity: "project/architecture/implementation_state:code/database",
        candidateAssertion: { value: "new" },
        candidateHash: stableAssertionHash({ value: "new" }),
        duplicateCandidate: false,
        currentAssertion: current,
        currentHash: current ? stableAssertionHash(current) : null,
        currentIsKnownHistorical: false,
        authorityQualification: "EFFECTIVE",
        evidenceRequired: true,
        evidenceReferenceIds: [evidenceId],
        activeConflict: false,
        activeUncertainty: false,
      },
      basis,
      workingContext: [],
      evidence: [
        {
          evidenceReferenceId: evidenceId,
          sourceId,
          contentClassification: "PUBLIC_PROJECT_TEXT",
          content: "database is new",
          authorityQualification: "EFFECTIVE",
        },
      ],
    }),
    recordInvocation,
    commit,
    close: async () => undefined,
  };
  return { value, recordInvocation, commit };
}

describe("Stage 10J reconciliation service", () => {
  it("commits deterministic NEW without invoking a model", async () => {
    const repo = repository(null);
    const provider = {
      providerId: "primary",
      invoke: vi.fn(),
    } satisfies ReconciliationModelProvider;
    const result = await new ReconciliationService(
      repo.value,
      new Map([["primary", provider]]),
    ).reconcile(context, {
      projectId,
      candidateAssertionId: basis.candidateAssertionId,
      model,
      packetBudget,
      maxAttempts: 2,
    });
    expect(result.reconciliationId).toBe("NEW");
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(repo.recordInvocation).not.toHaveBeenCalled();
  });

  it("validates, accounts, and commits a model-assisted result", async () => {
    const repo = repository();
    const provider: ReconciliationModelProvider = {
      providerId: "primary",
      invoke: async () => ({
        output: {
          classification: "CHANGED",
          semanticIdentity: "project/architecture/implementation_state:code/database",
          normalizedAssertion: { value: "new" },
          evidenceReferenceIds: [evidenceId],
          conflict: false,
          uncertain: false,
          reasonCodes: ["MODEL_SEMANTIC_COMPARISON"],
          justification: "changed",
        },
        usage: { inputUnits: 10, outputUnits: 5, totalUnits: 15 },
        latencyMs: 20,
        refusal: false,
      }),
    };
    const result = await new ReconciliationService(
      repo.value,
      new Map([["primary", provider]]),
    ).reconcile(context, {
      projectId,
      candidateAssertionId: basis.candidateAssertionId,
      model,
      packetBudget,
      maxAttempts: 1,
    });
    expect(result.reconciliationId).toBe("CHANGED");
    expect(repo.recordInvocation).toHaveBeenCalledWith(
      context,
      projectId,
      basis,
      expect.objectContaining({
        providerId: "primary",
        modelId: "proof-model",
        estimatedCostMicrounits: 15,
        succeeded: true,
      }),
    );
  });

  it("retries only retryable failures and accounts every attempt", async () => {
    const repo = repository();
    let calls = 0;
    const provider: ReconciliationModelProvider = {
      providerId: "primary",
      invoke: async () => {
        calls += 1;
        if (calls === 1) throw new ReconciliationProviderError("RATE_LIMITED", true);
        return {
          output: {
            classification: "CHANGED",
            semanticIdentity: "project/architecture/implementation_state:code/database",
            normalizedAssertion: { value: "new" },
            evidenceReferenceIds: [evidenceId],
            conflict: false,
            uncertain: false,
            reasonCodes: ["MODEL_SEMANTIC_COMPARISON"],
            justification: null,
          },
          usage: { inputUnits: 3, outputUnits: 2, totalUnits: 5 },
          latencyMs: 4,
          refusal: false,
        };
      },
    };
    await new ReconciliationService(repo.value, new Map([["primary", provider]])).reconcile(
      context,
      {
        projectId,
        candidateAssertionId: basis.candidateAssertionId,
        model,
        packetBudget,
        maxAttempts: 2,
      },
    );
    expect(calls).toBe(2);
    expect(repo.recordInvocation).toHaveBeenCalledTimes(2);
  });

  it("accounts malformed structured output once with its observed usage", async () => {
    const repo = repository();
    const provider: ReconciliationModelProvider = {
      providerId: "primary",
      invoke: async () => ({
        output: { classification: "INJECTED" },
        usage: { inputUnits: 9, outputUnits: 4, totalUnits: 13 },
        latencyMs: 8,
        refusal: false,
      }),
    };
    await expect(
      new ReconciliationService(repo.value, new Map([["primary", provider]])).reconcile(context, {
        projectId,
        candidateAssertionId: basis.candidateAssertionId,
        model,
        packetBudget,
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION", retryable: false });
    expect(repo.recordInvocation).toHaveBeenCalledTimes(1);
    expect(repo.recordInvocation).toHaveBeenCalledWith(
      context,
      projectId,
      basis,
      expect.objectContaining({
        succeeded: false,
        failureCode: "SCHEMA_VALIDATION",
        inputUnits: 9,
        outputUnits: 4,
        totalUnits: 13,
        latencyMs: 8,
      }),
    );
  });

  it("rejects privacy-incompatible fallback before switching providers", async () => {
    const repo = repository();
    const primary: ReconciliationModelProvider = {
      providerId: "primary",
      invoke: async () => {
        throw new ReconciliationProviderError("PROVIDER_UNAVAILABLE", true);
      },
    };
    const fallback: ReconciliationModelProvider = { providerId: "fallback", invoke: vi.fn() };
    await expect(
      new ReconciliationService(
        repo.value,
        new Map([
          ["primary", primary],
          ["fallback", fallback],
        ]),
      ).reconcile(context, {
        projectId,
        candidateAssertionId: basis.candidateAssertionId,
        model: {
          ...model,
          fallbackAllowlist: [
            { providerId: "fallback", modelId: "fallback-model", privacyClass: "PUBLIC" },
          ],
        },
        packetBudget,
        maxAttempts: 1,
      }),
    ).rejects.toThrow("privacy class mismatch");
    expect(fallback.invoke).not.toHaveBeenCalled();
  });
});
