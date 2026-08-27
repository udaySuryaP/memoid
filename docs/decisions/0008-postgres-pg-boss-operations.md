# ADR 0008: PostgreSQL and pg-boss asynchronous operations

Status: Accepted by Stage 8; synthetic foundation executed in Stage 8B; repository record added in Stage 8C.

## Decision status

- **LOCKED:** use PostgreSQL-backed pg-boss with durable Memoid Operation state for initial V1 asynchronous work.
- **LOCKED:** queue claim/delivery semantics never substitute for application-level idempotency, transactional uniqueness, preconditions, or current authorization.
- **LOCKED:** long-running work rechecks authorization and Project/grant/deletion state at submission, protected access, and final commit.
- **LOCKED:** no Redis queue is introduced initially.
- **PROVISIONAL:** queue names, retry/backoff, retention, concurrency, cancellation, and operational thresholds.
- **Proof-gated:** crash/retry/replay, stale-base, cancellation, authorization revocation, and external-side-effect idempotency require real PostgreSQL tests.
- **Implementation deferred:** product jobs and Operation persistence are not implemented; Stage 8B contains one synthetic pg-boss proof only.

## Decision

Keep queueing and transactional state in PostgreSQL to reduce initial distributed-system complexity. Business handlers own exactly-once effects through idempotent domain transitions; pg-boss provides durable delivery and claiming only. MCP Tasks or host-specific task primitives may map to Memoid Operation state but never define it.
