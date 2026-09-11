import { PostgresSourceAuthorityRepository } from "@memoid/adapters/source-authority";
import { SourceAuthorityService } from "@memoid/application/source-authority";
import { workspaceProjectRuntime } from "./workspace-project-runtime";

export async function sourceAuthorityRuntime(returnPath: string) {
  const projectRuntime = await workspaceProjectRuntime(returnPath);
  const repository = new PostgresSourceAuthorityRepository(process.env.DATABASE_URL ?? "");
  return {
    service: new SourceAuthorityService(repository),
    projectService: projectRuntime.service,
    context: projectRuntime.context,
    close: async () => {
      await repository.close();
      await projectRuntime.close();
    },
  };
}
