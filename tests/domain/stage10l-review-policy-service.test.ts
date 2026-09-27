import {
  ReviewPolicyService,
  type ReviewPolicyRepository,
} from "../../packages/application/src/review-policy.js";
import type { WorkspaceProjectContext } from "../../packages/application/src/workspace-project.js";
import type {
  ActorId,
  ChangeProposalItemId,
  ProjectId,
  WorkspaceId,
  AccountId,
} from "../../packages/domain/src/identifiers.js";
import { describe, expect, it, vi } from "vitest";

const accountId = "01999999-0000-7000-8000-000000000001" as AccountId;
const workspaceId = "01999999-0000-7000-8000-000000000002" as WorkspaceId;
const projectId = "01999999-0000-7000-8000-000000000003" as ProjectId;
const actorId = "01999999-0000-7000-8000-000000000004" as ActorId;
const itemId = "01999999-0000-7000-8000-000000000005" as ChangeProposalItemId;
const repository = (): ReviewPolicyRepository => ({
  findProjectState: vi.fn(async () => "ACTIVE" as const),
  evaluateItem: vi.fn(async () => ({
    evaluationId: "e",
    proposalItemId: itemId,
    projectPolicyVersion: 1,
    projectPolicy: "MANUAL" as const,
    decision: "MANUAL_REQUIRED" as const,
    reasonCodes: ["PROJECT_POLICY_MANUAL" as const],
    engineVersion: "review-policy.v1",
    basisHash: "00",
    current: true,
    supersedesEvaluationId: null,
    evaluatedAt: new Date(0).toISOString(),
  })),
  evaluateProposal: vi.fn(),
  revalidateProject: vi.fn(),
  getCurrent: vi.fn(),
  getHistory: vi.fn(),
  changeProjectPolicy: vi.fn(async (_c, _p, _v, policy) => ({
    version: 2,
    policy,
    effectiveAt: new Date(0).toISOString(),
  })),
  close: vi.fn(),
});
const context = (
  kind: "HUMAN" | "WORKER" | "DEVELOPER_CLIENT",
  fresh = true,
): WorkspaceProjectContext => ({
  accountId,
  workspaceId,
  sessionCredentialHash: new Uint8Array(32),
  freshAuthenticationSatisfied: fresh,
  principal:
    kind === "HUMAN"
      ? {
          kind,
          id: "owner",
          accountId,
          active: true,
          sessionRevoked: false,
          roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER", workspaceId }],
        }
      : kind === "WORKER"
        ? {
            kind,
            id: "worker",
            boundActorId: actorId,
            active: true,
            sessionRevoked: false,
            roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER", workspaceId }],
          }
        : {
            kind,
            id: "external",
            active: true,
            sessionRevoked: false,
            roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER", workspaceId }],
          },
  actor: {
    id: actorId,
    kind: kind === "HUMAN" ? "HUMAN" : kind === "WORKER" ? "MEMOID_WORKER" : "DEVELOPER_CLIENT",
    reference:
      kind === "HUMAN"
        ? `account:${accountId}`
        : kind === "WORKER"
          ? "worker:worker"
          : "client:external",
  },
});

describe("Stage 10L application authorization", () => {
  it("allows only Memoid worker/system evaluation", async () => {
    const service = new ReviewPolicyService(repository());
    await expect(service.evaluateItem(context("WORKER"), projectId, itemId)).resolves.toMatchObject(
      { decision: "MANUAL_REQUIRED" },
    );
    await expect(service.evaluateItem(context("HUMAN"), projectId, itemId)).rejects.toThrow(
      "REVIEW_POLICY_INTERNAL_OPERATION_REQUIRED",
    );
  });
  it("keeps policy transition first-party, human, and fresh-authenticated", async () => {
    const service = new ReviewPolicyService(repository());
    await expect(
      service.changeProjectPolicy(context("HUMAN"), projectId, 1, "AUTOMATIC"),
    ).resolves.toMatchObject({ version: 2 });
    await expect(
      service.changeProjectPolicy(context("HUMAN", false), projectId, 1, "AUTOMATIC"),
    ).rejects.toThrow("REVIEW_POLICY_DENIED");
    await expect(
      service.changeProjectPolicy(context("DEVELOPER_CLIENT"), projectId, 1, "AUTOMATIC"),
    ).rejects.toThrow("REVIEW_POLICY_HUMAN_CONTROL_REQUIRED");
  });
});
