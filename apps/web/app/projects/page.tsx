import Link from "next/link";
import { workspaceProjectRuntime } from "../../lib/workspace-project-runtime";
import { ProjectShell } from "./project-shell";

export default async function ProjectsPage() {
  const runtime = await workspaceProjectRuntime("/projects");
  let projects;
  try {
    projects = await runtime.service.listProjects(runtime.context);
  } finally {
    await runtime.close();
  }
  return (
    <ProjectShell
      eyebrow="Personal workspace"
      title="Projects"
      actions={
        <Link className="primary-action" href="/projects/new">
          New project
        </Link>
      }
    >
      {projects.length === 0 ? (
        <section className="empty-state">
          <h2>No projects yet</h2>
          <p>Create a private project to establish its review policy and lifecycle.</p>
        </section>
      ) : (
        <section className="project-list" aria-label="Your projects">
          {projects.map((project) => (
            <Link className="project-card" href={`/projects/${project.id}`} key={project.id}>
              <div>
                <h2>{project.displayName}</h2>
                <p>{project.description ?? "No description"}</p>
              </div>
              <span className="badge">{project.lifecycleState}</span>
            </Link>
          ))}
        </section>
      )}
    </ProjectShell>
  );
}
