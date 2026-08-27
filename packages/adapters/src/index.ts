import type {
  AnalyticsSink,
  GitHubSourcePort,
  KeyManagementPort,
  ObjectStoragePort,
  ReconciliationModel,
} from "@memoid/application";
import type { KMSClient } from "@aws-sdk/client-kms";
import type { S3Client } from "@aws-sdk/client-s3";
import type { App } from "@octokit/app";
import type { Octokit } from "@octokit/rest";

export interface GitHubAdapterDependencies {
  readonly app: App;
  readonly rest: Octokit;
}
export class GitHubAppAdapter implements GitHubSourcePort {
  public constructor(private readonly dependencies: GitHubAdapterDependencies) {}
  public async getRepositoryIdentity(
    owner: string,
    repository: string,
  ): Promise<{ id: string; fullName: string }> {
    const result = await this.dependencies.rest.repos.get({ owner, repo: repository });
    return { id: String(result.data.id), fullName: result.data.full_name };
  }
}
export class DeterministicReconciliationModel implements ReconciliationModel {
  public readonly provider = "deterministic-stage8b-fake";
  public async completeStructured(
    input: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    return { accepted: false, echoKeys: Object.keys(input).sort() };
  }
}
export interface AwsBoundaryClients {
  readonly s3: S3Client;
  readonly kms: KMSClient;
}
export type AwsStorageBoundary = ObjectStoragePort & KeyManagementPort;
export class DisabledAnalyticsSink implements AnalyticsSink {
  public async capture(): Promise<void> {}
}
