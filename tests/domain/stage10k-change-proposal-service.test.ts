import { describe, expect, it, vi } from "vitest";
import {
  ChangeProposalService,
  type ChangeProposalRepository,
} from "../../packages/application/src/change-proposal.js";
import type { WorkspaceProjectContext } from "../../packages/application/src/workspace-project.js";
import type {
  AccountId,
  ActorId,
  ChangeProposalId,
  ProjectId,
  ReconciliationId,
  WorkspaceId,
} from "../../packages/domain/src/identifiers.js";

const accountId = "01990000-0000-7000-8000-000000000001" as AccountId;
const workspaceId = "01990000-0000-7000-8000-000000000002" as WorkspaceId;
const projectId = "01990000-0000-7000-8000-000000000003" as ProjectId;
const actorId = "01990000-0000-7000-8000-000000000004" as ActorId;
const reconciliationId = "01990000-0000-7000-8000-000000000005" as ReconciliationId;
const proposalId = "01990000-0000-7000-8000-000000000006" as ChangeProposalId;

const owner = {
  accountId,
  workspaceId,
  sessionCredentialHash: new Uint8Array(32),
  principal: {
    kind: "HUMAN" as const,
    id: "owner",
    accountId,
    active: true,
    sessionRevoked: false,
    roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId }],
  },
  actor: { id: actorId, kind: "HUMAN" as const, reference: `account:${accountId}` },
} satisfies WorkspaceProjectContext;
const worker = {
  ...owner,
  principal: {
    kind: "WORKER" as const,
    id: "proposal-worker",
    boundActorId: actorId,
    active: true,
    sessionRevoked: false,
    roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId }],
  },
  actor: { id: actorId, kind: "MEMOID_WORKER" as const, reference: "worker:proposal" },
} satisfies WorkspaceProjectContext;

function repository(state: "ACTIVE" | "ARCHIVED" | null = "ACTIVE") {
  const materialize = vi.fn(async () => null);
  const listBacklog = vi.fn(async () => []);
  const getProposal = vi.fn(async () => null);
  const value: ChangeProposalRepository = {
    findProjectState: async () => state,
    materialize,
    refreshCurrentness: async () => 0,
    listBacklog,
    getProposal,
    close: async () => undefined,
  };
  return { value, materialize, listBacklog, getProposal };
}

describe("Stage 10K Change Proposal service boundary", () => {
  it("permits an authorized internal materialization operation", async () => {
    const repo = repository();
    await new ChangeProposalService(repo.value).materializeFromReconciliation(
      worker,
      projectId,
      reconciliationId,
    );
    expect(repo.materialize).toHaveBeenCalledOnce();
  });

  it("does not expose the internal materializer to a human owner", async () => {
    await expect(
      new ChangeProposalService(repository().value).materializeFromReconciliation(
        owner,
        projectId,
        reconciliationId,
      ),
    ).rejects.toThrow("CHANGE_PROPOSAL_INTERNAL_OPERATION_REQUIRED");
  });

  it("allows an integration principal to inspect but not materialize", async () => {
    const integration = {
      ...owner,
      principal: {
        kind: "INTEGRATION" as const,
        id: "reader",
        active: true,
        sessionRevoked: false,
        roleAssignments: [{ role: "INTEGRATION_BASE" as const, workspaceId }],
      },
      actor: { id: actorId, kind: "INTEGRATION" as const, reference: "integration:reader" },
    } satisfies WorkspaceProjectContext;
    const repo = repository();
    await expect(
      new ChangeProposalService(repo.value).listCurrentBacklog(integration, projectId),
    ).resolves.toEqual([]);
    await expect(
      new ChangeProposalService(repo.value).materializeFromReconciliation(
        integration,
        projectId,
        reconciliationId,
      ),
    ).rejects.toThrow("CHANGE_PROPOSAL_DENIED");
  });

  it("uses safe not-found behavior for unknown Projects and Proposals", async () => {
    await expect(
      new ChangeProposalService(repository(null).value).listCurrentBacklog(owner, projectId),
    ).rejects.toThrow("CHANGE_PROPOSAL_NOT_FOUND");
    await expect(
      new ChangeProposalService(repository().value).getProposal(owner, projectId, proposalId),
    ).rejects.toThrow("CHANGE_PROPOSAL_NOT_FOUND");
  });

  it("fails closed for archived Projects", async () => {
    await expect(
      new ChangeProposalService(repository("ARCHIVED").value).listCurrentBacklog(owner, projectId),
    ).rejects.toThrow("CHANGE_PROPOSAL_PROJECT_UNAVAILABLE");
  });
});
