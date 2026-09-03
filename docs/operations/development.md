# Development operations

Use the pinned Node 24.20.0 and pnpm lines. Copy `.env.example` to `.env`, start both PostgreSQL services, migrate and seed, then start all runtimes with `pnpm dev`. `/health` proves only that the API process is live. `/ready` performs a bounded, read-only `SELECT 1` through the application PostgreSQL credentials and returns HTTP 503 with no connection details when the dependency is unavailable. `DATABASE_READINESS_TIMEOUT_MS` defaults to 2000 ms and is constrained to 100–10000 ms.

Stage 10C web authentication additionally requires `AUTH_DATABASE_URL` using the narrow `memoid_auth` role, a WorkOS API key/client ID, webhook signing secret, the exact public `MEMOID_APP_ORIGIN`, and at least 32 random base64url-encoded bytes in `MEMOID_AUTH_FLOW_SECRET`. Register `${MEMOID_APP_ORIGIN}/auth/callback` with AuthKit and deliver signed WorkOS events to `${MEMOID_APP_ORIGIN}/webhooks/workos`. Never give normal product handlers `AUTH_DATABASE_URL`; never reuse the API key, webhook secret, or flow-state key; and never expose them to client bundles.

Do not use owner/admin credentials in an application runtime. Stop with `docker compose down`; add `-v` only when deliberately discarding synthetic local data.
