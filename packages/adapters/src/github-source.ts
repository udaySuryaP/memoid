import type { GitHubProviderPort, GitHubSourceRepository } from "@memoid/application/github-source";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import {
  githubProviderId,
  verifiedGitHubRepository,
  type GitHubConnectionState,
  type VerifiedGitHubRepository,
} from "@memoid/domain/github-source";
import { sanitizeGitHubDeliveryId, verifyGitHubWebhookSignature } from "@memoid/security";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import { createOpaqueProviderState, hashProviderState } from "@memoid/security";
import {
  parseUuidV7,
  type GitHubConnectionIntentId,
  type ProjectId,
  type SourceId,
} from "@memoid/domain/identifiers";
import { parseGitHubConnectionState } from "@memoid/domain/github-source";
import { sql, type Kysely } from "kysely";

const GITHUB_API_VERSION = "2026-03-10";

export interface GitHubAppConfiguration {
  readonly appId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly privateKey: string;
  readonly appSlug: string;
  readonly callbackUrl: string;
}

interface GitHubRepositoryPayload {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly html_url: string;
  readonly visibility?: string;
  readonly private: boolean;
  readonly default_branch: string;
  readonly owner: { readonly id: number; readonly login: string };
}

function safeProviderNumber(value: string, label: string): number {
  githubProviderId(value, label);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${label} cannot be represented safely by the GitHub SDK`);
  return parsed;
}

function providerPayloadId(value: unknown, label: string) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 1))
  )
    throw new Error(`${label} is not safely representable`);
  return githubProviderId(String(value), label);
}

function repositoryEvidence(
  appId: string,
  installationId: string,
  payload: GitHubRepositoryPayload,
): VerifiedGitHubRepository {
  const repositoryId = providerPayloadId(payload.id, "GitHub repository ID");
  const accountId = providerPayloadId(payload.owner.id, "GitHub account ID");
  return verifiedGitHubRepository({
    appId: githubProviderId(appId, "GitHub App ID"),
    installationId: githubProviderId(installationId, "GitHub installation ID"),
    accountId,
    repositoryId,
    ownerLogin: payload.owner.login,
    repositoryName: payload.name,
    fullName: payload.full_name,
    htmlUrl: payload.html_url,
    visibility: payload.visibility ?? (payload.private ? "private" : "public"),
    defaultBranch: payload.default_branch,
    verifiedAt: new Date().toISOString(),
  });
}

export class GitHubAppSourceAdapter implements GitHubProviderPort {
  private readonly app: App;

  public constructor(private readonly configuration: GitHubAppConfiguration) {
    githubProviderId(configuration.appId, "GitHub App ID");
    if (
      configuration.appSlug.length > 100 ||
      !/^[a-z0-9-]+$/u.test(configuration.appSlug) ||
      configuration.appSlug.startsWith("-") ||
      configuration.appSlug.endsWith("-")
    )
      throw new Error("GitHub App slug is malformed");
    const callback = new URL(configuration.callbackUrl);
    if (callback.protocol !== "https:" && callback.hostname !== "localhost")
      throw new Error("GitHub callback must use HTTPS");
    this.app = new App({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      Octokit: Octokit.defaults({
        userAgent: "memoid-stage10e",
        previews: [],
        request: { headers: { "X-GitHub-Api-Version": GITHUB_API_VERSION } },
        log: { debug() {}, info() {}, warn() {}, error() {} },
      }),
    });
  }

  public installationUrl(state: string): string {
    const url = new URL(`https://github.com/apps/${this.configuration.appSlug}/installations/new`);
    url.searchParams.set("state", state);
    return url.toString();
  }

  public userAuthorizationUrl(state: string): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.configuration.clientId);
    url.searchParams.set("redirect_uri", this.configuration.callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  public async discoverRepositories(input: {
    code: string;
    installationId: string;
  }): Promise<readonly VerifiedGitHubRepository[]> {
    const installationId = safeProviderNumber(input.installationId, "GitHub installation ID");
    const token = await this.exchangeUserCode(input.code);
    try {
      const user = new Octokit({
        auth: token,
        userAgent: "memoid-stage10e-callback",
        request: { headers: { "X-GitHub-Api-Version": GITHUB_API_VERSION } },
        log: { debug() {}, info() {}, warn() {}, error() {} },
      });
      const installations = await user.request("GET /user/installations", { per_page: 100 });
      const ownsInstallation = installations.data.installations.some(
        (installation) => installation.id === installationId,
      );
      if (!ownsInstallation) throw new Error("GitHub installation is not available to this user");
      const repositories = await user.request(
        "GET /user/installations/{installation_id}/repositories",
        { installation_id: installationId, per_page: 100 },
      );
      return repositories.data.repositories.map((repository) =>
        repositoryEvidence(
          this.configuration.appId,
          input.installationId,
          repository as GitHubRepositoryPayload,
        ),
      );
    } finally {
      await this.revokeUserToken(token);
    }
  }

  public async verifyRepository(input: {
    installationId: string;
    repositoryId: string;
  }): Promise<VerifiedGitHubRepository> {
    const installationId = safeProviderNumber(input.installationId, "GitHub installation ID");
    const repositoryId = safeProviderNumber(input.repositoryId, "GitHub repository ID");
    const installation = await this.app.octokit.request(
      "GET /app/installations/{installation_id}",
      { installation_id: installationId },
    );
    const tokenResponse = await this.app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
        repository_ids: [repositoryId],
        permissions: { metadata: "read", contents: "read" },
      },
    );
    const installationOctokit = new Octokit({
      auth: tokenResponse.data.token,
      userAgent: "memoid-stage10e-installation",
      request: { headers: { "X-GitHub-Api-Version": GITHUB_API_VERSION } },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
    let repositoryPayload: GitHubRepositoryPayload;
    try {
      const result = await installationOctokit.request("GET /repositories/{repository_id}", {
        repository_id: repositoryId,
      });
      repositoryPayload = result.data as GitHubRepositoryPayload;
    } finally {
      await installationOctokit.request("DELETE /installation/token");
    }
    const evidence = repositoryEvidence(
      this.configuration.appId,
      input.installationId,
      repositoryPayload,
    );
    if (String(installation.data.account?.id) !== evidence.accountId)
      throw new Error("GitHub installation account does not own the selected repository");
    return evidence;
  }

  private async exchangeUserCode(code: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{8,512}$/u.test(code)) throw new Error("GitHub OAuth code is malformed");
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.configuration.clientId,
        client_secret: this.configuration.clientSecret,
        code,
        redirect_uri: this.configuration.callbackUrl,
      }),
    });
    if (!response.ok) throw new Error("GitHub OAuth exchange failed");
    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length < 20)
      throw new Error("GitHub OAuth exchange returned no token");
    return body.access_token;
  }

  private async revokeUserToken(token: string): Promise<void> {
    const authorization = Buffer.from(
      `${this.configuration.clientId}:${this.configuration.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(this.configuration.clientId)}/token`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        body: JSON.stringify({ access_token: token }),
      },
    );
    if (!response.ok) throw new Error("GitHub user token revocation failed");
  }
}

