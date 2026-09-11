import type {
  AuthoritySourceOption,
  RevokeSourceAuthorityCommand,
  SetSourceAuthorityCommand,
  SourceAuthorityRepository,
} from "@memoid/application/source-authority";
import type { WorkspaceProjectContext } from "@memoid/application/workspace-project";
import { createDatabase, withSecurityTransaction, type MemoidDatabase } from "@memoid/db";
import {
  parseUuidV7,
  type ProjectId,
  type SourceAuthorityAssignmentId,
  type SourceAuthorityScopeId,
  type SourceId,
} from "@memoid/domain/identifiers";
import {
  parseAuthorityCategoryFacet,
  parseAuthorityRefSelector,
  parseAuthorityScopeKind,
  type AuthorityAssignmentView,
  type AuthorityQualification,
} from "@memoid/domain/source-authority";
import {
  parseProjectLifecycleState,
  type ProjectLifecycleState,
} from "@memoid/domain/workspace-project";
import { sql, type Kysely } from "kysely";

const security = (context: WorkspaceProjectContext, projectId: ProjectId) => ({
  accountId: context.accountId,
  workspaceId: context.workspaceId,
  projectId,
  actorId: context.actor.id,
});

export class PostgresSourceAuthorityRepository implements SourceAuthorityRepository {
  private readonly db: Kysely<MemoidDatabase>;

  public constructor(connectionString: string) {
    this.db = createDatabase(connectionString, 4);
  }

