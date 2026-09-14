# Stage 10H Context identities, records, and provenance

Stage 10H attaches secure runtime behavior to the Context foundation created in Stage 10A. It does not implement reconciliation, Conflict/Uncertainty classification, proposals, policy eligibility, multi-item revision application, search, Context Packs, MCP delivery, or later Stage 10 work.

## Identity and record model

A `context_identities` row is the durable logical identity of one Project-scoped semantic question: subject, scope, facet, and predicate. Its UUID and normalized semantic tuple do not depend on mutable display text, a repository path alone, a generated title, or the current assertion value. `version` is a compare-and-set fence; lifecycle moves only from `ACTIVE` to `ENDED`.

Each accepted value is a new immutable `context_records` row. `context_record_origins` gives that row an identity-local record version, Actor, idempotency record, trace, origin class, and optional predecessor. The unique predecessor edge prevents divergent successor history. `context_identity_current_records` remains a mutable projection only; historical records and provenance are never overwritten.

Each bounded human mutation creates one Stage 10A `context_revisions` row and advances one identity. Stage 10M still owns proposal/review policy execution, multi-item revision atomicity, and automatic application; 10H establishes the direct user-native/source-evidence substrate and lineage those later flows must use.

Soft ending appends `context_identity_endings`, retains the final current pointer for history, and changes only the identity lifecycle/version projection. End-versus-revise races lock the same Project, identity, and current pointer.

## Provenance and freshness

`USER_NATIVE` records carry explicit Actor, operation, and trace provenance without fabricated Source evidence. `SOURCE_EVIDENCE` records deterministically map the Context identity `facet` to the lower-case form of a canonical Stage 10G category/facet pair (for example, `implementation_state:code`). The transaction resolves every applicable current Authority Assignment with the Stage 10G ordering key—exact ref before default branch before any ref, then the longest path scope before Project scope—and requires the supplied assignment to be the single winning assignment for the Evidence Source. It rejects a wrong facet, stale/replaced assignment, or broader shadowed assignment. The winner is qualified before its ID is accepted, so unavailable, unobserved, behind, ambiguous, or default-branch-revalidation state fails closed and cannot fall back to a broader or lower-trust assignment. The same transaction also verifies same-Project evidence, an ingested/current Source frontier, and records the Evidence Reference, Source Observation, coverage sequence, winning Authority Assignment, and legacy Stage 10A Source provenance/coverage edges.

Reads qualify the current record separately from its durable reviewed value: `NOT_SOURCE_BACKED`, `CURRENT`, `SOURCE_NEWER`, `SOURCE_UNAVAILABLE`, `AUTHORITY_CHANGED`, or `REVALIDATION_REQUIRED`. Provider loss, branch deletion, authority replacement, or a newer ingestion never erases or silently rewrites the reviewed record.

`MEMOID_OPERATION` is reserved in the persistence vocabulary so later reconciler/reviewer operations can retain their true origin, but 10H deliberately exposes no worker mutation path.

## Authorization, audit, and concurrency

Reads require `PROJECT_READ`; direct mutation requires the new closed `PROJECT_MANAGE_CONTEXT` capability, which is granted only to the Personal Workspace owner bundle. PostgreSQL uses transaction-local Account/Workspace/Project/Actor context, forced Project RLS, no direct runtime table writes, and two fixed-search-path security-definer functions that recheck the live session, security epoch, identity binding, Project lifecycle, and exact human Actor.

Stage 10B idempotency claims and Context mutation commit in one transaction. Each immutable `context_record_origins` row stores both the identity version and record version returned by that mutation. Equal retries read only that immutable result row, so creation and earlier-revision replays remain byte-for-byte semantically stable after later revisions or lifecycle ending; conflicting fingerprints still fail. Identity-ending replay likewise reads its immutable ending row. Project and identity locks serialize duplicate creation, concurrent revision, end-versus-revise, and Source/authority lifecycle races. Expected identity version and expected current record ID provide compare-and-set protection against stale writers.

## Migration 009 rollback contract

The down migration supports `008 → 009 → 008 → 009` only while the 10H history tables are empty. If any Context origin, Evidence provenance, or identity ending exists, rollback explicitly raises `STAGE10H_ROLLBACK_REFUSED_POPULATED_CONTEXT_HISTORY` before dropping functions, tables, constraints, or columns. Operators must retain migration 009 or deliberately export and remove the incompatible 10H history under a separately reviewed data-migration procedure. The rollback never discards the only truthful provenance and never fabricates Candidate or Source provenance for a user-native record.
