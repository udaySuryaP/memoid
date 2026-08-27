# Security foundation

- Secrets are parsed at process startup and never exposed through public config.
- Authentication, authorization, step-up, return-intent, storage, KMS, GitHub, model, and analytics are explicit boundaries.
- Logs redact authorization, cookies, passwords, tokens, secrets, API keys, and private keys.
- Tenant SQL uses a transaction-local tenant context; forced RLS is tested with one reused pool.
- The application role neither owns tenant tables nor has `BYPASSRLS`.
- CI runs secret scans, dependency review, lockfile verification, audit, pinned actions, and least-privilege permissions.

These synthetic examples are not a product threat model. Product authorization and deletion semantics remain outside Stage 8B.