export interface AuthenticatedGitHubLifecycleSignal {
  readonly appId: string;
  readonly installationId: string;
  readonly repositoryId: string | null;
  readonly deliveryId: string;
  readonly state: Exclude<GitHubConnectionState, "ACTIVE">;
  readonly payloadHash: Buffer;
  readonly providerOccurredAt: Date | null;
}

export function authenticateGitHubLifecycleSignals(input: {
  payload: Uint8Array;
  signature: string | null;
  deliveryId: string | null;
  event: string | null;
  expectedAppId: string;
  secrets: readonly Uint8Array[];
  maximumBytes?: number;
}): readonly AuthenticatedGitHubLifecycleSignal[] {
  if (input.payload.byteLength > (input.maximumBytes ?? 1_048_576))
    throw new Error("GitHub webhook payload is too large");
  if (!verifyGitHubWebhookSignature(input.payload, input.signature, input.secrets))
    throw new Error("GitHub webhook signature is invalid");
  const deliveryId = sanitizeGitHubDeliveryId(input.deliveryId);
  if (!deliveryId) throw new Error("GitHub delivery ID is invalid");
  const body = JSON.parse(Buffer.from(input.payload).toString("utf8")) as Record<string, unknown>;
  const installation = body.installation as { id?: unknown; app_id?: unknown } | undefined;
  const repository = body.repository as { id?: unknown } | undefined;
  const action = typeof body.action === "string" ? body.action : "";
  const event = input.event;
  const state = lifecycleState(event, action);
  const appId = githubProviderId(input.expectedAppId, "GitHub App ID");
  if (
    installation?.app_id !== undefined &&
    providerPayloadId(installation.app_id, "GitHub App ID") !== appId
  )
    throw new Error("GitHub webhook App ID does not match this endpoint");
  const installationId = providerPayloadId(installation?.id, "GitHub installation ID");
  const collectionKey = action === "removed" ? "repositories_removed" : "repositories_added";
  const collection = body[collectionKey] as readonly { id?: unknown }[] | undefined;
  const repositoryIds =
    collection?.map((item) => item.id) ??
    (repository?.id === undefined ? [undefined] : [repository.id]);
  const payloadHash = createHash("sha256").update(input.payload).digest();
  return repositoryIds.map((repositoryId) => ({
    appId,
    installationId,
    repositoryId:
      repositoryId === undefined ? null : providerPayloadId(repositoryId, "GitHub repository ID"),
    deliveryId,
    state,
    payloadHash,
    providerOccurredAt: null,
  }));
}

