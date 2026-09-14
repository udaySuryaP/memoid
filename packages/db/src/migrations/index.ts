import type { Migration, MigrationProvider } from "kysely/migration";
import { foundationMigration } from "./001-foundation-rls.js";
import { stage10aDomainSchemaMigration } from "./002-stage10a-domain-schema.js";
import { stage10bActorAuditOperationMigration } from "./003-stage10b-actor-audit-operation.js";
import { stage10cIdentityAuthzRlsMigration } from "./004-stage10c-identity-authz-rls.js";
import { stage10dWorkspaceProjectMigration } from "./005-stage10d-workspace-project.js";
import { stage10eGitHubSourceProviderIdentityMigration } from "./006-stage10e-github-source-provider-identity.js";
import { stage10fIngestionEvidenceMigration } from "./007-stage10f-ingestion-evidence.js";
import { stage10gSourceAuthorityMigration } from "./008-stage10g-source-authority.js";
import { stage10hContextRecordsProvenanceMigration } from "./009-stage10h-context-records-provenance.js";

export class MemoidMigrationProvider implements MigrationProvider {
  public async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_foundation_rls": foundationMigration,
      "002_stage10a_domain_schema": stage10aDomainSchemaMigration,
      "003_stage10b_actor_audit_operation": stage10bActorAuditOperationMigration,
      "004_stage10c_identity_authz_rls": stage10cIdentityAuthzRlsMigration,
      "005_stage10d_workspace_project": stage10dWorkspaceProjectMigration,
      "006_stage10e_github_source_provider_identity": stage10eGitHubSourceProviderIdentityMigration,
      "007_stage10f_ingestion_evidence": stage10fIngestionEvidenceMigration,
      "008_stage10g_source_authority": stage10gSourceAuthorityMigration,
      "009_stage10h_context_records_provenance": stage10hContextRecordsProvenanceMigration,
    };
  }
}
