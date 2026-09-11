import { parseUuidV7, type ProjectId } from "@memoid/domain/identifiers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sourceAuthorityRuntime } from "../../../../../lib/source-authority-runtime";
import { ProjectShell } from "../../../project-shell";
import {
  NewAuthorityForm,
  ReconfirmAuthorityForm,
  ReplaceAuthorityForm,
  RevokeAuthorityForm,
} from "./authority-forms";

export default async function SourceAuthorityPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId: rawProjectId } = await params;
  const projectId = parseUuidV7(rawProjectId, "ProjectId") as ProjectId;
  const runtime = await sourceAuthorityRuntime(`/projects/${projectId}/sources/authority`);
  try {
    const [project, overview] = await Promise.all([
      runtime.projectService.readProject(runtime.context, projectId),
      runtime.service.overview(runtime.context, projectId),
    ]);
    const mayMutate =
      overview.stepUpSatisfied && runtime.context.freshAuthenticationSatisfied === true;
    return (
      <ProjectShell
        eyebrow="Source Authority"
        title={project.displayName}
        actions={
          <Link className="secondary-action" href={`/projects/${projectId}`}>
            Back to project
          </Link>
        }
      >
        <section className="project-panel">
          <h2>Scoped authority</h2>
          <p>
            Authority applies only to the named category, facet, semantic scope, and ref boundary.
            Evidence, observation, or a GitHub connection never grants authority by itself. Source
            Authority never grants instruction or application authority.
          </p>
          {overview.assignments.length === 0 ? (
            <p className="security-warning">
              No Source Authority is assigned. Memoid will fail closed instead of selecting a global
              source of truth.
            </p>
          ) : (
            <div className="authority-list">
              {overview.assignments.map((assignment) => (
                <article className="authority-card" key={assignment.id}>
                  <div>
                    <span className="badge">{assignment.qualification.replaceAll("_", " ")}</span>
                    <h3>
                      {assignment.category.replaceAll("_", " ")} ·{" "}
                      {assignment.facet.replaceAll("_", " ")}
                    </h3>
                    <p>{assignment.sourceLabel}</p>
                  </div>
                  <dl className="project-facts">
                    <div>
                      <dt>Scope</dt>
                      <dd>
                        {assignment.scopeKind === "PROJECT" ? "Whole project" : assignment.scopeKey}
                      </dd>
                    </div>
                    <div>
                      <dt>Ref</dt>
                      <dd>{assignment.refKey ?? assignment.refSelector.replaceAll("_", " ")}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>{assignment.version}</dd>
                    </div>
                  </dl>
                  {mayMutate ? (
                    <div className="authority-actions">
                      <ReplaceAuthorityForm
                        projectId={projectId}
                        assignment={assignment}
                        sources={overview.sources}
                      />
                      {assignment.qualification === "REVALIDATION_REQUIRED" ? (
                        <ReconfirmAuthorityForm projectId={projectId} assignment={assignment} />
                      ) : null}
                      <RevokeAuthorityForm projectId={projectId} assignment={assignment} />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="project-panel">
          <h2>Review an authority decision</h2>
          {!mayMutate ? (
            <>
              <p className="security-notice">
                Changing Source Authority requires a fresh, Project-scoped identity check.
              </p>
              <form action={`/projects/${projectId}/sources/authority/step-up`} method="post">
                <button className="primary-action" type="submit">
                  Verify identity
                </button>
              </form>
            </>
          ) : overview.sources.some((source) => source.available) ? (
            <NewAuthorityForm projectId={projectId} sources={overview.sources} />
          ) : (
            <p className="security-warning">
              No available Source can receive authority. Existing assignments remain visible and
              degraded; Memoid will not fall back.
            </p>
          )}
        </section>
      </ProjectShell>
    );
  } catch {
    notFound();
  } finally {
    await runtime.close();
  }
}

export const dynamic = "force-dynamic";
