import Link from "next/link";
import { ProjectShell } from "../project-shell";

export default function ProjectNotFound() {
  return (
    <ProjectShell eyebrow="Unavailable" title="Project not found">
      <section className="empty-state">
        <p>This project does not exist, is archived, or belongs to another workspace.</p>
        <Link className="secondary-action" href="/projects">
          Back to projects
        </Link>
      </section>
    </ProjectShell>
  );
}
