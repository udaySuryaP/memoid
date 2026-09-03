import { PostgresWorkspaceProjectRepository } from "@memoid/adapters/workspace-project";
import {
  WorkspaceProjectService,
  type WorkspaceProjectContext,
} from "@memoid/application/workspace-project";
import { parseUuidV7, type AccountId } from "@memoid/domain/identifiers";
import { SESSION_COOKIE_NAME, hashSessionCredential } from "@memoid/security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRuntime } from "./auth-runtime";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

export interface WorkspaceProjectRuntime {
  readonly service: WorkspaceProjectService;
  readonly context: WorkspaceProjectContext;
  close(): Promise<void>;
}

export async function workspaceProjectRuntime(
  returnPath: string,
): Promise<WorkspaceProjectRuntime> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect(`/auth/access?return=${encodeURIComponent(returnPath)}`);
  const sessionCredentialHash = hashSessionCredential(token);

  const auth = authRuntime();
  let session;
  try {
    session = await auth.sessions.authenticate(sessionCredentialHash);
    if (session?.providerRecheckRequired) {
      const active = await auth.provider.isProviderSessionActive(
        session.providerSubject,
        session.providerSessionId,
      );
      await auth.sessions.markProviderState(
        sessionCredentialHash,
        active,
        session.providerExpiresAt,
      );
      if (!active) session = null;
    }
  } finally {
    await auth.sessions.close();
  }
  if (!session) redirect(`/auth/access?return=${encodeURIComponent(returnPath)}`);

  const accountId = parseUuidV7(session.accountId, "AccountId") as AccountId;
  const repository = new PostgresWorkspaceProjectRepository(requiredEnvironment("DATABASE_URL"));
  try {
    const workspace = await repository.findPersonalWorkspace(accountId);
    if (!workspace) throw new Error("Personal Workspace is unavailable");
    const actor = await repository.ensureHumanActor(accountId, workspace.id);
    const context: WorkspaceProjectContext = {
      accountId,
      workspaceId: workspace.id,
      sessionCredentialHash,
      actor,
      principal: {
        kind: "HUMAN",
        id: session.providerSubject,
        accountId,
        active: true,
        sessionRevoked: false,
        roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER", workspaceId: workspace.id }],
      },
    };
    return {
      service: new WorkspaceProjectService(repository),
      context,
      close: () => repository.close(),
    };
  } catch (error) {
    await repository.close();
    throw error;
  }
}
