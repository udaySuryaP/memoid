# Stage 10C identity, sessions, authorization, and RLS challenge

Status: **10C B gates resolved before the first Stage 10C migration or protected runtime path**.

This record is subordinate to the canonical Notion hierarchy, the HQ-reconciled Stage 9C/9D repository contract, and the accepted Stage 10A/10B implementations. It authorizes no 10D Workspace/Project lifecycle, invitation/member management, GitHub runtime, reconciliation, review, Context Pack, MCP product API, export/delete behavior, or later product vertical.

## Current WorkOS capability evidence

The implementation was reconciled on 2026-09-02 against the current official WorkOS documentation and the installed SDK surface. The current registry releases were `@workos-inc/node` 10.13.0 and `@workos-inc/authkit-nextjs` 4.3.1; Memoid uses the provider-neutral application port plus the Node SDK because Memoid, rather than a framework cookie helper, owns the opaque local session.

The verified provider semantics are:

- Hosted AuthKit returns an authorization code that the server exchanges with `userManagement.authenticateWithCode`.
- The WorkOS User `id` is the provider subject; `email` is mutable and `emailVerified` is an attribute.
- AuthKit normally requires email verification and safely links credentials into one WorkOS User only after provider verification. A verified-domain SSO assertion is one provider-supported verification path.
- Access-token claims include `sub`, `sid`, `auth_time`, issue/expiry and issuer/client information. Refresh does not advance `auth_time`.
- `maxAge` on `getAuthorizationUrl` forces reauthentication when the prior active authentication is too old; `maxAge: 0` always prompts.
- Sessions have stable IDs and active/expired/revoked status. The Node SDK exposes list and revoke operations, and WorkOS emits `session.revoked`, user lifecycle, and password-reset events.
- Hosted AuthKit owns passkey/MFA enrollment and authentication. Passkeys may satisfy first and second factor; ordinary MFA does not apply to SSO in the same way, so Memoid never infers strong assurance from a generic “MFA enabled” flag.

Provider-hosted behavior is authentication evidence only. WorkOS organization roles/permissions do not become Memoid Workspace/Project authorization.

## B1. Provider subject mapping and verified-email/account-linking policy

### Stable identities

- Memoid Account identity is an internal UUIDv7 `AccountId` and remains stable for Memoid history and authorization.
- The provider binding key is `(provider_key, provider_subject)`, initially `workos` plus WorkOS User `id`.
- Email is a normalized, verified binding attribute and display/recovery input, never a Memoid primary key or authorization key.
- A Workspace-scoped `HUMAN` Actor uses the stable Memoid Account reference. Sessions, provider subjects, email addresses, authentication methods, and role names are never Actor IDs.

### Callback/linking decision table

1. An existing active binding for the same WorkOS subject resolves to the same Memoid Account. A changed verified email updates the binding snapshot but not the Account or Actor.
2. A callback with `emailVerified !== true` establishes no normal Memoid session and cannot access private Project data.
3. A previously unseen subject with an unused verified email may create a new Memoid Account, binding, and its one schema-required personal Workspace anchor. Workspace/Project lifecycle remains 10D.
4. A different subject presenting an email already attached to another Memoid Account is **ambiguous and denied**. Memoid never silently merges or reassigns Accounts from email equality. AuthKit normally returns the same WorkOS User after its own safe credential linking; a conflicting subject therefore indicates migration, environment, provider, or attack ambiguity requiring explicit governed recovery.
5. A disabled/deleted binding, deleted provider user, or provider/security event revokes local sessions and denies callback reuse until an explicit safe recovery/rebinding path exists.
6. A provider-subject change is never inferred from email. It is a security-sensitive binding change and requires separate future governed recovery evidence.

The binding keeps only bounded provider identifiers, normalized email, verification state, lifecycle state, and security timestamps. It stores no raw provider payload, token, OAuth secret, or credential. Historical Audit Event Actor snapshots remain stable when an email, provider binding, or session later changes.

### Threat conclusions

- Same subject + changed email: preserve Account; update only after provider-verified callback/event and uniqueness check.
- Different subject + same verified email: deny `IDENTITY_LINK_AMBIGUOUS`; no merge.
- Different subject + same unverified email: deny `EMAIL_NOT_VERIFIED`; no Account/session.
- Same email across distinct WorkOS environments: environment/provider key is part of the binding authority and cannot be silently crossed.
- Provider outage or unverifiable response: create no Account/binding/session and grant no access.

