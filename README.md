# Memoid

Memoid is a source-aware context control plane for AI-native software projects. Its primary founder-directed product loop is durable cross-AI Project-context continuity: an authorized client resumes with a task-specific qualified Context Pack, the user works, an explicit checkpoint submits meaningful Candidate Evidence, Memoid reconciles it into Working Context, and the Project review policy controls whether eligible changes become Reviewed Durable Context. GitHub is complementary authoritative Source evidence for applicable implementation facts, not the primary product loop.

Memoid is **not market-validated**. Stage 2 concluded **DO NOT BUILD / KILL** because the tested competent repository-native baseline did not justify an additional maintained context layer. Full development continues only because the founder issued a locked **BUILD FULL PRODUCT** override. That execution decision does not reverse or soften the evidence.

## Repository contract baseline

This repository's implementation contract is synchronized through the **HQ-reconciled Stage 9C** product/domain/security/engine/workflow baseline. Repository files define implementation boundaries, ordering, proof gates, and drift-prevention contracts; they do **not independently authorize a current workstream**.

Before implementing any product vertical, verify explicit authorization against the current canonical `00 - MEMOID HQ` / project state. A later HQ authorization of 10A, 10B, or another vertical does not require a repository status-only patch: execution authorization is owned by HQ, while this repository owns the durable implementation contract.

This repository contains the production-oriented foundation, repository-native implementation contract, the Stage 10A domain/schema implementation, the Stage 10B Actor/Audit/idempotency/Operation foundations, the bounded Stage 10C identity/session/authorization/RLS implementation, and the Stage 10D personal Workspace/private Project lifecycle. The repository does not independently authorize any current or later product vertical.

## Architecture foundation

- TypeScript modular monolith in a private pnpm/Turborepo monorepo.
- Separate Next.js web, Fastify API/MCP, and pg-boss worker process roles around one Domain/Application Core; these roles are not microservices.
- PostgreSQL 18 with Kysely/`pg`; application authorization is primary and transaction-scoped RLS is defense-in-depth.
- Stage 10A adds the provider-free domain kernel and deny-by-default `memoid` schema for the four integrity planes, versioned Project review policy, gap-safe Candidate frontier, per-Source/ref frontiers, Context Identity/currentness, and provenance/coverage foundations.
- Stage 10B adds provider-neutral Actor attribution, append-only sanitized Audit Events, transactionally scoped idempotency, durable Operation/attempt leases, provider-event receipts, opaque correlation/causation, and desired/processed lost-wakeup protection. It grants no product runtime access and implements no later vertical.
- Stage 10C adds hosted WorkOS AuthKit/PKCE authentication, verified subject-to-Account binding, Memoid-owned opaque revocable sessions, one-time fresh-auth step-up, Account-bound human Actors, a closed capability evaluator, least-privilege `memoid_app` grants, and forced transaction-scoped RLS across every product table. It does not implement 10D or later product behavior.
- Stage 10D formalizes the immutable one-Account personal Workspace, adds active/private source-less Project creation and bounded metadata updates, initializes MANUAL-by-default review policy, and proves current-session revalidation, Actor attribution, audit, idempotent replay, optimistic concurrency, and archived-resource denial. It adds no team membership, invitation, GitHub, Source, archive command, delete, or restore behavior.
- MCP v2 split SDK packages with remote Streamable HTTP as the hosted adapter direction.
- Read-only GitHub App using selective Source ingestion; no durable repository mirror.
- Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1. Source synchronization is Memoid/server-controlled.
- Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context are separate integrity planes and must remain visibly and semantically distinguishable.
- `MANUAL` is the fail-safe/default Project review policy; `AUTOMATIC` is explicit and may only apply changes the Memoid policy engine positively proves eligible. A model never approves itself.
- A checkpoint request authorizes submission of extracted candidate material; it does not confirm every AI-inferred assertion. Candidate-origin/confirmation provenance must be preserved.
- Successfully accepted checkpoints remain available as explicitly lower-trust pending/unreconciled continuity during model-provider failure after deterministic authorization, validation, secret scanning, minimization, and qualification.
- Candidate Reconciled Frontier is contiguous/gap-safe rather than `max(sequence processed)` when gaps exist.
- Git commit count is not Memoid semantic-change count; non-default branches cannot silently replace default-branch current implementation truth.
- Reconciliation and Resume/Context Pack generation are separate pipelines.
- PostgreSQL full-text retrieval and pg-boss; no Redis, vector database, or embeddings in initial V1.
- Render, S3/KMS, OpenTelemetry, and Grafana directions, with proof-gated details recorded in the ADRs.

See [the ADR index](./docs/decisions/README.md), [the architecture guide](./docs/architecture/foundation.md), [the Stage 10A domain/schema inventory](./docs/architecture/domain-kernel-schema.md), [the Stage 10B actor/audit/operation inventory](./docs/architecture/actor-audit-operation.md), [the Stage 10C security inventory](./docs/architecture/identity-sessions-authorization-rls.md), [the Stage 10D Workspace/Project challenge](./docs/implementation/stage10d-workspace-project-challenge.md), [the Stage 10 entry map](./docs/implementation/stage10-entry-map.md), and the complete [Stage 9C failure/race contract](./docs/implementation/stage9c-failure-race-contract.json).

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

Application runtimes must not use database owner/admin credentials. Authenticated product work must use `memoid_app` and the transaction-scoped security wrapper. Database tests use synthetic isolated databases and the non-owner role. `pg-boss` is infrastructure and never replaces application idempotency or domain concurrency rules.

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

Direct pushes to `main` are prohibited by governance even where GitHub cannot technically enforce them. The repository defines what implementation is allowed and what proof gates apply; `00 - MEMOID HQ` defines which workstream is currently authorized. Always check current canonical HQ/project authorization before starting or merging a vertical.

Coding agents should start with [AGENTS.md](./AGENTS.md).
