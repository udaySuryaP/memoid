import {
  GitHubAppSourceAdapter,
  PostgresGitHubSourceRepository,
} from "@memoid/adapters/github-source";
import { GitHubSourceService } from "@memoid/application/github-source";
import { workspaceProjectRuntime } from "./workspace-project-runtime";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

export async function githubSourceRuntime(returnPath: string) {
  const projectRuntime = await workspaceProjectRuntime(returnPath);
  requiredEnvironment("GITHUB_WEBHOOK_SECRET");
  const repository = new PostgresGitHubSourceRepository(requiredEnvironment("DATABASE_URL"));
  const provider = new GitHubAppSourceAdapter({
    appId: requiredEnvironment("GITHUB_APP_ID"),
    clientId: requiredEnvironment("GITHUB_APP_CLIENT_ID"),
    clientSecret: requiredEnvironment("GITHUB_APP_CLIENT_SECRET"),
    privateKey: requiredEnvironment("GITHUB_APP_PRIVATE_KEY").replace(/\\n/gu, "\n"),
    appSlug: requiredEnvironment("GITHUB_APP_SLUG"),
    callbackUrl: requiredEnvironment("GITHUB_CALLBACK_URL"),
  });
  const flowSecret = Buffer.from(requiredEnvironment("MEMOID_GITHUB_FLOW_SECRET"), "base64url");
  if (flowSecret.byteLength < 32) throw new Error("MEMOID_GITHUB_FLOW_SECRET is too short");
  return {
    service: new GitHubSourceService(repository, provider),
    repository,
    provider,
    context: projectRuntime.context,
    flowSecret,
    origin: requiredEnvironment("MEMOID_APP_ORIGIN"),
    close: async () => {
      await repository.close();
      await projectRuntime.close();
    },
  };
}
