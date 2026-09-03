# Stage 10D Workspace and Project challenge

Stage 10D resolves the `Workspace/Project membership lifecycle` B gate before
adding lifecycle behavior. The decision is intentionally personal-first and
does not create dormant team behavior.

## Threat and problem

A conventional membership model would introduce invitations, multiple roles,
owner transfer, and last-admin transitions before Memoid has a V1 need for any
of them. That creates unauthorized privilege paths and makes it possible for a
personal Workspace to lose its only effective owner. The opposite failure is
to leave Workspace ownership implicit and mutable, allowing an Account change,
foreign UUID, stale session, or archived Project to bypass authorization.

## Canonical constraints

- The canonical hierarchy is `Account -> Personal Workspace -> Projects`.
- V1 has exactly one Personal Workspace per Account and Projects are private.
- Team and organization collaboration, invitations, and multiple owners are
  post-V1.
- Stage 10C already creates the Personal Workspace when a verified identity is
  first bound.
- Application authorization is primary; forced transaction-scoped RLS remains
  defense in depth.
- Archive is reversible and distinct from delete, but the archive/restore
  workflow belongs to 10S.

## Personal-V1 interpretation and alternatives

Three representations were challenged:

1. A generic Workspace membership table was rejected. With exactly one owner
   and no invitation, membership, transfer, or admin commands, it duplicates
   `workspaces.account_id` and creates unused privilege-bearing states.
2. A separate one-row owner table was rejected for the same reason. It would
   add a synchronization invariant without adding a V1 capability.
3. The existing direct Account foreign key was selected. Its unique constraint
   already proves at most one Personal Workspace per Account; Stage 10D makes
   the ownership columns immutable and treats the 10C-created row as the
   canonical Personal Workspace.

No membership table is needed. A future team vertical may add a separate
membership aggregate through its own migration and proof gate while retaining
the personal owner as a non-removable effective owner during transition.

## Ownership, last-owner, and invitation invariants

- `workspaces.account_id` is the sole V1 ownership fact and cannot be updated.
- The Account-to-Workspace uniqueness constraint remains in force.
- No application command, route, database function, table, role bundle, or
  grant exists for inviting, accepting an invitation, adding a second owner,
  removing the owner, transferring ownership, or assigning an admin.
- The active Personal Workspace therefore cannot reach a zero-owner state.
- Unknown membership/role/capability inputs continue to fail closed in the
  central authorization evaluator.

These rules answer the last-admin case without inventing an admin role: V1 has
no admin lifecycle. The only effective owner is the Account referenced by the
immutable Workspace row.

## Workspace lifecycle and unavailability

Workspace creation remains part of verified Account binding in Stage 10C.
Stage 10D does not add a second creation path or a rename surface. A Workspace
is usable only while its Account security state and authenticated principal are
active. Disabled security state, a revoked session, or a stale security epoch
makes the Workspace and all child Projects unavailable before mutation. There
is no Workspace archive/delete/restore command in 10D; those semantics remain
with 10S.

## Project lifecycle and archive interaction

Projects receive stable UUIDv7 identity, trimmed display name, optional bounded
description, optimistic version, timestamps, and an `ACTIVE`/`ARCHIVED`
lifecycle state. Creation always starts `ACTIVE`. Stage 10D exposes no archive
or restore command and no delete path. The state exists so authorization,
listing, stale-update protection, and later 10S work have an explicit boundary.

Archived Projects may appear in the owning Account's deterministic inventory
with a clear state, but object reads and mutations require an active resource.
Metadata update uses a version predicate and active-state predicate. Thus an
archive transition committed by the future 10S path wins against a concurrent
metadata update or forces that update to fail stale/unavailable; it cannot be
silently overwritten.

## Project creation, policy, idempotency, and concurrency

Project creation is one transaction:

`current authorization -> existing Stage 10B idempotency claim -> Project ->`
`candidate frontier trigger -> policy version 1 -> Audit Events ->`
`idempotency completion -> commit`.

Stage 10B originally scoped idempotency to an already-existing Project. Stage
10D extends that same table and claim protocol with a Workspace-scoped
`PROJECT_CREATE` record whose Project scope remains null. `UNIQUE NULLS NOT
DISTINCT` serializes duplicate keys, while the completed record binds the
stable result through its result kind/reference and a sanitized audit metadata
reference. Other actions still require Project scope. This is an extension of
the existing mechanism, not a second idempotency system.

The Project insert and its mandatory policy version are protected by a deferred
constraint proof. `MANUAL` is the default when omitted; `AUTOMATIC` must be
explicit. Any exception rolls back the claim and all lifecycle rows together,
so a retry cannot observe an incomplete Project. Completed replay rechecks the
current Account, Workspace, Actor, and Project state before returning the one
stable Project reference.

## Authorization and database consequences

- Existing `PROJECT_DISCOVER`, `PROJECT_READ`, and `PROJECT_CONTROL`
  capabilities cover the bounded lifecycle behavior; no raw role checks or new
  speculative capabilities are added.
- Human mutations require the exact Account-bound Workspace `HUMAN` Actor.
- Workspace discovery allows an Account-only transaction to find only its one
  Personal Workspace. Project listing uses Workspace context with no Project
  context; object access uses exact Project context.
- Lifecycle mutation functions are narrowly allowlisted to `memoid_app`, have
  fixed search paths, revalidate Account/Workspace/Actor/resource state, and do
  not grant generic write access. `memoid_auth` receives no lifecycle function
  or table privilege.
- Lifecycle mutation functions also lock and revalidate the opaque local
  session, verified identity binding, and Account security state. Revocation or
  disablement therefore linearizes before the mutation (which is denied) or
  after its commit; no mutation can cross an unobserved security-state change.
- Project-owned repository, Source, Evidence, Authority, reconciliation,
  review-engine, integration, export, delete, and restore fields are absent.

## Executable proof

Domain tests cover input normalization, lifecycle parsing, capability
attachment, unavailable resources, and unsupported membership values.
PostgreSQL 18 tests cover ownership immutability, Account disablement, foreign
known UUIDs, forced RLS, Actor spoofing, initial policy completeness,
MANUAL/AUTOMATIC/default behavior, same-key replay and conflict, concurrent
duplicate creation, failed retry, deterministic listing, optimistic updates,
archive/update races, pool reuse, privileges, and `004 -> 005 -> 004 -> 005`.
Browser tests cover the bounded PRJ-01, PRJ-02, Project shell, and PSET-01
surfaces without implementing GH-01/GH-02 or any later vertical.
