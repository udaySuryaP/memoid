import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceProjectRuntime } from "../../../lib/workspace-project-runtime";
import { ProjectShell } from "../project-shell";

export default async function ProjectPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const runtime = await workspaceProjectRuntime(`/projects/${projectId}`);
  let project;
  try {
    project = await runtime.service.readProject(runtime.context, projectId as never);
  } catch {
    notFound();
  } finally {
    await runtime.close();
  }
  return (
    <ProjectShell
      eyebrow={`${project.lifecycleState} · ${project.reviewPolicy} review`}
      title={project.displayName}
      actions={
        <Link className="secondary-action" href={`/projects/${project.id}/settings`}>
          Project settings
        </Link>
      }
    >
      <section className="project-panel">
        <h2>Project shell</h2>
        <p>{project.description ?? "No description yet."}</p>
        <dl className="project-facts">
          <div>
            <dt>Review policy</dt>
            <dd>{project.reviewPolicy.toLowerCase()}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{project.version}</dd>
          </div>
        </dl>
      </section>
    </ProjectShell>
  );
}
