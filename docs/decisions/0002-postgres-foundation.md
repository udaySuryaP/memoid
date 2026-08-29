# ADR 0002: PostgreSQL, Kysely, and RLS foundation

Status: Accepted by Stage 8; foundation executed in Stage 8B; Stage 10A product schema executed under this decision.

## Decision status

- **LOCKED:** PostgreSQL 18 is the primary transactional system; Kysely/`pg` owns typed access and forward migrations.
- **LOCKED:** application authorization is primary and PostgreSQL RLS is defense-in-depth.
- **LOCKED:** tenant context is transaction-scoped and pooling-safe; reusable session-scoped tenant state is prohibited.
- **LOCKED:** no Redis, vector database, or embedding pipeline in initial V1 without measured need.
- **PROVISIONAL:** exact production pooler, connection limits, full-text ranking, and operational thresholds.
- **Proof-gated:** every product tenant table must prove forced-RLS isolation and owner/`BYPASSRLS` separation before release.
- **Implemented in 10A:** foundational product tables and reversible migration structure. Runtime RLS policies/grants remain deferred to 10C; retention and production-hardening mechanisms remain deferred to their owning stages.

## Decision

Use one PostgreSQL system for referential integrity, immutable-history invariants, concurrency control, full-text search, durable operation state, and queueing. Application roles must neither own protected tenant tables nor bypass RLS. Tests must reuse pooled connections to prove that transaction-local tenant context cannot leak between requests.

The asynchronous operation decision is recorded separately in [ADR 0008](./0008-postgres-pg-boss-operations.md).
