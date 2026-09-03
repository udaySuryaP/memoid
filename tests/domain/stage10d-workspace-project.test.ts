import {
  PROJECT_LIFECYCLE_STATES,
  parseRoleBundle,
  projectDescription,
  projectDisplayName,
  type ProjectSummary,
} from "../../packages/domain/src/index.js";
import {
  WorkspaceProjectAccessError,
  WorkspaceProjectService,
  type ProjectLifecycleRepository,
  type WorkspaceProjectContext,
} from "../../packages/application/src/index.js";
import { describe, expect, it, vi } from "vitest";

const workspaceId = "019c1234-1234-7123-8123-123456789abc" as never;
const accountId = "019c1234-1234-7123-8123-123456789abd" as never;
const actorId = "019c1234-1234-7123-8123-123456789abe" as never;
const projectId = "019c1234-1234-7123-8123-123456789abf" as never;

const activeProject: ProjectSummary = {
  id: projectId,
  workspaceId,
  displayName: "Memoid",
  description: null,
  lifecycleState: "ACTIVE",
  reviewPolicy: "MANUAL",
  version: 1 as never,
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const context: WorkspaceProjectContext = {
  accountId,
  workspaceId,
  sessionCredentialHash: new Uint8Array(32),
  actor: { id: actorId, kind: "HUMAN", reference: `account:${accountId}` },
  principal: {
    kind: "HUMAN",
    id: "provider-owner",
    accountId,
    active: true,
    sessionRevoked: false,
    roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER", workspaceId }],
  },
};

function repository(project: ProjectSummary = activeProject): ProjectLifecycleRepository {
  return {
    findPersonalWorkspace: vi.fn(),
    ensureHumanActor: vi.fn(),
    createProject: vi.fn(async () => ({ project, replayed: false })),
    listProjects: vi.fn(async () => [project]),
    findProject: vi.fn(async () => project),
    updateProject: vi.fn(async () => project),
    close: vi.fn(),
  };
}

describe("Stage 10D Workspace and Project domain", () => {
  it("keeps the lifecycle closed and excludes team membership roles", () => {
    expect(PROJECT_LIFECYCLE_STATES).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(() => parseRoleBundle("ADMIN")).toThrow("Unsupported role bundle");
    expect(() => parseRoleBundle("INVITEE")).toThrow("Unsupported role bundle");
  });

  it("normalizes bounded Project metadata", () => {
    expect(projectDisplayName("  My project  ")).toBe("My project");
    expect(projectDescription("   ")).toBeNull();
    expect(projectDescription("  private context  ")).toBe("private context");
    expect(() => projectDisplayName("\u0000unsafe")).toThrow();
    expect(() => projectDescription("x".repeat(2_001))).toThrow();
  });

  it("defaults creation to manual review through the central service", async () => {
    const port = repository();
    const service = new WorkspaceProjectService(port);
    await service.createProject(context, {
      displayName: "  New project ",
      idempotencyKeyHash: new Uint8Array(32),
      requestFingerprint: new Uint8Array(32),
    });
    expect(port.createProject).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        displayName: "New project",
        description: null,
        reviewPolicy: "MANUAL",
      }),
    );
  });

  it("fails closed for archived Project object reads and updates", async () => {
    const archived = { ...activeProject, lifecycleState: "ARCHIVED" as const };
    const service = new WorkspaceProjectService(repository(archived));
    await expect(service.readProject(context, projectId)).rejects.toEqual(
      new WorkspaceProjectAccessError("UNAVAILABLE"),
    );
    await expect(
      service.updateProject(context, {
        projectId,
        expectedVersion: 1,
        displayName: "Changed",
      }),
    ).rejects.toEqual(new WorkspaceProjectAccessError("UNAVAILABLE"));
  });

  it("denies a mismatched Actor before the repository is called", async () => {
    const port = repository();
    const service = new WorkspaceProjectService(port);
    await expect(
      service.listProjects({
        ...context,
        actor: { ...context.actor, reference: "account:foreign" },
      }),
    ).rejects.toEqual(new WorkspaceProjectAccessError("DENIED"));
    expect(port.listProjects).not.toHaveBeenCalled();
  });
});