## B2. Local session, revocation, and fresh-auth/step-up

### Local session shape

Memoid issues a 256-bit random opaque browser token and stores only its SHA-256 hash. The database row binds the token to Account, WorkOS subject/session ID, creation/last-activity times, absolute and idle expiry, provider verification horizon, `auth_time`, rotation lineage, Account security epoch, and revocation state.

The browser cookie is `__Host-memoid_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, and no browser-readable long-lived authentication secret. Cookie-authenticated mutations require origin/CSRF enforcement in addition to authorization. Logout and rotation overwrite/expire the cookie and invalidate the server-side hash.

The Stage 8 targets are adopted as bounded 10C defaults, not permanent canonical constants:

- 24-hour local absolute lifetime;
- 1-hour inactivity lifetime;
- 15-minute fresh-auth window;
- 5-minute provider-state verification horizon for ordinary local-session continuity.

The effective session cannot outlive the earlier of local limits and known provider expiry. A revoked/expired WorkOS session, deleted/disabled binding, password reset/security epoch change, local/global logout, or terminal provider refresh/status result revokes local access. Temporary provider failure does not create or elevate a session: ordinary access may continue only inside the last positively verified provider horizon; protected/step-up actions require current provider evidence and fail closed. Provider webhooks/events shorten the window by revoking immediately, while periodic status checks bound missed/delayed event impact.

Each concurrent browser has its own session row. Global logout/recovery increments Account security epoch and revokes every row. Rotation creates a new token hash and invalidates the old one atomically; no previous-token grace is accepted for protected effects. Activity writes are throttled without extending absolute expiry.

### Fresh authentication and step-up

Fresh authentication is the WorkOS access-token `auth_time` produced by an active provider authentication, not token issue time, request time, CSRF possession, Actor, correlation ID, or idempotency key. Refreshing a WorkOS token does not advance freshness.

A protected action checks current session/binding/security epoch, current authorization and provider state, then requires `now - auth_time <= 15 minutes`. If stale, Memoid creates a one-time hashed pending intent with exact action key, scoped resource/return route, Account/session binding, expiry, and correlation ID. It redirects to hosted AuthKit with signed state and `maxAge: 0`. The callback must:

- match state and PKCE verifier;
- return the same WorkOS subject/Account;
- carry verified email and a non-impersonated session;
- have `auth_time` at or after the challenge (within bounded clock skew);
- atomically consume the intent and rotate the local session;
- re-run authorization for the exact action before any effect.

Intent replay, concurrent second completion, stale session, subject mismatch, route tampering, or provider failure denies without performing the action. Cancellation performs no action. Signed state preserves only bounded routing/security identifiers; it is never authorization by itself.

## B3. Principal, role bundles, capabilities, grants, and Actor binding

### Separation

- **Authentication:** a current local Memoid session resolves a human principal backed by verified WorkOS evidence.
- **Actor attribution:** the authenticated Account is bound to the Workspace `HUMAN` Actor whose reference is that stable Account. It answers who/what receives attribution.
- **Authorization:** a fresh decision determines whether that principal may perform one capability on one current scope now.

No caller-supplied Actor is accepted. Human principals may bind only their Account Actor. Untrusted inputs cannot select or create `MEMOID_SYSTEM` or `MEMOID_WORKER`; future Integration/Developer principals receive distinct Actor identities and never inherit a human Account's roles.

### Closed 10C capability vocabulary

- `WORKSPACE_DISCOVER`
- `WORKSPACE_READ`
- `WORKSPACE_MANAGE_SECURITY`
- `PROJECT_DISCOVER`
- `PROJECT_READ`
- `PROJECT_SUBMIT_CANDIDATE`
- `PROJECT_CONTROL`
- `AUDIT_READ`

The vocabulary is deliberately small. Later verticals may add reviewed capability keys through their own challenge; unknown keys always deny. Source refresh is intentionally absent for external principals.

The only active V1 bundle in 10C is `PERSONAL_WORKSPACE_OWNER`, derived from the existing `workspaces.account_id` ownership relationship. `INTEGRATION_BASE` is a closed future attachment containing discovery/read/narrow candidate submission only; 10C defines it for deterministic evaluation but creates no Integration, credential, or Project-grant lifecycle. Enterprise admin/member/invitation behavior remains 10D/10Q and is not invented here.

### Deterministic precedence

1. Unauthenticated, expired/revoked/stale-security-epoch principal: deny.
2. Unknown principal/role/capability, disabled binding, Actor mismatch, caller-claimed system Actor, or ambiguous scope: deny.
3. Resource outside the exact Workspace/Project ownership/grant scope: deny with non-enumerating semantics.
4. Revoked/expired grant, archived/deleting resource, or mid-request/final-commit recheck failure: deny.
5. Any matching explicit deny overrides role-derived or explicit allow.
6. A Project allow never grants another Project; a Workspace allow does not bypass Project/object scope checks.
7. Role bundle or active explicit allow may supply the requested capability only for its matching scope.
8. A fresh-auth-required capability additionally requires a current satisfied step-up.

Every ambiguous case denies. Role-name checks remain inside the evaluator/bundle mapping, not scattered across handlers. Long-running work hashes its authorization basis for diagnostics only and reauthorizes at execution, protected access, and final commit; the hash never grants authority.

## B4. PostgreSQL runtime role, transaction context, and RLS

Application authorization remains primary. `memoid_app` is the single non-owner runtime role for current product requests and remains `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, and `NOBYPASSRLS`. `memoid_owner` remains migration ownership and is rejected by the runtime-role assertion.

