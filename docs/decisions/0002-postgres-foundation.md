# ADR 0002: PostgreSQL, Kysely, and RLS foundation

Status: Accepted by Stage 8; foundation executed in Stage 8B; repository record aligned in Stage 8C.

## Decision status

- **LOCKED:** PostgreSQL 18 is the primary transactional system; Kysely/`pg` owns typed access and forward migrations.
- **LOCKED:** application authorization is primary and PostgreSQL RLS is defense-in-depth.
- **LOCKED:** tenant context is transaction-scoped and pooling-safe; reusable session-scoped tenant state is prohibited.
- **LOCKED:** no Redis, vector database, or embedding pipeline in initial V1 without measured need.
- **PROVISIONAL:** exact production pooler, connection limits, full-text ranking, and operational thresholds.
- **Proof-gated:** every product tenant table must prove forced-RLS isolation and owner/`BYPASSRLS` separation before release.
- **Implementation deferred:** product tables, retention rules, and production migrations begin only in an authorized implementation stage.

## Decision

Use one PostgreSQL system for referential integrity, immutable-history invariants, concurrency control, full-text search, durable operation state, and queueing. Application roles must neither own protected tenant tables nor bypass RLS. Tests must reuse pooled connections to prove that transaction-local tenant context cannot leak between requests.

The asynchronous operation decision is recorded separately in [ADR 0008](./0008-postgres-pg-boss-operations.md).
