# Memoid

Memoid is a source-aware context control plane for AI-native software projects. Its primary founder-directed product loop is durable cross-AI Project-context continuity: an authorized client resumes with a task-specific qualified Context Pack, the user works, an explicit checkpoint submits meaningful Candidate Evidence, Memoid reconciles it into Working Context, and the Project review policy controls whether eligible changes become Reviewed Durable Context. GitHub is complementary authoritative Source evidence for applicable implementation facts, not the primary product loop.

Memoid is **not market-validated**. Stage 2 concluded **DO NOT BUILD / KILL** because the tested competent repository-native baseline did not justify an additional maintained context layer. Full development continues only because the founder issued a locked **BUILD FULL PRODUCT** override. That execution decision does not reverse or soften the evidence.

## Current status

- Stage 8B: **COMPLETE — HQ RECONCILED AFTER CORRECTION**.
- Stage 8C: **COMPLETE — HQ RECONCILED**.
- Stage 9: **COMPLETE — PASS AFTER STAGE 9A CORRECTIONS — HQ RECONCILED**.
- Stage 9A: **COMPLETE — HQ RECONCILED**.
- Stage 9B: **COMPLETE — HQ RECONCILED**.
- Stage 9C: **COMPLETE — HQ RECONCILED WITH CLARIFICATIONS**.
- Stage 9D: **ACTIVE — REPOSITORY IMPLEMENTATION-CONTRACT SYNCHRONIZATION**.
- Stage 10/10A: **BLOCKED UNTIL STAGE 9D HQ RECONCILIATION AND EXPLICIT HQ RE-AUTHORIZATION**.

This repository therefore contains a production-oriented, non-feature foundation and repository-native implementation contract only. It does not implement Projects, Sources, Candidate Submissions, Working Context, Context Records, Change Proposals, reconciliation, Context Revisions, Context Packs, product MCP tools, authentication flows, export, archive/delete, or the product database schema.

## Architecture foundation

- TypeScript modular monolith in a private pnpm/Turborepo monorepo.
- Separate Next.js web, Fastify API/MCP, and pg-boss worker process roles around one Domain/Application Core; these roles are not microservices.
- PostgreSQL 18 with Kysely/`pg`; application authorization is primary and transaction-scoped RLS is defense-in-depth.
- WorkOS AuthKit direction with Memoid-owned stable identity, session, authorization, and security state.
- MCP v2 split SDK packages with remote Streamable HTTP as the hosted adapter direction.
- Read-only GitHub App using selective Source ingestion; no durable repository mirror.
- Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1. Source synchronization is Memoid/server-controlled.
- Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context are separate integrity planes and must remain visibly and semantically distinguishable.
- `MANUAL` is the fail-safe/default Project review policy; `AUTOMATIC` is explicit and may only apply changes the Memoid policy engine positively proves eligible. A model never approves itself.
- A checkpoint request authorizes submission of extracted candidate material; it does not confirm every AI-inferred assertion. Candidate-origin/confirmation provenance must be preserved.
- Successfully accepted checkpoints remain available as explicitly lower-trust pending/unreconciled continuity during model-provider failure after deterministic authorization, validation, secret scanning, minimization, and qualification.
- PostgreSQL full-text retrieval and pg-boss; no Redis, vector database, or embeddings in initial V1.
- Render, S3/KMS, OpenTelemetry, and Grafana directions, with proof-gated details recorded in the ADRs.

See [the ADR index](./docs/decisions/README.md) for decision status, [the architecture guide](./docs/architecture/foundation.md) for package boundaries, and [the Stage 10 entry map](./docs/implementation/stage10-entry-map.md) for the implementation order and proof gates.

## Prerequisites

- Node.js 24.20.x (Node 24 LTS; later secure Node 24 patches remain allowed)
- pnpm 11.24.x through Corepack
- Docker with Compose for PostgreSQL proofs
- Chromium installed through Playwright for browser verification

## Local setup

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres postgres-test
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web: `http://localhost:3000` · API liveness: `http://localhost:3001/health` · dependency readiness: `http://localhost:3001/ready`

## Environment model

Copy `.env.example` to `.env` for local development. The example contains synthetic local-only values. Development, test, staging, and production must use separate credentials, databases, OAuth/GitHub registrations, storage, encryption keys, and telemetry boundaries. Production data must not flow into lower environments by default. Never commit `.env` files or reusable credentials.

Application runtimes must not use database owner/admin credentials. Database tests use only the synthetic `foundation.tenant_probe` table. `pg-boss` is infrastructure and never replaces application idempotency or domain concurrency rules.

`/health` is process liveness only and does not contact PostgreSQL. `/ready` performs a bounded, read-only PostgreSQL probe using application credentials; it returns HTTP 503 with a sanitized body when PostgreSQL is unavailable. Configure the bound with `DATABASE_READINESS_TIMEOUT_MS` (default 2000 ms, allowed range 100–10000 ms).

## Verification

Install exactly from the committed lockfile before verification:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:security
pnpm traceability:check
pnpm build
pnpm secrets:scan
pnpm audit --audit-level moderate
pnpm sast
```

Run the real PostgreSQL/RLS/pg-boss proofs with the test database available:

```sh
docker compose up -d postgres-test
pnpm db:migrate
pnpm test:integration
```

Run browser, accessibility, and visual regression checks with:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm qa` runs the normal format, lint/dependency-boundary, type, traceability, unit, and production-build checks. The GitHub **Security** workflow additionally runs `test:security`, SAST, Secretlint, dependency audit, and gitleaks. GitHub dependency review remains capability-gated; see [repository governance](./docs/governance/repository.md).

## Governance

The canonical product specification and master roadmap outrank repository guidance. During founder-only development, every change follows:

**feature branch → CI/security → pull request → HQ review → merge**

Do not work directly on `main`, treat the founder override as market validation, merge the Stage 9D PR without HQ authorization, or begin Stage 10/10A before Stage 9D is HQ-reconciled and HQ explicitly re-authorizes implementation. Current GitHub plan limitations and the required pre-collaboration enforcement upgrades are recorded in [repository governance](./docs/governance/repository.md).

Coding agents should start with [AGENTS.md](./AGENTS.md).
