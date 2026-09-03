import type { ReactNode } from "react";
import Link from "next/link";

export function ProjectShell(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <main className="project-shell">
      <nav aria-label="Project navigation">
        <Link href="/projects">Memoid projects</Link>
      </nav>
      <header className="project-heading">
        <div>
          <p className="project-eyebrow">{props.eyebrow}</p>
          <h1>{props.title}</h1>
        </div>
        {props.actions ? <div className="project-actions">{props.actions}</div> : null}
      </header>
      {props.children}
    </main>
  );
}
