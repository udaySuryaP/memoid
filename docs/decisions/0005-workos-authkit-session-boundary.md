# ADR 0005: WorkOS AuthKit and Memoid-owned security state

Status: Accepted by Stage 8; repository record added in Stage 8C.

## Decision status

- **LOCKED:** WorkOS AuthKit is the V1 identity/authentication-provider and OAuth authorization-server direction.
- **LOCKED:** Memoid owns stable Account identity, opaque revocable browser sessions, current authorization/grant state, and high-risk-operation policy.
- **LOCKED:** local sessions cannot outlive relevant WorkOS revocation, recovery, reset, or equivalent high-risk security state.
- **LOCKED:** strong authentication is Memoid policy evaluated from provider assurance; hosted provider UX is not reimplemented as custom passkey management.
- **PROVISIONAL:** exact session/token lifetimes, assurance mapping, event matrix, and provider plan details.
- **Proof-gated:** session invalidation, recovery, step-up return intent, CSRF, issuer/audience/PKCE, and current-grant checks must pass integration/security tests.
- **Implementation deferred:** product authentication, session persistence, OAuth consent, and security screens are not implemented in the foundation.

## Decision

Treat WorkOS authentication as identity evidence, not as Memoid authorization. Resolve provider identity to stable Memoid-owned subjects and current grants on every relevant boundary. Use Secure, HttpOnly, minimally scoped cookies for browser sessions and preserve pending high-integrity intent across provider-hosted step-up flows without allowing stale or replayed intent.

Machine credentials never receive human semantic-review authority. External AI clients cannot approve Change Proposals, resolve Conflicts, change Source Authority, or perform destructive security administration.
