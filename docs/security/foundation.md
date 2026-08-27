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

See `docs/governance/repository.md` for the verified plan boundaries and manual merge control.

These synthetic examples are not a product threat model. Product authorization and deletion semantics remain outside Stage 8B.
