# Architecture decision records

These ADRs record consequential accepted architecture without turning provisional or proof-gated directions into final implementation claims.

1. [TypeScript modular monolith and process model](./0001-modular-monolith.md)
2. [PostgreSQL, Kysely, and RLS foundation](./0002-postgres-foundation.md)
3. [Stage 8A design-token and UI-system foundation](./0003-component-workbench.md)
4. [Constrained reconciliation and provider ports](./0004-provider-ports.md)
5. [WorkOS AuthKit and Memoid-owned security state](./0005-workos-authkit-session-boundary.md)
6. [MCP v2 split SDK and Streamable HTTP adapter](./0006-mcp-v2-streamable-http.md)
7. [Read-only GitHub App and selective Source ingestion](./0007-github-readonly-source-ingestion.md)
8. [PostgreSQL and pg-boss asynchronous operations](./0008-postgres-pg-boss-operations.md)
9. [Deletion fencing and restore anti-resurrection](./0009-deletion-fencing-restore.md)
10. [Hosting, storage, KMS, and observability topology](./0010-hosting-storage-observability.md)
11. [Candidate continuity and Project review policy](./0011-candidate-continuity-review-policy.md)

Status vocabulary:

- **LOCKED:** accepted canonical architecture for the authorized build.
- **PROVISIONAL:** a current direction that may change without reopening locked product semantics.
- **Proof-gated:** cannot be treated as release-ready until the named evidence exists.
- **Implementation deferred:** intentionally recorded but not implemented by the Stage 8B/8C foundation.

The cross-cutting implementation-time decision register is maintained in the [Stage 10 entry map](../implementation/stage10-entry-map.md). It does not supersede these ADRs or the canonical Notion hierarchy.
