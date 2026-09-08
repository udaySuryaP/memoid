import {
  parseUuidV7,
  type GitHubConnectionIntentId,
  type ProjectId,
} from "@memoid/domain/identifiers";
import { GITHUB_FLOW_COOKIE_NAME, unsealGitHubFlowState } from "@memoid/security";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { githubSourceRuntime } from "../../../../../../lib/github-source-runtime";
import { ProjectShell } from "../../../../project-shell";

export default async function GitHubRepositorySelectionPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId: rawProjectId } = await params;
  const projectId = parseUuidV7(rawProjectId, "ProjectId") as ProjectId;
  const runtime = await githubSourceRuntime(`/projects/${projectId}/sources/github/select`);
  try {
    const sealed = (await cookies()).get(GITHUB_FLOW_COOKIE_NAME)?.value;
    const flow = sealed ? unsealGitHubFlowState(sealed, runtime.flowSecret) : null;
    if (!flow || flow.projectId !== projectId || !flow.installationId) notFound();
    const repositories = await runtime.repository.listCandidates(runtime.context, {
      projectId,
      intentId: parseUuidV7(flow.intentId, "GitHubConnectionIntentId") as GitHubConnectionIntentId,
    });
    return (
      <ProjectShell eyebrow="GitHub App" title="Select one repository">
        <section className="project-panel">
          <h2>Repositories available to this installation</h2>
          <p>
            Memoid will recheck the selected repository with a repository-scoped installation token
            before saving it.
          </p>
          {repositories.length === 0 ? (
            <p className="security-warning">No eligible repositories are available.</p>
          ) : (
            <form
              className="repository-selection"
              method="post"
              action={`/projects/${projectId}/sources/github/select/confirm`}
            >
              {repositories.map((repository, index) => (
                <label key={repository.repositoryId}>
                  <input
                    type="radio"
                    name="repositoryId"
                    value={repository.repositoryId}
                    required
                    defaultChecked={index === 0}
                  />
                  <span>
                    <strong>{repository.fullName}</strong>
                    <small>{repository.visibility.toLowerCase()}</small>
                  </span>
                </label>
              ))}
              <button className="primary-action" type="submit">
                Connect repository
              </button>
            </form>
          )}
        </section>
      </ProjectShell>
    );
  } finally {
    await runtime.close();
  }
}

export const dynamic = "force-dynamic";
