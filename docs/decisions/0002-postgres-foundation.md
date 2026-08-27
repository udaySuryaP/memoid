# ADR 0002: PostgreSQL foundation

Status: Accepted by Stage 8; executed in Stage 8B.

Use PostgreSQL 18, Kysely/pg, transaction-local RLS context, and pg-boss. Do not introduce Redis or vector infrastructure before measured need. Queue claim semantics do not replace application idempotency.
