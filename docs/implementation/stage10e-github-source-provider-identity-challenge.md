# Stage 10E GitHub Source and provider identity challenge

Stage 10E resolves the GitHub Source/provider identity foundation before any
repository content is fetched, observed, reconciled, reviewed, or added to
working context. This record is the pre-implementation E1-E10 challenge. The
canonical Stage 2 negative evidence remains unchanged; the founder's later
`BUILD FULL PRODUCT` decision authorizes execution but is not new validation
evidence.

## E1 — Canonical identity

Memoid owns the Source identity: a UUIDv7 in the existing `sources` table. A
GitHub repository is an external identity attached to that Source, never the
Source primary key. The stable provider tuple is:

`GITHUB / GitHub App ID / installation ID / repository ID`.

GitHub's numeric IDs are stored and transported as canonical decimal strings.
This avoids JavaScript integer precision loss and preserves provider identity
without assuming a fixed numeric width. Repository owner, name, full name,
URL, visibility, and default branch are mutable display metadata. A rename,
transfer, visibility change, or default-branch change must not create a new
Memoid Source.

Alternatives based on `owner/name`, clone URL, or installation-scoped list
position were rejected because each can change without the repository changing.
Using the provider repository ID as Memoid's primary key was rejected because
it leaks provider semantics into the domain and prevents provider-independent
Source identity.

## E2 — Scope, association, and duplicate policy

A GitHub Source is owned by exactly one existing Project and Workspace through
the existing composite tenant keys. V1 allows at most one current GitHub Source
per Project. A Project can remain source-less. The same GitHub repository may
be associated with different Projects: canonical policy discourages that
configuration but does not forbid it. Every provider event that could match
more than one Project therefore requires explicit project-scoped processing;
there is no global "first match" rule.

Selecting a different repository for a Project that already has a GitHub
Source fails closed. Silent replacement, disconnect, deletion, and history
transfer were rejected for 10E because their impact review and step-up workflow
belong to later lifecycle work. Reconnecting the same stable repository
identity may restore provider access without replacing the Source.

## E3 — Authorization boundary

Only an active, authenticated human owner with the existing
`PROJECT_CONTROL` capability may initiate, complete, or retry a connection.
The application decision is primary. The database mutation revalidates the
opaque local session, verified active identity binding, Account security
epoch, immutable Personal Workspace owner, matching HUMAN Actor, active
Project, and exact Project context while holding locks. Known foreign UUIDs,
stale sessions, archived Projects, Actor spoofing, and provider permission do
not grant Memoid authorization.

GitHub authorization is a separate proof: it demonstrates that the GitHub
user can see the installation and selected repository. It never substitutes
for Memoid authorization. No new role or capability is introduced.

## E4 — Installation initiation and callback binding

Connection starts by creating a short-lived, one-time intent bound to Workspace,
Project, Memoid session, HUMAN Actor, and correlation ID. A cryptographically
random raw state value is returned to the browser and sent to GitHub; only its
SHA-256 digest is retained. State is consumed exactly once and expires.

GitHub's setup callback `installation_id` parameter is explicitly untrusted;
GitHub documents that it can be spoofed. The callback must match the one-time
state and same active Memoid session, then obtain a short-lived GitHub user
access token server-side and ask GitHub which installations/repositories that
user can access. A callback parameter alone can never bind an installation.
The temporary user token and any refresh token are discarded and revoked after
the bounded proof. Candidate repository data is short-lived and cannot create
a Source until an explicit selection is reverified.

## E5 — Selection and authoritative verification

The selection command uses a rotated one-time selection state and a repository
ID from the server-created candidate set; browser-supplied names, URLs, owner,
visibility, or installation IDs are not authoritative. Immediately before the
database mutation, the adapter mints a repository-scoped installation access
token and fetches that repository through GitHub. The returned App ID,
installation ID, account ID, repository ID, and read permissions form the
verification evidence. The token is limited to the selected repository and
cannot exceed the App installation's granted permissions.

The final database transaction locks the Project and current association,
checks the verification start time against newer provider lifecycle signals,
claims existing Stage 10B idempotency, creates the existing `sources` row and
provider association together, emits sanitized audit evidence, completes the
idempotency record, and consumes the selection intent. A replay returns the
same Source; a different fingerprint with the same key conflicts.

## E6 — Credential and secret handling

| Material                         | Lifetime                  | Storage and exposure rule                                                                                                                                        |
| -------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub App private key           | Until rotated/revoked     | Server secret only; never database, browser, logs, errors, audit, or client bundle. Used only to sign RS256 App JWTs.                                            |
| App JWT                          | At most 10 minutes        | Memory only; `iat` is backdated for clock drift and `exp` is within GitHub's limit. Never persisted or logged.                                                   |
| Installation access token        | About one hour or less    | Memory only, narrowed to the selected repository and required read permissions. Never persisted, returned to the browser, or logged. No fixed-length assumption. |
| GitHub user access/refresh token | Bounded callback proof    | Memory only; never persisted or logged. Revoke/discard immediately after installation/repository discovery.                                                      |
| GitHub App client secret         | Until rotated/revoked     | Server secret only, used for OAuth exchange/revocation.                                                                                                          |
| GitHub webhook secret            | Until rotated/revoked     | Server secret only, used only for HMAC-SHA256 verification.                                                                                                      |
| OAuth/setup/selection state      | Minutes, one use          | Raw value in browser redirect only; SHA-256 digest and bounded context in database.                                                                              |
| Memoid session cookie            | Existing Stage 10C policy | HttpOnly opaque cookie; only its digest crosses the database function boundary.                                                                                  |

