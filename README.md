# Memoid

Memoid is a source-aware context control plane for AI-native software projects. It is intended to maintain a reviewed, provenance-linked representation of project context while respecting the authority of repositories and other underlying Sources.

Memoid is **not market-validated**. Stage 2 concluded **DO NOT BUILD / KILL** because the tested competent repository-native baseline did not justify an additional maintained context layer. Full development continues only because the founder issued a locked **BUILD FULL PRODUCT** override. That execution decision does not reverse or soften the evidence.

## Current status

- Stage 8B repository/environment foundation: **COMPLETE — HQ RECONCILED AFTER CORRECTION**.
- Stage 8C: **ACTIVE — PRE-STAGE-9 READINESS CORRECTIONS**. This branch changes governance, documentation, and security tooling only.
- Stage 9: **NOT YET FORMALLY EXECUTED** and blocked until Stage 8C is reconciled by HQ.
- Stage 10 product implementation: **BLOCKED** until Stage 9 passes.

This repository therefore contains a production-oriented, non-feature foundation only. It does not implement Projects, Sources, Context Records, Change Proposals, reconciliation, Context Revisions, Context Packs, product MCP tools, authentication flows, export, archive/delete, or the product database schema.

## Architecture foundation

- TypeScript modular monolith in a private pnpm/Turborepo monorepo.
- Separate Next.js web, Fastify API/MCP, and pg-boss worker process roles around one Domain/Application Core; these roles are not microservices.
- PostgreSQL 18 with Kysely/`pg`; application authorization is primary and transaction-scoped RLS is defense-in-depth.
- WorkOS AuthKit direction with Memoid-owned stable identity, session, authorization, and security state.
- MCP v2 split SDK packages with remote Streamable HTTP as the hosted adapter direction.
- Read-only GitHub App using selective Source ingestion; no durable repository mirror.
- PostgreSQL full-text retrieval and pg-boss; no Redis, vector database, or embeddings in initial V1.
- Render, S3/KMS, OpenTelemetry, and Grafana directions, with proof-gated details recorded in the ADRs.

See [the ADR index](./docs/decisions/README.md) for decision status and [the architecture guide](./docs/architecture/foundation.md) for package boundaries.

## Prerequisites

- Node.js 24.18.x
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

Web: `http://localhost:3000` · API health: `http://localhost:3001/health`

## Environment model

Copy `.env.example` to `.env` for local development. The example contains synthetic local-only values. Development, test, staging, and production must use separate credentials, databases, OAuth/GitHub registrations, storage, encryption keys, and telemetry boundaries. Production data must not flow into lower environments by default. Never commit `.env` files or reusable credentials.

Application runtimes must not use database owner/admin credentials. Database tests use only the synthetic `foundation.tenant_probe` table. `pg-boss` is infrastructure and never replaces application idempotency or domain concurrency rules.

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

Do not work directly on `main`, treat the founder override as market validation, or begin a later stage without explicit HQ authorization. Current GitHub plan limitations and the required pre-collaboration enforcement upgrades are recorded in [repository governance](./docs/governance/repository.md).

Coding agents should start with [AGENTS.md](./AGENTS.md).