Every product transaction sets transaction-local, validated UUID settings using `set_config(..., true)`:

- `memoid.account_id` — authenticated Account when present;
- `memoid.workspace_id` — exact authorized Workspace when present;
- `memoid.project_id` — exact authorized Project when present;
- `memoid.actor_id` — server-bound Actor when present.

No capability list or role bundle is stuffed into settings. Missing/malformed context resolves to null/fail-closed. Settings are never connection-global. The transaction wrapper validates and exposes one initial context with no nested switching API; raw SQL remains trusted infrastructure, while relationship policies still deny a switched cross-Account scope.

RLS policy shapes are scope-specific:

- `accounts`: Account ID only.
- identity/session/step-up tables: Account ID plus binding/session relationships.
- `workspaces`: Account ownership and exact Workspace.
- `projects`: owned Workspace and optional exact Project for listing versus object access.
- `actors`: exact Workspace; human creation additionally requires the current Account reference and forbids privileged Actor kinds.
- every Project-owned 10A/10B row: exact Workspace + Project, with Account ownership resolved through Workspace.
- child/provenance/frontier/attempt rows retain their repeated composite scope and cannot attach to a known UUID outside it.

All tenant/product tables enable and force RLS. `PUBLIC` receives no schema/table/function privilege. Runtime grants are operation-specific: immutable Actor/Audit/Context/history rows receive no ordinary update/delete; Workspace/Project lifecycle writes remain unavailable until 10D; security-session state changes occur only through the 10C security-definer functions; existing Operation/frontier foundations are RLS-filtered reads only, with no runtime write functions granted before an owning protected-handler vertical needs them.

The real PostgreSQL proof must use `memoid_app` and one reused pool to show no context after commit, rollback/throw, savepoint, cancelled query, or repeated A/B reuse. It must test known cross-tenant UUIDs, joins, parent/child attachment, SELECT/INSERT/UPDATE/DELETE according to grants, catalog ownership/role flags, forced-RLS coverage, and retained immutable-history triggers/privileges.

## Audit attachment and privacy

Security transitions use the Stage 10B Audit Event vocabulary where a current Workspace/Project scope and Actor exist: session-established attachment, authorization denial, protected-action step-up result, and later Project-scoped security changes. Pre-Workspace Account/session events retain a bounded account-security event foundation until a Workspace Actor exists; they never fabricate a Project solely for auditing. Both paths prohibit tokens, cookies, authorization headers, secret material, provider payloads, email values in metadata, raw exception objects, and stacks.

The audit attachment records controlled event/failure keys and opaque Account/session/provider references only. Account-security state and Stage 10B Project Audit Events are different scope projections of the same security decision, not duplicated mutable logs.

## Conclusion

B1–B4 are resolved for the bounded 10C implementation. The implemented proof includes table-driven domain/security tests, real PostgreSQL cross-tenant and one-connection-pool tests, WorkOS adapter contract tests, protected browser-state tests, and this self-challenge. It changes neither the stable Actor taxonomy nor the four integrity planes, Stage 10A/10B immutability/concurrency protocols, or later vertical ownership; any future need to do so must return to HQ rather than being silently encoded.
