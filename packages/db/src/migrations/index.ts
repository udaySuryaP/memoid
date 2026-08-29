import type { Migration, MigrationProvider } from "kysely/migration";
import { foundationMigration } from "./001-foundation-rls.js";
import { stage10aDomainSchemaMigration } from "./002-stage10a-domain-schema.js";

export class MemoidMigrationProvider implements MigrationProvider {
  public async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_foundation_rls": foundationMigration,
      "002_stage10a_domain_schema": stage10aDomainSchemaMigration,
    };
  }
}
