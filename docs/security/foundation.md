# Security foundation

- Secrets are parsed at process startup and never exposed through public config.
- Authentication, authorization, step-up, return-intent, storage, KMS, GitHub, model, and analytics are explicit boundaries.
- Logs redact authorization, cookies, passwords, tokens, secrets, API keys, and private keys.
- Tenant SQL uses a transaction-local tenant context; forced RLS is tested with one reused pool.
- The application role neither owns tenant tables nor has `BYPASSRLS`.
- `pnpm test:security` runs the foundation security tests independently from the generic suite.
- `pnpm sast` runs a pinned, curated `eslint-plugin-security` JavaScript/TypeScript static scan at error severity. The Security workflow fails on a finding or scanner error.
- CI runs the dedicated security tests, SAST, Secretlint, lockfile verification, a moderate-threshold dependency audit, gitleaks, pinned actions, and least-privilege permissions.
- CodeQL is preferred when supported, but private-repository code scanning is unavailable to this personal repository under its current plan/ownership model. **SAST remains required.**
- GitHub dependency review is present but gated by the `ENABLE_DEPENDENCY_REVIEW` repository variable because the dependency-review API is unavailable to this private personal repository. Enable it only after the repository has an eligible organization plan plus GitHub Code Security.
- Candidate semantic items must preserve assertion-origin/confirmation provenance sufficient to distinguish explicit user-authored or sufficiently user-confirmed assertions, AI-inferred assertions, and Source/system-derived assertions. Exact persisted enum/type names remain proof-gated.
- Requesting a checkpoint authorizes submission of the extracted checkpoint; it is not blanket confirmation of AI-extracted facts. A purely AI-inferred assertion cannot become automatically eligible solely because the user checkpointed, the model is confident, or the submitting client marked it important.
- Project review-policy changes are first-party, high-integrity, step-up-protected, monotonic-versioned, prospective, and audited. `MANUAL` is the fail-safe/default when policy is absent or legacy. The Memoid policy engine, not a model, must positively prove every automatic eligibility condition against current policy, Source/Candidate frontiers, and current reviewed state.
- Before any model call, candidate intake performs deterministic authorization, exact Project binding, validation, secret scanning, size enforcement, normalization/minimization, and safe qualification. Provider failure cannot discard an accepted checkpoint; any pending/unreconciled continuity remains lower trust and cannot override authoritative Source state, Reviewed Durable Context, Conflict, or Uncertainty.
- Fallback model providers are explicitly configured, allowlisted, privacy-compatible, and auditable. Private customer data is never silently routed to an arbitrary provider after failure.

See `docs/governance/repository.md` for the verified plan boundaries and manual merge control.

These repository contracts are not runtime product implementations. Product authorization, review-policy execution, candidate persistence, model adapters, and deletion semantics remain outside Stage 9D.