  public async findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const row = (
        await sql<{ state: string }>`select lifecycle_state as state from memoid.projects
          where workspace_id = ${context.workspaceId}::uuid and id = ${projectId}::uuid`.execute(
          trx,
        )
      ).rows[0];
      return row ? parseProjectLifecycleState(row.state) : null;
    });
  }

  public async listAssignments(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly AuthorityAssignmentView[]> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const rows = (
        await sql<{
          id: string;
          scopeId: string;
          sourceId: string;
          sourceLabel: string;
          categoryFacet: string;
          scopeKind: string;
          scopeKey: string;
          refSelector: string;
          refKey: string | null;
          version: string;
          qualification: AuthorityQualification;
          effectiveAt: Date;
        }>`select a.id::text as id, s.id::text as "scopeId", a.source_id::text as "sourceId",
          coalesce(c.full_name, 'Unavailable Source') as "sourceLabel",
          s.authority_category || ':' || s.authority_facet as "categoryFacet",
          s.scope_kind as "scopeKind", s.scope_key as "scopeKey",
          s.ref_selector as "refSelector", s.ref_key as "refKey", s.version::text as version,
          case
            when c.source_id is null or c.connection_state <> 'ACTIVE' then 'SOURCE_UNAVAILABLE'
            when s.ref_selector = 'DEFAULT_BRANCH'
              and a.source_default_ref_snapshot <> 'refs/heads/' || c.default_branch
              then 'REVALIDATION_REQUIRED'
            when not exists (select 1 from memoid.source_observations o
              join memoid.source_frontier_units observed_unit
                on observed_unit.workspace_id = o.workspace_id
                and observed_unit.project_id = o.project_id and observed_unit.id = o.frontier_unit_id
              where o.workspace_id = s.workspace_id and o.project_id = s.project_id
                and observed_unit.source_id = a.source_id) then 'SOURCE_UNOBSERVED'
            when exists (select 1 from memoid.source_frontier_states fs
              join memoid.source_frontier_units fu on fu.workspace_id = fs.workspace_id
                and fu.project_id = fs.project_id and fu.id = fs.frontier_unit_id
              where fs.workspace_id = s.workspace_id and fs.project_id = s.project_id
                and fu.source_id = a.source_id
                and coalesce(fs.desired_sequence,0) > coalesce(fs.ingested_sequence,0))
              then 'SOURCE_BEHIND'
            else 'EFFECTIVE'
          end as qualification,
          a.effective_at as "effectiveAt"
        from memoid.source_authority_scopes s
        join memoid.source_authority_assignments a on a.workspace_id = s.workspace_id
          and a.project_id = s.project_id and a.authority_scope_id = s.id
          and a.id = s.current_assignment_id
        left join memoid.github_source_connections c on c.workspace_id = a.workspace_id
          and c.project_id = a.project_id and c.source_id = a.source_id
        where s.workspace_id = ${context.workspaceId}::uuid and s.project_id = ${projectId}::uuid
        order by s.authority_category, s.authority_facet, s.scope_key, s.ref_selector`.execute(trx)
      ).rows;
      return rows.map((row) => {
        const pair = parseAuthorityCategoryFacet(row.categoryFacet);
        return {
          id: parseUuidV7(row.id, "SourceAuthorityAssignmentId") as SourceAuthorityAssignmentId,
          scopeId: parseUuidV7(row.scopeId, "SourceAuthorityScopeId") as SourceAuthorityScopeId,
          sourceId: parseUuidV7(row.sourceId, "SourceId") as SourceId,
          sourceLabel: row.sourceLabel,
          ...pair,
          scopeKind: parseAuthorityScopeKind(row.scopeKind),
          scopeKey: row.scopeKey,
          refSelector: parseAuthorityRefSelector(row.refSelector),
          refKey: row.refKey,
          version: Number(row.version),
          qualification: row.qualification as AuthorityAssignmentView["qualification"],
          effectiveAt: row.effectiveAt.toISOString(),
        };
      });
    });
  }

  public async listSources(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<readonly AuthoritySourceOption[]> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const rows = (
        await sql<{ id: string; label: string; available: boolean }>`select source.id::text as id,
          coalesce(github.full_name, source.source_kind) as label,
          coalesce(github.connection_state = 'ACTIVE', false) as available
        from memoid.sources source
        left join memoid.github_source_connections github on github.workspace_id = source.workspace_id
          and github.project_id = source.project_id and github.source_id = source.id
        where source.workspace_id = ${context.workspaceId}::uuid and source.project_id = ${projectId}::uuid
        order by source.created_at, source.id`.execute(trx)
      ).rows;
      return rows.map((row) => ({
        id: parseUuidV7(row.id, "SourceId") as SourceId,
        label: row.label,
        available: row.available,
      }));
    });
  }

  public async hasScopedStepUp(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<boolean> {
    return withSecurityTransaction(this.db, security(context, projectId), async (trx) => {
      const row = (
        await sql<{ satisfied: boolean }>`select memoid.has_source_authority_step_up(
          ${Buffer.from(context.sessionCredentialHash)}::bytea, ${projectId}::uuid
        ) as satisfied`.execute(trx)
      ).rows[0];
      return row?.satisfied ?? false;
    });
  }

  public async setAssignment(context: WorkspaceProjectContext, command: SetSourceAuthorityCommand) {
    const result = await withSecurityTransaction(
      this.db,
      security(context, command.projectId),
      async (trx) =>
        (
          await sql<{ assignmentId: string; version: string; replayed: boolean }>`select
            assignment_id::text as "assignmentId", scope_version::text as version, replayed
          from memoid.set_source_authority(
            ${Buffer.from(context.sessionCredentialHash)}::bytea, ${command.projectId}::uuid,
            ${command.sourceId}::uuid, ${command.categoryFacet}::varchar, ${command.scopeKind}::varchar,
            ${command.scopeKey ?? null}::varchar, ${command.refSelector}::varchar, ${command.refKey ?? null}::varchar,
            ${command.expectedVersion}, ${command.reasonKey}::varchar, ${command.reasonNote ?? null}::varchar,
            ${Buffer.from(command.idempotencyKeyHash)}::bytea,
            ${Buffer.from(command.requestFingerprint)}::bytea, uuidv7(), null
          )`.execute(trx)
        ).rows[0],
    );
    if (!result) throw new Error("Source Authority mutation returned no result");
    return {
      assignmentId: parseUuidV7(
        result.assignmentId,
        "SourceAuthorityAssignmentId",
      ) as SourceAuthorityAssignmentId,
      version: Number(result.version),
      replayed: result.replayed,
    };
  }

  public async revokeAssignment(
    context: WorkspaceProjectContext,
    command: RevokeSourceAuthorityCommand,
  ) {
    const result = await withSecurityTransaction(
      this.db,
      security(context, command.projectId),
      async (trx) =>
        (
          await sql<{ scopeId: string; version: string; replayed: boolean }>`select
            scope_id::text as "scopeId", scope_version::text as version, replayed
          from memoid.revoke_source_authority(
            ${Buffer.from(context.sessionCredentialHash)}::bytea, ${command.projectId}::uuid,
            ${command.scopeId}::uuid, ${command.expectedVersion}, ${command.reasonKey}::varchar,
            ${command.reasonNote ?? null}::varchar, ${Buffer.from(command.idempotencyKeyHash)}::bytea,
            ${Buffer.from(command.requestFingerprint)}::bytea, uuidv7(), null
          )`.execute(trx)
        ).rows[0],
    );
    if (!result) throw new Error("Source Authority revocation returned no result");
    return {
      scopeId: parseUuidV7(result.scopeId, "SourceAuthorityScopeId") as SourceAuthorityScopeId,
      version: Number(result.version),
      replayed: result.replayed,
    };
  }

  public close(): Promise<void> {
    return this.db.destroy();
  }
}
