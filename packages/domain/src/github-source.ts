import type { ProjectId, SourceId, WorkspaceId } from "./identifiers.js";

export const GITHUB_PROVIDER_KEY = "GITHUB" as const;
export const GITHUB_SOURCE_KIND = "GITHUB_REPOSITORY" as const;

export type GitHubProviderId = string & { readonly __kind: "GitHubProviderId" };

export function githubProviderId(value: string, label = "GitHub provider ID"): GitHubProviderId {
  if (!/^(0|[1-9][0-9]{0,39})$/.test(value))
    throw new Error(`${label} must be a canonical decimal string`);
  return value as GitHubProviderId;
}

export const GITHUB_CONNECTION_STATES = [
  "ACTIVE",
  "VERIFICATION_REQUIRED",
  "SUSPENDED",
  "INSTALLATION_DELETED",
  "REPOSITORY_ACCESS_REMOVED",
  "REPOSITORY_DELETED",
] as const;
export type GitHubConnectionState = (typeof GITHUB_CONNECTION_STATES)[number];

export function parseGitHubConnectionState(value: string): GitHubConnectionState {
  if ((GITHUB_CONNECTION_STATES as readonly string[]).includes(value))
    return value as GitHubConnectionState;
  throw new Error(`Unsupported GitHub connection state: ${value}`);
}

export type GitHubVisibility = "PUBLIC" | "PRIVATE" | "INTERNAL";

export function githubVisibility(value: string): GitHubVisibility {
  const normalized = value.toUpperCase();
  if (normalized === "PUBLIC" || normalized === "PRIVATE" || normalized === "INTERNAL")
    return normalized;
  throw new Error(`Unsupported GitHub repository visibility: ${value}`);
}

export interface VerifiedGitHubRepository {
  readonly appId: GitHubProviderId;
  readonly installationId: GitHubProviderId;
  readonly accountId: GitHubProviderId;
  readonly repositoryId: GitHubProviderId;
  readonly ownerLogin: string;
  readonly repositoryName: string;
  readonly fullName: string;
  readonly htmlUrl: string;
  readonly visibility: GitHubVisibility;
  readonly defaultBranch: string;
  readonly verifiedAt: string;
}

export interface GitHubSourceConnection extends VerifiedGitHubRepository {
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
  readonly sourceId: SourceId;
  readonly state: GitHubConnectionState;
  readonly stateChangedAt: string;
}

function boundedDisplay(value: string, label: string, maximum: number): string {
  const hasControlCharacter = Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
  if (value.length < 1 || value.length > maximum || value.trim() !== value || hasControlCharacter)
    throw new Error(`${label} is malformed`);
  return value;
}

export function verifiedGitHubRepository(
  input: Omit<VerifiedGitHubRepository, "visibility"> & { readonly visibility: string },
): VerifiedGitHubRepository {
  const url = new URL(input.htmlUrl);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com")
    throw new Error("GitHub repository URL must use https://github.com");
  return {
    appId: githubProviderId(input.appId, "GitHub App ID"),
    installationId: githubProviderId(input.installationId, "GitHub installation ID"),
    accountId: githubProviderId(input.accountId, "GitHub account ID"),
    repositoryId: githubProviderId(input.repositoryId, "GitHub repository ID"),
    ownerLogin: boundedDisplay(input.ownerLogin, "GitHub owner login", 100),
    repositoryName: boundedDisplay(input.repositoryName, "GitHub repository name", 100),
    fullName: boundedDisplay(input.fullName, "GitHub repository full name", 201),
    htmlUrl: url.toString().replace(/\/$/u, ""),
    visibility: githubVisibility(input.visibility),
    defaultBranch: boundedDisplay(input.defaultBranch, "GitHub default branch", 255),
    verifiedAt: new Date(input.verifiedAt).toISOString(),
  };
}

export function providerIdentityKey(repository: VerifiedGitHubRepository): string {
  return [
    GITHUB_PROVIDER_KEY,
    repository.appId,
    repository.installationId,
    repository.repositoryId,
  ].join(":");
}
