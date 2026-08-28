# Foundation architecture

Memoid is a TypeScript modular monolith with independently started web, API, and worker processes. `packages/domain` is framework-free; `packages/application` may depend only on domain and contracts; provider and persistence code stays behind ports in `packages/adapters`, `auth`, `db`, `jobs`, and `observability`.

The web runtime is Next.js App Router. The API is Fastify. The worker hosts pg-boss consumers. PostgreSQL is authoritative; Kysely owns forward migrations. Tenant data access must run inside a transaction using transaction-local `memoid.tenant_id`, with forced RLS as the database backstop.

This stage contains synthetic probes only. It does not define Memoid product entities, routes, tools, sync logic, exports, or destructive behavior.

Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1. GitHub Source ingestion and synchronization remain Memoid/server-controlled; external clients may use authorized read, status, candidate-evidence, and reconciliation capabilities only.

The primary product contract is cross-AI Project-context continuity. Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context are independent integrity planes. Checkpoint/reconciliation and task-specific Resume Context Pack generation are separate pipelines; neither is a generic summarization path.

The Memoid Engine is deterministic plus model-assisted. Memoid owns authorization and Project binding, validation, size limits, secret scanning/redaction, normalization/minimization, qualification, deduplication, frontiers, evidence retrieval, Source Authority, compaction, structured-output and evidence-reference validation, policy evaluation, Proposal creation, and Context Revision application. A provider-neutral model port supplies untrusted semantic reasoning only. The model cannot approve itself, authorize access, change Source Authority or review policy, bypass a frontier, or write trusted Context Records directly.

Candidate intake must establish enough deterministic safe continuity before model use that an accepted checkpoint remains available as explicitly pending/unreconciled lower-trust context during provider outage, quota exhaustion, 429, timeout, or invalid structured output. Exact storage and Resume presentation remain proof-gated to 10A/10O.

Consequential accepted decisions, including provisional and proof-gated boundaries, are indexed in `docs/decisions/README.md`.
