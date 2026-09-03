# ADR 0005: WorkOS AuthKit and Memoid-owned security state

Status: Accepted by Stage 8; bounded implementation completed in Stage 10C.

## Decision status

- **LOCKED:** WorkOS AuthKit is the V1 identity/authentication-provider and OAuth authorization-server direction.
- **LOCKED:** Memoid owns stable Account identity, opaque revocable browser sessions, current authorization/grant state, and high-risk-operation policy.
- **LOCKED:** local sessions cannot outlive relevant WorkOS revocation, recovery, reset, or equivalent high-risk security state.
- **LOCKED:** strong authentication is Memoid policy evaluated from provider assurance; hosted provider UX is not reimplemented as custom passkey management.
- **RESOLVED FOR 10C:** the bounded defaults are 24-hour absolute, 1-hour idle, 15-minute fresh-auth, and 5-minute provider revalidation; provider expiry may shorten every window.
- **PROOF-GATED AND IMPLEMENTED:** verified subject binding, provider-event invalidation, one-time step-up rotation, PKCE/state, mutation-origin enforcement, current authorization, and forced-RLS isolation have local security/integration tests.
- **IMPLEMENTED IN 10C:** hosted authentication transitions, local session persistence, security screens, and provider-neutral authorization foundations. OAuth client consent and later product capabilities remain with their owning verticals.

## Decision

Treat WorkOS authentication as identity evidence, not as Memoid authorization. Resolve provider identity to stable Memoid-owned subjects and current grants on every relevant boundary. Use Secure, HttpOnly, minimally scoped cookies for browser sessions and preserve pending high-integrity intent across provider-hosted step-up flows without allowing stale or replayed intent.

Machine credentials never receive human semantic-review authority. External AI clients cannot approve Change Proposals, resolve Conflicts, change Source Authority, or perform destructive security administration.