function lifecycleState(
  event: string | null,
  action: string,
): Exclude<GitHubConnectionState, "ACTIVE"> {
  if (event === "installation" && action === "suspend") return "SUSPENDED";
  if (event === "installation" && action === "deleted") return "INSTALLATION_DELETED";
  if (event === "installation_repositories" && action === "removed")
    return "REPOSITORY_ACCESS_REMOVED";
  if (event === "repository" && action === "deleted") return "REPOSITORY_DELETED";
  if (
    (event === "installation" && action === "unsuspend") ||
    (event === "installation_repositories" && action === "added") ||
    (event === "repository" &&
      ["edited", "renamed", "transferred", "privatized", "publicized"].includes(action))
  )
    return "VERIFICATION_REQUIRED";
  throw new Error("Unsupported GitHub lifecycle signal");
}

export class PostgresGitHubSourceRepository implements GitHubSourceRepository {
  private readonly db: Kysely<MemoidDatabase>;

  public constructor(connectionString: string) {
    this.db = createDatabase(connectionString, 4);
  }

  public async begin(context: WorkspaceProjectContext, projectId: ProjectId) {
    const state = createOpaqueProviderState();
    const id = await withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        const result = await sql<{ id: string }>`select memoid.create_github_connection_intent(
          ${Buffer.from(context.sessionCredentialHash)}::bytea, ${projectId}::uuid,
          ${state.hash}::bytea, uuidv7(), 600
        )::text as id`.execute(trx);
        return result.rows[0]?.id;
      },
    );
    if (!id) throw new Error("GitHub connection intent was not created");
    return {
      id: parseUuidV7(id, "GitHubConnectionIntentId") as GitHubConnectionIntentId,
      rawState: state.state,
    };
  }

  public async rotateState(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
    },
  ): Promise<string> {
    const next = createOpaqueProviderState();
    await withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId: input.projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        await sql`select memoid.rotate_github_connection_state(
          ${Buffer.from(context.sessionCredentialHash)}::bytea, ${input.intentId}::uuid,
          ${hashProviderState(input.rawState)}::bytea, ${next.hash}::bytea
        )`.execute(trx);
      },
    );
    return next.state;
  }

  public async recordCandidate(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
      repository: VerifiedGitHubRepository;
    },
  ): Promise<void> {
    const repository = verifiedGitHubRepository(input.repository);
    await withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId: input.projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        await sql`select memoid.record_github_repository_candidate(
          ${Buffer.from(context.sessionCredentialHash)}::bytea, ${input.intentId}::uuid,
          ${hashProviderState(input.rawState)}::bytea, ${repository.appId},
          ${repository.installationId}, ${repository.accountId}, ${repository.repositoryId},
          ${repository.ownerLogin}, ${repository.repositoryName}, ${repository.fullName},
          ${repository.htmlUrl}, ${repository.visibility}, ${repository.defaultBranch},
          ${repository.verifiedAt}
        )`.execute(trx);
      },
    );
  }

  public async connect(
    context: WorkspaceProjectContext,
    input: {
      projectId: ProjectId;
      intentId: GitHubConnectionIntentId;
      rawState: string;
      repositoryId: string;
      idempotencyKeyHash: Uint8Array;
      requestFingerprint: Uint8Array;
    },
  ): Promise<{ readonly sourceId: SourceId; readonly replayed: boolean }> {
    const projectId = input.projectId;
    const result = await withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId,
        actorId: context.actor.id,
      },
      async (trx) =>
        (
          await sql<{ sourceId: string; replayed: boolean }>`select
            source_id::text as "sourceId", replayed from memoid.connect_github_repository(
              ${Buffer.from(context.sessionCredentialHash)}::bytea, ${input.intentId}::uuid,
              ${hashProviderState(input.rawState)}::bytea, ${input.repositoryId},
              ${Buffer.from(input.idempotencyKeyHash)}::bytea,
              ${Buffer.from(input.requestFingerprint)}::bytea, uuidv7()
            )`.execute(trx)
        ).rows[0],
    );
    if (!result) throw new Error("GitHub Source connection returned no result");
    return {
      sourceId: parseUuidV7(result.sourceId, "SourceId") as SourceId,
      replayed: result.replayed,
    };
  }

  public async find(context: WorkspaceProjectContext, projectId: ProjectId) {
    return withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        const row = (
          await sql<{
            sourceId: string;
            appId: string;
            installationId: string;
            accountId: string;
            repositoryId: string;
            ownerLogin: string;
            repositoryName: string;
            fullName: string;
            htmlUrl: string;
            visibility: string;
            defaultBranch: string;
            connectionState: string;
            verifiedAt: Date;
            stateChangedAt: Date;
          }>`select source_id::text as "sourceId", app_id as "appId",
              installation_id as "installationId", account_id as "accountId",
              repository_id as "repositoryId", owner_login as "ownerLogin",
              repository_name as "repositoryName", full_name as "fullName",
              html_url as "htmlUrl", visibility, default_branch as "defaultBranch",
              connection_state as "connectionState", verified_at as "verifiedAt",
              state_changed_at as "stateChangedAt"
            from memoid.github_source_connections
            where workspace_id = ${context.workspaceId}::uuid and project_id = ${projectId}::uuid`.execute(
            trx,
          )
        ).rows[0];
        return row
          ? {
              workspaceId: context.workspaceId,
              projectId,
              sourceId: parseUuidV7(row.sourceId, "SourceId") as SourceId,
              appId: githubProviderId(row.appId),
              installationId: githubProviderId(row.installationId),
              accountId: githubProviderId(row.accountId),
              repositoryId: githubProviderId(row.repositoryId),
              ownerLogin: row.ownerLogin,
              repositoryName: row.repositoryName,
              fullName: row.fullName,
              htmlUrl: row.htmlUrl,
              visibility: row.visibility as "PUBLIC" | "PRIVATE" | "INTERNAL",
              defaultBranch: row.defaultBranch,
              verifiedAt: row.verifiedAt.toISOString(),
              state: parseGitHubConnectionState(row.connectionState),
              stateChangedAt: row.stateChangedAt.toISOString(),
            }
          : null;
      },
    );
  }

  public async listCandidates(
    context: WorkspaceProjectContext,
    input: { projectId: ProjectId; intentId: GitHubConnectionIntentId },
  ): Promise<readonly VerifiedGitHubRepository[]> {
    return withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId: input.projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        const result = await sql<{
          appId: string;
          installationId: string;
          accountId: string;
          repositoryId: string;
          ownerLogin: string;
          repositoryName: string;
          fullName: string;
          htmlUrl: string;
          visibility: string;
          defaultBranch: string;
          verifiedAt: Date;
        }>`select app_id as "appId", installation_id as "installationId",
            account_id as "accountId", repository_id as "repositoryId", owner_login as "ownerLogin",
            repository_name as "repositoryName", full_name as "fullName", html_url as "htmlUrl",
            visibility, default_branch as "defaultBranch", verified_at as "verifiedAt"
          from memoid.github_repository_candidates
          where workspace_id = ${context.workspaceId}::uuid and project_id = ${input.projectId}::uuid
            and intent_id = ${input.intentId}::uuid and expires_at > clock_timestamp()
          order by full_name, repository_id`.execute(trx);
        return result.rows.map((row) =>
          verifiedGitHubRepository({
            ...row,
            appId: githubProviderId(row.appId),
            installationId: githubProviderId(row.installationId),
            accountId: githubProviderId(row.accountId),
            repositoryId: githubProviderId(row.repositoryId),
            visibility: row.visibility,
            verifiedAt: row.verifiedAt.toISOString(),
          }),
        );
      },
    );
  }

  public close(): Promise<void> {
    return this.db.destroy();
  }
}

export class PostgresGitHubLifecycleRepository {
  private readonly db: Kysely<MemoidDatabase>;

  public constructor(connectionString: string) {
    this.db = createDatabase(connectionString, 2);
  }

  public async apply(signal: AuthenticatedGitHubLifecycleSignal): Promise<number> {
    const result = await sql<{ changed: number }>`select memoid.apply_github_lifecycle_signal(
      ${signal.appId}, ${signal.installationId}, ${signal.repositoryId}, ${signal.state},
      ${signal.deliveryId}, ${signal.payloadHash}::bytea, ${signal.providerOccurredAt}
    ) as changed`.execute(this.db);
    return result.rows[0]?.changed ?? 0;
  }

  public close(): Promise<void> {
    return this.db.destroy();
  }
}
