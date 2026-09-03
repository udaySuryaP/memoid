# Stage 10C identity, sessions, authorization, and RLS

Stage 10C turns the deny-by-default Stage 10A/10B schema into a narrowly usable authenticated security boundary. It implements no Workspace/Project lifecycle beyond creating the one schema-required Personal Workspace when a new verified Account is first bound, and it does not start 10D or any later product vertical.

## Authentication and Account binding

The application port is provider-neutral; `WorkOsAuthProvider` is the only production adapter. The web layer reaches PostgreSQL only through the auth-owned `MemoidAuthSessionStore`; it never imports or receives a database handle. Hosted AuthKit owns credential, passkey, MFA, verification, recovery, and reauthentication UX. Memoid accepts a callback only after PKCE/state validation, active provider-session lookup, verified email, stable WorkOS User subject, and non-impersonated evidence.

`account_identity_bindings` maps `(provider_key, provider_subject)` to a stable Memoid Account UUIDv7. Email is normalized verified evidence, never identity or authority. The same subject retains its Account across verified email changes. A different subject presenting an already-bound email fails with `IDENTITY_LINK_AMBIGUOUS`; Memoid never silently merges Accounts.

## Local sessions and step-up

The browser receives only `__Host-memoid_session`, containing 256 random bits with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. PostgreSQL stores its SHA-256 hash. Sessions bind Account, identity binding, WorkOS session, security epoch, provider expiry/recheck horizon, activity, absolute/idle expiry, freshness, rotation lineage, and revocation.

Ordinary protected navigation rechecks provider status every five minutes. A signed `session.revoked`, password-reset-success, or user-deleted webhook immediately revokes matching local sessions and appends a sanitized Account security event. Logout revokes locally and at WorkOS. Provider failure never creates or elevates a session.

Sensitive actions create a ten-minute, Account/session/action/scope-bound intent with a hashed nonce. AuthKit is invoked with `maxAge: 0`. Completion requires the same provider subject, verified non-impersonated evidence, provider `auth_time` at or after the challenge within bounded skew, and an active original session. One database function atomically consumes the intent, revokes the old hash, creates the rotated hash, preserves the original absolute ceiling, and records the result. Replays and concurrent second completions fail.

## Authorization and Actor binding

The pure evaluator separates principal, Actor, capability, role bundle, explicit grant, resource state, and fresh-auth requirements. Unknown values and ambiguity deny. Explicit deny precedes allow. The current human principal may bind only the Workspace `HUMAN` Actor whose stable reference is `account:<AccountId>`. A Memoid `SYSTEM` principal contains one server-issued `boundActorId` and may use only that exact `MEMOID_SYSTEM` Actor; a distinct `WORKER` principal is likewise bound to one exact `MEMOID_WORKER` Actor. Missing bindings, cross-kind selection, and cross-system/cross-worker Actor IDs deny.

The closed 10C vocabulary is `WORKSPACE_DISCOVER`, `WORKSPACE_READ`, `WORKSPACE_MANAGE_SECURITY`, `PROJECT_DISCOVER`, `PROJECT_READ`, `PROJECT_SUBMIT_CANDIDATE`, `PROJECT_CONTROL`, and `AUDIT_READ`. `PERSONAL_WORKSPACE_OWNER` is the only active human bundle. `INTEGRATION_BASE` is a closed future mapping only and creates no Integration runtime.

## PostgreSQL enforcement

`memoid_app` is the ordinary product runtime and must remain non-owner, non-superuser, `NOINHERIT`, and `NOBYPASSRLS`. Each request uses a transaction-local validated context: Account plus optional exact Workspace, Project, and server-bound Actor. Context is never set connection-globally.

Every `memoid` table has RLS enabled and forced. Policies follow Account, Workspace, Project, and Actor shapes; repeated composite foreign keys retain child attachment integrity. Runtime privileges are intentionally narrower than policy visibility: read access is RLS-filtered, and only exact human Actor and immutable Audit inserts are directly granted.

`memoid_auth` is a separate trusted authentication persistence role used only through the auth-owned store by the WorkOS callback, local-session checks, logout/step-up flow, and verified provider webhook adapter. It is `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, and `NOBYPASSRLS`; owns no product table; has no table or sequence privileges; and can execute only nine reviewed identity/session functions. Conversely, `memoid_app` cannot execute any of those elevated functions. The former standalone `consume_step_up_intent` function no longer exists: only provider-backed `complete_step_up_intent` can consume an intent, and it atomically validates fresh authentication, rotates the session, and consumes the intent. No Workspace/Project lifecycle, Operation execution, Source ingestion, review, reconciliation, export, deletion, or later-vertical write is granted by 10C.

The migration preserves Stage 10B Actor snapshot canonicalization and immutable Audit history. Account security events cover pre-Project authentication transitions without fabricating a Project; Project-scoped Audit Events remain available where an actual Actor and Project exist.

See `docs/implementation/stage10c-identity-authz-rls-challenge.md` for B1–B4 decisions and the exact security proof matrix.
