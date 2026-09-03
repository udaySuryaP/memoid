import type { Migration, MigrationProvider } from "kysely/migration";
import { foundationMigration } from "./001-foundation-rls.js";
import { stage10aDomainSchemaMigration } from "./002-stage10a-domain-schema.js";
import { stage10bActorAuditOperationMigration } from "./003-stage10b-actor-audit-operation.js";
import { stage10cIdentityAuthzRlsMigration } from "./004-stage10c-identity-authz-rls.js";
import { stage10dWorkspaceProjectMigration } from "./005-stage10d-workspace-project.js";

export class MemoidMigrationProvider implements MigrationProvider {
  public async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_foundation_rls": foundationMigration,
      "002_stage10a_domain_schema": stage10aDomainSchemaMigration,
      "003_stage10b_actor_audit_operation": stage10bActorAuditOperationMigration,
      "004_stage10c_identity_authz_rls": stage10cIdentityAuthzRlsMigration,
      "005_stage10d_workspace_project": stage10dWorkspaceProjectMigration,
    };
  }
}
