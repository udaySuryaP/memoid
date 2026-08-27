# Development operations

Use the pinned Node and pnpm lines. Copy `.env.example` to `.env`, start both PostgreSQL services, migrate and seed, then start all runtimes with `pnpm dev`. `/health` proves the API process; `/ready` is the dependency-aware probe.

Do not use owner/admin credentials in an application runtime. Stop with `docker compose down`; add `-v` only when deliberately discarding synthetic local data.
