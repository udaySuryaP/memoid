# Memoid

Production repository foundation for Memoid Stage 8B. This repository deliberately contains **no Memoid vertical product feature**. It proves the approved runtime, package, security, database, provider, UI, test, and CI boundaries before the Stage 9 readiness audit.

## Prerequisites

- Node.js 24.18.x
- pnpm 11.24.x through Corepack
- Docker with Compose for PostgreSQL proofs

## Start

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres postgres-test
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web: `http://localhost:3000` · API health: `http://localhost:3001/health`

## Verification

```sh
pnpm qa
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm secrets:scan
```

Database tests use only the synthetic `foundation.tenant_probe` table. `pg-boss` is infrastructure; it does not replace Memoid application idempotency or domain concurrency rules.

Start with [AGENTS.md](./AGENTS.md) and [the architecture guide](./docs/architecture/foundation.md). Stage 9 and product implementation remain blocked pending HQ reconciliation.
