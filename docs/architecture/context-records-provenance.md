# Stage 10H Context identities, records, and provenance

Stage 10H attaches secure runtime behavior to the Context foundation created in Stage 10A. It does not implement reconciliation, Conflict/Uncertainty classification, proposals, policy eligibility, multi-item revision application, search, Context Packs, MCP delivery, or later Stage 10 work.

## Identity and record model

A `context_identities` row is the durable logical identity of one Project-scoped semantic question: subject, scope, facet, and predicate. Its UUID and normalized semantic tuple do not depend on mutable display text, a repository path alone, a generated title, or the current assertion value. `version` is a compare-and-set fence; lifecycle moves only from `ACTIVE` to `ENDED`.

Each accepted value is a new immutable `context_records` row. `context_record_origins` gives that row an identity-local record version, Actor, idempotency record, trace, origin class, and optional predecessor. The unique predecessor edge prevents divergent successor history. `context_identity_current_records` remains a mutable projection only; historical records and provenance are never overwritten.

Each bounded human mutation creates one Stage 10A `context_revisions` row and advances one identity. Stage 10M still owns proposal/review policy execution, multi-item revision atomicity, and automatic application; 10H establishes the direct user-native/source-evidence substrate and lineage those later flows must use.

Soft ending appends `context_identity_endings`, retains the final current pointer for history, and changes only the identity lifecycle/version projection. End-versus-revise races lock the same Project, identity, and current pointer.

## Provenance and freshness

`USER_NATIVE` records carry explicit Actor, operation, and trace provenance without fabricated Source evidence. `SOURCE_EVIDENCE` records require an immutable Stage 10F Evidence Reference and the exact current Stage 10G Authority Assignment. The transaction verifies same-Project/source attachment, active provider access, authority scope/ref applicability, default-branch snapshot, and an ingested/current Source frontier before commit. It also records the Evidence Reference, Source Observation, coverage sequence, Authority Assignment, and legacy Stage 10A Source provenance/coverage edges.

Reads qualify the current record separately from its durable reviewed value: `NOT_SOURCE_BACKED`, `CURRENT`, `SOURCE_NEWER`, `SOURCE_UNAVAILABLE`, `AUTHORITY_CHANGED`, or `REVALIDATION_REQUIRED`. Provider loss, branch deletion, authority replacement, or a newer ingestion never erases or silently rewrites the reviewed record.

`MEMOID_OPERATION` is reserved in the persistence vocabulary so later reconciler/reviewer operations can retain their true origin, but 10H deliberately exposes no worker mutation path.

## Authorization, audit, and concurrency

Reads require `PROJECT_READ`; direct mutation requires the new closed `PROJECT_MANAGE_CONTEXT` capability, which is granted only to the Personal Workspace owner bundle. PostgreSQL uses transaction-local Account/Workspace/Project/Actor context, forced Project RLS, no direct runtime table writes, and two fixed-search-path security-definer functions that recheck the live session, security epoch, identity binding, Project lifecycle, and exact human Actor.

Stage 10B idempotency claims and Context mutation commit in one transaction. Equal retries replay the stable result; conflicting fingerprints fail. Project and identity locks serialize duplicate creation, concurrent revision, end-versus-revise, and Source/authority lifecycle races. Expected identity version and expected current record ID provide compare-and-set protection against stale writers.
