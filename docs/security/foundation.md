# Security foundation

- Secrets are parsed at process startup and never exposed through public config.
- Authentication, authorization, step-up, return-intent, storage, KMS, GitHub, model, and analytics are explicit boundaries.
- Logs redact authorization, cookies, passwords, tokens, secrets, API keys, and private keys.
- Tenant SQL uses a transaction-local tenant context; forced RLS is tested with one reused pool.
- The application role neither owns tenant tables nor has `BYPASSRLS`.
- CI runs secret scans, lockfile verification, a moderate-threshold dependency audit, pinned actions, and least-privilege permissions.
- GitHub dependency review is present but gated by the `ENABLE_DEPENDENCY_REVIEW` repository variable because GitHub Advanced Security does not expose the dependency-review API to this private personal repository. Enable it after moving the repository to a plan that supports the API.

These synthetic examples are not a product threat model. Product authorization and deletion semantics remain outside Stage 8B.
