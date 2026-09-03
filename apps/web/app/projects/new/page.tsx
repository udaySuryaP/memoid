import Link from "next/link";
import { CreateProjectForm } from "../project-forms";
import { ProjectShell } from "../project-shell";

export default function NewProjectPage() {
  return (
    <ProjectShell
      eyebrow="Private by default"
      title="Create a project"
      actions={
        <Link className="secondary-action" href="/projects">
          Cancel
        </Link>
      }
    >
      <section className="project-panel">
        <p>
          Projects begin active and independent of any repository. Manual review is the default.
        </p>
        <CreateProjectForm />
      </section>
    </ProjectShell>
  );
}
