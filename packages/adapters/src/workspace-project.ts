import type {
  CreateProjectCommand,
  ProjectLifecycleRepository,
  UpdateProjectCommand,
  WorkspaceProjectContext,
} from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import type { AuthorizationActor } from "@memoid/domain/authorization";
import {
  parseUuidV7,
  type AccountId,
  type ProjectId,
  type WorkspaceId,
} from "@memoid/domain/identifiers";
import { parseReviewPolicy, positiveVersion } from "@memoid/domain/values";
import {
  parseProjectLifecycleState,
  type PersonalWorkspace,
  type ProjectSummary,
} from "@memoid/domain/workspace-project";
import { sql, type Kysely } from "kysely";

interface ProjectRow {
  id: string;
  workspaceId: string;
  displayName: string;
  description: string | null;
  lifecycleState: string;
  reviewPolicy: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

function projectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: parseUuidV7(row.id, "ProjectId") as ProjectId,
    workspaceId: parseUuidV7(row.workspaceId, "WorkspaceId") as WorkspaceId,
    displayName: row.displayName,
    description: row.description,
    lifecycleState: parseProjectLifecycleState(row.lifecycleState),
    reviewPolicy: parseReviewPolicy(row.reviewPolicy),
    version: positiveVersion(Number(row.version)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const projectSelection = sql<ProjectRow>`select
    p.id::text as id,
    p.workspace_id::text as "workspaceId",
    p.display_name as "displayName",
    p.description,
    p.lifecycle_state as "lifecycleState",
    coalesce((
      select v.policy from memoid.project_review_policy_versions v
      where v.workspace_id = p.workspace_id and v.project_id = p.id
      order by v.version desc limit 1
    ), 'MANUAL') as "reviewPolicy",
    p.version::text as version,
    p.created_at as "createdAt",
    p.updated_at as "updatedAt"
  from memoid.projects p`;

export class PostgresWorkspaceProjectRepository implements ProjectLifecycleRepository {
  private readonly db: Kysely<MemoidDatabase>;

  public constructor(connectionString: string) {
    this.db = createDatabase(connectionString, 4);
  }

  public async findPersonalWorkspace(accountId: AccountId): Promise<PersonalWorkspace | null> {
    return withSecurityTransaction(this.db, { accountId }, async (trx) => {
      const row = (
        await sql<{
          id: string;
          createdAt: Date;
        }>`select w.id::text as id, w.created_at as "createdAt"
          from memoid.workspaces w
          join memoid.account_security_states s on s.account_id = w.account_id
          where w.account_id = ${accountId}::uuid and s.disabled_at is null`.execute(trx)
      ).rows[0];
      return row
        ? {
            id: parseUuidV7(row.id, "WorkspaceId") as WorkspaceId,
            createdAt: row.createdAt.toISOString(),
          }
        : null;
    });
  }

  public async ensureHumanActor(
    accountId: AccountId,
    workspaceId: WorkspaceId,
  ): Promise<AuthorizationActor> {
    return withSecurityTransaction(this.db, { accountId, workspaceId }, async (trx) => {
      const reference = `account:${accountId}`;
      await sql`insert into memoid.actors
          (workspace_id, actor_kind, actor_reference, display_label)
        values (${workspaceId}::uuid, 'HUMAN', ${reference}, 'Account owner')
        on conflict (workspace_id, actor_kind, actor_reference) do nothing`.execute(trx);
      const row = (
        await sql<{
          id: string;
          reference: string;
        }>`select id::text as id, actor_reference as reference
          from memoid.actors where workspace_id = ${workspaceId}::uuid
            and actor_kind = 'HUMAN' and actor_reference = ${reference}`.execute(trx)
      ).rows[0];
      if (!row) throw new Error("HUMAN Actor was not available");
      return {
        id: parseUuidV7(row.id, "ActorId"),
        kind: "HUMAN",
        reference: row.reference,
      };
    });
  }

  public async createProject(
    context: WorkspaceProjectContext,
    command: CreateProjectCommand,
  ): Promise<{ readonly project: ProjectSummary; readonly replayed: boolean }> {
    const result = await withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        actorId: context.actor.id,
      },
      async (trx) =>
        (
          await sql<{ projectId: string; projectVersion: string; replayed: boolean }>`select
              project_id::text as "projectId", project_version::text as "projectVersion", replayed
            from memoid.create_project(
              ${Buffer.from(context.sessionCredentialHash)}::bytea,
              ${command.displayName}, ${command.description ?? null}, ${command.reviewPolicy ?? "MANUAL"}::varchar,
              ${Buffer.from(command.idempotencyKeyHash)}::bytea,
              ${Buffer.from(command.requestFingerprint)}::bytea, uuidv7(), null
            )`.execute(trx)
        ).rows[0],
    );
    if (!result) throw new Error("Project creation returned no result");
    const projectId = parseUuidV7(result.projectId, "ProjectId") as ProjectId;
    const project = await this.findProject(context, projectId);
    if (!project) throw new Error("Created Project is not visible in its owning Workspace");
    return { project, replayed: result.replayed };
  }

  public async listProjects(context: WorkspaceProjectContext): Promise<readonly ProjectSummary[]> {
    return withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        actorId: context.actor.id,
      },
      async (trx) => {
        const result = await sql<ProjectRow>`${projectSelection}
          where p.workspace_id = ${context.workspaceId}::uuid
          order by p.created_at desc, p.id desc`.execute(trx);
        return result.rows.map(projectSummary);
      },
    );
  }

  public async findProject(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectSummary | null> {
    return withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        const row = (
          await sql<ProjectRow>`${projectSelection}
            where p.workspace_id = ${context.workspaceId}::uuid and p.id = ${projectId}::uuid`.execute(
            trx,
          )
        ).rows[0];
        return row ? projectSummary(row) : null;
      },
    );
  }

  public async updateProject(
    context: WorkspaceProjectContext,
    command: UpdateProjectCommand,
  ): Promise<ProjectSummary> {
    await withSecurityTransaction(
      this.db,
      {
        accountId: context.accountId,
        workspaceId: context.workspaceId,
        projectId: command.projectId,
        actorId: context.actor.id,
      },
      async (trx) => {
        const result = await sql`select * from memoid.update_project_metadata(
          ${Buffer.from(context.sessionCredentialHash)}::bytea,
          ${command.projectId}::uuid, ${command.expectedVersion}, ${command.displayName},
          ${command.description ?? null}, uuidv7()
        )`.execute(trx);
        if (result.rows.length !== 1) throw new Error("Project update returned no result");
      },
    );
    const project = await this.findProject(context, command.projectId);
    if (!project) throw new Error("Updated Project is no longer visible");
    return project;
  }

  public async close(): Promise<void> {
    await this.db.destroy();
  }
}
