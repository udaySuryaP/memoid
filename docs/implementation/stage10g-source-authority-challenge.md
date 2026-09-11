# Stage 10G Source Authority challenge

Stage 10G is founder-directed, unvalidated production work under the locked
Founder Override. Stage 2 remains **DO NOT BUILD / KILL**. The verified base is
`f16e527e009e649958c8124f779bb47cb89971d3`.

## G1 — Authority identity

An Authority Assignment is one immutable, reviewed decision binding a stable
Memoid Source UUID to an exact Project-owned Authority Scope version. The
scope identity is `(Project, category, facet, scope kind/key, ref selector/key)`.
It is not a Source, Evidence Reference, Context Identity, Context Record, or
Project. A mutable scope head points to one current immutable assignment; every
replacement is a new assignment.

## G2 — Authority scope

The initial closed category/facet pairs are implementation/code,
implementation/configuration, architecture-intent/documentation,
architecture-intent/decision, provider-state/issues, and provider-state/pull
requests. Scope is whole-Project or a case-preserving repository path prefix.
Ref selection is any ref, the reviewed default branch, or one exact branch ref.
Resolution orders exact ref above reviewed-default above any ref, then the
deepest path prefix above Project scope. No connection creates a global winner.

## G3 — Competing authority

One exact scope identity has at most one current assignment. Narrower nested
scopes are deliberate overrides; equal-specificity duplicates are rejected by
the database unique identity and optimistic version. Resolution returns
`MISSING` or `AMBIGUOUS` rather than guessing. A degraded winning assignment
blocks fallback to a broader or lower-trust assignment.

## G4 — Lifecycle

Creation, replacement, revalidation, and revocation are explicit. Assignment
and ending rows are append-only; the scope head advances by one version.
Historical rows survive provider access loss and Source degradation. Project
archive denies mutation. Deletion, purge, restoration, retention, and Source
replacement remain Stage 10S/other owning workstreams.

## G5 — Authorization

Reads require `PROJECT_READ`. Mutation requires the closed
`PROJECT_MANAGE_SOURCE_AUTHORITY` capability, an active current human session,
the exact Account-owned HUMAN Actor, an active Project, and a consumed recent
`MANAGE_SOURCE_AUTHORITY` step-up intent bound to that Workspace and Project.
GitHub permissions never authorize the action.

## G6 — Auditability

Every mutation has an immutable Actor-attributed assignment/ending row,
controlled reason key, bounded optional note, effect/ending timestamps,
correlation/causation, idempotency record, previous/successor relationship, and
immutable Stage 10B Audit Event. Raw metadata and evidence content are absent.

## G7 — Concurrency

The database locks the current session/security rows, Project, Source/provider
connection, and exact scope row. Project locking serializes competing scopes
with Project archive and Source lifecycle changes. Expected scope versions
reject stale replacement/revocation. Stage 10B transaction-scoped idempotency
collapses retries. Correctness uses PostgreSQL locks and constraints, never a
process-local lock.

## G8 — Source/Evidence interaction

Assignments reference only stable Memoid Source UUIDs. Evidence References,
observations, repository names/URLs, webhooks, and provider metadata cannot
grant or mutate authority. Evidence/frontier state only qualifies an assignment
as effective, unobserved, behind, unavailable, or revalidation-required.

## G9 — Context boundary

10G creates no Context Record, Context Revision, Working Context, Conflict,
Proposal, or reconciliation behavior. Authority mutation schedules no semantic
mutation. Stage 10H/10I/10J consume this control state later.

## G10 — Fail-safe behavior

No assignment is `MISSING`; equal-best candidates are `AMBIGUOUS`; inactive
provider state is `SOURCE_UNAVAILABLE`; absent observation is
`SOURCE_UNOBSERVED`; desired ahead of ingested is `SOURCE_BEHIND`; and a changed
default branch is `REVALIDATION_REQUIRED`. None falls through to another Source
or promotes Memoid context. Unknown category/facet/scope/ref/reason values fail
in both TypeScript and PostgreSQL.

## Rejected alternatives

- A Source-level `authoritative` boolean: creates a forbidden global winner.
- GitHub connection or Evidence Reference existence as authority: conflates
  identity/evidence with reviewed authority.
- Mutable assignment rows: destroys decision history and race evidence.
- Process locks: do not protect multi-instance or direct database execution.
- Automatic default-branch following: silently changes authority after provider
  metadata drift; the stored reviewed ref snapshot instead requires review.
- Context mutation during authority change: leaks Stage 10H–10J semantics.
