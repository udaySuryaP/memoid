# Foundation architecture

Memoid is a TypeScript modular monolith with independently started web, API, and worker processes. `packages/domain` is framework-free; `packages/application` may depend only on domain and contracts; provider and persistence code stays behind ports in `packages/adapters`, `auth`, `db`, `jobs`, and `observability`.

The web runtime is Next.js App Router. The API is Fastify. The worker hosts pg-boss consumers. PostgreSQL is authoritative; Kysely owns forward migrations. Tenant data access must run inside a transaction using transaction-local `memoid.tenant_id`, with forced RLS as the database backstop.

This stage contains synthetic probes only. It does not define Memoid product entities, routes, tools, sync logic, exports, or destructive behavior.
