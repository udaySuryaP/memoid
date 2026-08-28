# Development operations

Use the pinned Node 24.20.0 and pnpm lines. Copy `.env.example` to `.env`, start both PostgreSQL services, migrate and seed, then start all runtimes with `pnpm dev`. `/health` proves only that the API process is live. `/ready` performs a bounded, read-only `SELECT 1` through the application PostgreSQL credentials and returns HTTP 503 with no connection details when the dependency is unavailable. `DATABASE_READINESS_TIMEOUT_MS` defaults to 2000 ms and is constrained to 100–10000 ms.

Do not use owner/admin credentials in an application runtime. Stop with `docker compose down`; add `-v` only when deliberately discarding synthetic local data.