Secrets use the repository's existing deployment secret mechanism. Only
non-secret App ID, client ID, and public App slug may appear in ordinary
configuration. Logs, error metadata, audit metadata, and telemetry use an
allow-list and never serialize request authorization headers, callback codes,
raw state, signatures, JWTs, tokens, private keys, or raw webhook payloads.

## E7 — Webhook authentication and replay

The provider endpoint reads raw bytes, verifies `X-Hub-Signature-256` as an
HMAC-SHA256 value with a timing-safe comparison, validates
`X-GitHub-Delivery`, event name, action, App/installation/repository decimal
IDs, and a bounded payload before any state change. Missing, malformed, stale,
oversized, incorrectly signed, or unsupported input fails closed. Rotation may
temporarily accept current and immediately previous webhook secrets; which key
matched is never exposed.

`X-GitHub-Delivery` is the provider replay key. Once a Project association is
known, processing uses the existing Stage 10B project-scoped provider receipt
and payload digest contract; duplicate delivery IDs converge and a digest
mismatch is a security failure. No second project receipt/idempotency system is
created. Pre-binding installation safety signals are retained only as a
minimal provider lifecycle fence so callback/webhook races cannot create an
active connection from a newly suspended or deleted installation.

## E8 — Lifecycle, ordering, and races

Connection state is one of `ACTIVE`, `VERIFICATION_REQUIRED`, `SUSPENDED`,
`INSTALLATION_DELETED`, `REPOSITORY_ACCESS_REMOVED`, or `REPOSITORY_DELETED`.
Provider payloads are signals, not trusted repository truth:

- installation suspension/deletion and repository removal may make access
  unavailable immediately while preserving the Source and history;
- unsuspension, repository addition, rename, transfer, visibility change, and
  default-branch change move the association to `VERIFICATION_REQUIRED` until
  an authoritative GitHub read refreshes metadata;
- duplicate and out-of-order deliveries never regress a newer lifecycle fence;
- callback, selection, and webhook transactions compare provider occurrence
  and local receipt times to the verification start, so the more conservative
  state wins a race;
- missed-webhook recovery is a later catch-up concern, but every normal access
  rechecks provider authority and can mark the Source unavailable;
- provider outage, timeout, or rate limiting cannot prove deletion and leaves
  the Source in a retryable verification state.

Repository content, commits, branches, observations, candidate frontiers,
reconciliation, context, and source-derived facts are never written by these
lifecycle signals.

## E9 — Database roles, RLS, audit, and failure behavior

All new tenant tables use `(workspace_id, project_id)` ownership, forced RLS,
composite foreign keys, immutable provider identity guards, bounded values,
and no generic application writes. `memoid_app` may execute only narrow
security-definer lifecycle functions. `memoid_auth` receives no Source or
provider privilege. A dedicated non-owner, `NOBYPASSRLS` provider role may
execute only the authenticated webhook lifecycle function and receives no
direct table or sequence privilege. Migration ownership remains separate.

Audit records capture stable Source/provider IDs, lifecycle transition,
correlation/causation, receipt/idempotency reference, actor snapshot, and
sanitized outcome/failure code. They do not contain mutable repository names
as authority or any secret/raw provider payload. Expected provider failures
are stable typed failures; unknown or ambiguous mappings fail closed.

## E10 — Executable proof and 10F boundary

The proof matrix must cover identity normalization, immutable stable IDs,
authorization, state expiry/replay, spoofed installation callbacks, candidate
tampering, repository-scope verification, same-key replay/conflict, concurrent
selection, duplicate cross-Project associations, ambiguous webhook fan-out,
signature validation, delivery replay/digest mismatch, suspension/deletion/
repository-removal races, out-of-order events, provider outage, forced RLS,
role grants, pool reuse, migration up/down/up, log redaction, and the bounded
GH-01/GH-02 browser states.

Stage 10E stops after secure provider identity, connection state, repository
selection, and lifecycle availability. It does not enumerate or ingest files,
commits, branches, diffs, pull requests, issues, releases, or repository
content. It does not create Source observations or frontier advancement. It
does not reconcile, rank, infer, review, promote, or write working context. It
does not implement replacement, source deletion, source refresh, missed-event
catch-up, MCP, export, billing, or later provider verticals. Those boundaries
remain blocked until HQ independently reviews and authorizes the next stage.
