import { notFound } from "next/navigation";
import { workspaceProjectRuntime } from "../../../../lib/workspace-project-runtime";
import { UpdateProjectForm } from "../../project-forms";
import { ProjectShell } from "../../project-shell";

export default async function ProjectSettingsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const runtime = await workspaceProjectRuntime(`/projects/${projectId}/settings`);
  let project;
  try {
    project = await runtime.service.readProject(runtime.context, projectId as never);
  } catch {
    notFound();
  } finally {
    await runtime.close();
  }
  return (
    <ProjectShell eyebrow="Project settings" title={project.displayName}>
      <section className="project-panel">
        <h2>Project details</h2>
        <p>
          Archiving and deletion are separate lifecycle operations and are not available in this
          stage.
        </p>
        <UpdateProjectForm
          projectId={project.id}
          version={project.version}
          displayName={project.displayName}
          description={project.description}
        />
      </section>
    </ProjectShell>
  );
}
