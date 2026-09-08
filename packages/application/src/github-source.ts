import { authorize } from "@memoid/domain/authorization";
import {
  githubProviderId,
  providerIdentityKey,
  verifiedGitHubRepository,
  type GitHubSourceConnection,
  type VerifiedGitHubRepository,
} from "@memoid/domain/github-source";
import type { GitHubConnectionIntentId, ProjectId, SourceId } from "@memoid/domain/identifiers";
import type { WorkspaceProjectContext } from "./workspace-project.js";

export interface GitHubConnectionIntent {
  readonly id: GitHubConnectionIntentId;
  readonly rawState: string;
}

export interface GitHubProviderPort {
  installationUrl(state: string): string;
  userAuthorizationUrl(state: string): string;
  discoverRepositories(input: {
    code: string;
    installationId: string;
  }): Promise<readonly VerifiedGitHubRepository[]>;
  verifyRepository(input: {
    installationId: string;
    repositoryId: string;
  }): Promise<VerifiedGitHubRepository>;
}

export interface GitHubSourceRepository {
  begin(context: WorkspaceProjectContext, projectId: ProjectId): Promise<GitHubConnectionIntent>;
  rotateState(
    context: WorkspaceProjectContext,
    input: {
      readonly projectId: ProjectId;
      readonly intentId: GitHubConnectionIntentId;
      readonly rawState: string;
    },
  ): Promise<string>;
  recordCandidate(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
      repository: VerifiedGitHubRepository;
    },
  ): Promise<void>;
  connect(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
      repositoryId: string;
      idempotencyKeyHash: Uint8Array;
      requestFingerprint: Uint8Array;
    },
  ): Promise<{ readonly sourceId: SourceId; readonly replayed: boolean }>;
  find(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<GitHubSourceConnection | null>;
  listCandidates(
    context: WorkspaceProjectContext,
    input: { readonly projectId: ProjectId; readonly intentId: GitHubConnectionIntentId },
  ): Promise<readonly VerifiedGitHubRepository[]>;
  close(): Promise<void>;
}

export class GitHubSourceAccessError extends Error {
  public constructor(
    public readonly code:
      "DENIED" | "INSTALLATION_MISMATCH" | "REPOSITORY_NOT_VERIFIED" | "PROVIDER_UNAVAILABLE",
  ) {
    super(code);
  }
}

function requireProjectControl(context: WorkspaceProjectContext, projectId: ProjectId): void {
  const decision = authorize({
    principal: context.principal,
    actor: context.actor,
    capability: "PROJECT_CONTROL",
    workspaceId: context.workspaceId,
    projectId,
    resourceState: "ACTIVE",
    grants: [],
  });
  if (!decision.allowed) throw new GitHubSourceAccessError("DENIED");
}

export class GitHubSourceService {
  public constructor(
    private readonly repository: GitHubSourceRepository,
    private readonly provider: GitHubProviderPort,
  ) {}

  public async begin(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<GitHubConnectionIntent & { readonly installationUrl: string }> {
    requireProjectControl(context, projectId);
    const intent = await this.repository.begin(context, projectId);
    return { ...intent, installationUrl: this.provider.installationUrl(intent.rawState) };
  }

  public async discover(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
      installationId: string;
      code: string;
    },
  ): Promise<readonly VerifiedGitHubRepository[]> {
    requireProjectControl(context, input.projectId);
    const installationId = githubProviderId(input.installationId, "GitHub installation ID");
    let repositories: readonly VerifiedGitHubRepository[];
    try {
      repositories = await this.provider.discoverRepositories({
        code: input.code,
        installationId,
      });
    } catch {
      throw new GitHubSourceAccessError("PROVIDER_UNAVAILABLE");
    }
    if (repositories.some((repository) => repository.installationId !== installationId))
      throw new GitHubSourceAccessError("INSTALLATION_MISMATCH");
    for (const repository of repositories)
      await this.repository.recordCandidate(context, {
        projectId: input.projectId,
        intentId: input.intentId,
        rawState: input.rawState,
        repository: verifiedGitHubRepository(repository),
      });
    return repositories;
  }

  public async connect(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
      installationId: string;
      repositoryId: string;
      idempotencyKeyHash: Uint8Array;
      requestFingerprint: Uint8Array;
    },
  ): Promise<{ readonly sourceId: SourceId; readonly replayed: boolean }> {
    requireProjectControl(context, input.projectId);
    const expectedInstallation = githubProviderId(input.installationId, "GitHub installation ID");
    const expectedRepository = githubProviderId(input.repositoryId, "GitHub repository ID");
    let verified: VerifiedGitHubRepository;
    try {
      verified = await this.provider.verifyRepository({
        installationId: expectedInstallation,
        repositoryId: expectedRepository,
      });
    } catch {
      throw new GitHubSourceAccessError("PROVIDER_UNAVAILABLE");
    }
    if (
      verified.installationId !== expectedInstallation ||
      verified.repositoryId !== expectedRepository
    )
      throw new GitHubSourceAccessError("REPOSITORY_NOT_VERIFIED");
    await this.repository.recordCandidate(context, {
      projectId: input.projectId,
      intentId: input.intentId,
      rawState: input.rawState,
      repository: verified,
    });
    return this.repository.connect(context, {
      ...input,
      repositoryId: verified.repositoryId,
      requestFingerprint: input.requestFingerprint,
    });
  }

  public identityKey(repository: VerifiedGitHubRepository): string {
    return providerIdentityKey(repository);
  }
}
