import { PostgresGitHubSourceRepository } from "@memoid/adapters/github-source";
import { parseUuidV7, type ProjectId } from "@memoid/domain/identifiers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceProjectRuntime } from "../../../../../lib/workspace-project-runtime";
import { ProjectShell } from "../../../project-shell";

export default async function GitHubSourcePage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId: rawProjectId } = await params;
  const projectId = parseUuidV7(rawProjectId, "ProjectId") as ProjectId;
  const runtime = await workspaceProjectRuntime(`/projects/${projectId}/sources/github`);
  const repository = new PostgresGitHubSourceRepository(process.env.DATABASE_URL ?? "");
  try {
    const project = await runtime.service.readProject(runtime.context, projectId);
    const connection = await repository.find(runtime.context, projectId);
    const configured = [
      "GITHUB_APP_ID",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_SLUG",
      "GITHUB_CALLBACK_URL",
      "GITHUB_WEBHOOK_SECRET",
      "MEMOID_GITHUB_FLOW_SECRET",
    ].every((name) => Boolean(process.env[name]));
    return (
      <ProjectShell
        eyebrow="Source connection"
        title={`${project.displayName} · GitHub`}
        actions={
          <Link className="secondary-action" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        }
      >
        <section className="project-panel">
          <h2>GitHub repository</h2>
          <p>
            Memoid requests read-only Metadata and Contents access for one selected repository. It
            never receives write permission.
          </p>
          {connection ? (
            <>
              <dl className="project-facts">
                <div>
                  <dt>Repository</dt>
                  <dd>{connection.fullName}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{connection.state.toLowerCase().replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>{connection.visibility.toLowerCase()}</dd>
                </div>
                <div>
                  <dt>Default branch</dt>
                  <dd>{connection.defaultBranch}</dd>
                </div>
              </dl>
              {connection.state !== "ACTIVE" && configured ? (
                <form method="post" action={`/projects/${projectId}/sources/github/connect`}>
                  <button className="primary-action" type="submit">
                    Reverify GitHub access
                  </button>
                </form>
              ) : null}
            </>
          ) : configured ? (
            <form method="post" action={`/projects/${projectId}/sources/github/connect`}>
              <button className="primary-action" type="submit">
                Install GitHub App
              </button>
            </form>
          ) : (
            <p className="security-warning">
              GitHub connection is not configured in this environment.
            </p>
          )}
        </section>
      </ProjectShell>
    );
  } catch {
    notFound();
  } finally {
    await repository.close();
    await runtime.close();
  }
}

export const dynamic = "force-dynamic";
