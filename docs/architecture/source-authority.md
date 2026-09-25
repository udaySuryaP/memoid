# Stage 10G Source Authority Assignments

Source Authority is a Project control-plane relationship, not a Source flag.
The domain accepts only reviewed category/facet pairs, hierarchical semantic
scope, and explicit ref boundaries. Resolution is deterministic by ref and
scope specificity and fails closed on missing, ambiguous, unavailable,
unobserved, behind, or revalidation-required state.

## Persistence

- `source_authority_scopes` stores stable exact scope identity and the optimistic
  current-head version.
- `source_authority_assignments` stores immutable Source decisions, effectivity,
  Actor, reason, trace, idempotency, default-branch snapshot, and predecessor.
- `source_authority_assignment_endings` stores immutable supersession/revocation
  edges and the Actor/reason/trace that ended a decision.

All three tables are Project-composite-scoped, owned by `memoid_owner`, use
forced RLS, and are read-only to `memoid_app`. Only three fixed-search-path
security-definer functions cross the write boundary; PUBLIC, `memoid_auth`, and
`memoid_provider` receive no execution grant.

## Mutation path

The first-party web flow performs a Project-scoped provider-backed step-up, then
calls the application service with the current Memoid session and bound HUMAN
Actor. PostgreSQL revalidates Account/session/security epoch, consumed scoped
step-up, Project lifecycle, Source identity, and provider availability before
claiming Stage 10B idempotency and changing one scope head. Replacement and
revocation append history and an Audit Event in the same transaction.

## Degraded authority

The adapter qualifies current assignments from live provider and frontier
state. Default-branch assignments retain the exact ref reviewed by the human;
a later provider default-branch change makes the assignment
`REVALIDATION_REQUIRED` rather than silently following it. Unavailable or stale
winning assignments never fall back to broader/lower-trust state.

AUDIT-1A centralizes live qualification in a database resolver used by Context
writes and reads. Exact-ref and default-branch assignments inspect only their
applicable ref. An `ANY_REF` assignment is effective when at least one observed
applicable ref is current; an unrelated lagging ref does not make every ref
unusable. When resolving authority for a concrete Evidence Reference, even an
`ANY_REF` assignment is qualified against that Evidence ref. Historical Context
provenance remains immutable when a later, stronger assignment becomes the
effective winner.

Projects may contain multiple GitHub Sources. Resolution binds each candidate
assignment to that candidate Source's connection and provider metadata.
`DEFAULT_BRANCH` is Source-relative and therefore applies only to Evidence from
the same Source on that Source's current default ref. Explicit `EXACT_REF` and
`ANY_REF` scopes may still win across Sources through the normal ref/path
precedence rules; a true equal-best result remains ambiguous and fails closed.

Source Authority remains evidence authority only. It grants no instruction,
authentication, access, semantic-review, system-execution, provider, or Context
mutation authority.
