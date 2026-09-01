# Stage 10B Actor, Audit Event, idempotency, and Operation challenge

Status: **10B B gates resolved before the first Stage 10B migration**.

This is the required read-only challenge of the 10B-owned B gates. It is subordinate to the canonical Notion hierarchy, the HQ-reconciled Stage 9C/9D repository contract, and the accepted Stage 10A schema. It authorizes no later vertical and introduces no 10C authentication/authorization, GitHub runtime, Source ingestion, reconciliation, product API, or UI.

## Scope and threat boundary

10B owns only the reusable foundations for Actor attribution, append-oriented Audit Events, idempotent request/effect identity, durable Operations, provider-neutral event receipts, Candidate stable-disposition watermark behavior, desired/processed leases and lost-wakeup prevention, and correlation/causation.

The following boundaries remain controlling:

- Actor is attribution, not authentication, authorization, OAuth identity, model identity, or `clientInfo`.
- All product tables remain deny-by-default to `memoid_app`; 10C owns principal binding, capabilities, RLS, runtime grants, and reauthorization behavior.
- Provider receipts are untrusted signals, not authoritative Source facts or semantic mutations.
- Operation and processing leases provide recoverable at-least-once execution. Exactly-once governed effects still require a database transaction, idempotency identity, uniqueness/preconditions, and current authorization at the later owning path.
- Audit metadata, provider metadata, failure details, and replay results are bounded sanitized summaries, never raw provider payloads, prompts, transcripts, repository blobs, credentials, or exception objects.
- The Stage 10A Candidate schema is preserved unchanged. 10B adds operational proof around its accepted gap-safe representation.

## B1. Actor taxonomy and historical attribution

### Challenge

An Actor must remain a stable answer to “who or what performed this Memoid action?” after a credential rotates, a session ends, an Integration disconnects, a worker restarts, or a human-facing label changes. It must not be accepted from arbitrary client claims, conflated with the authenticating principal, or replaced by model/provider metadata.

### Decision

Use a Workspace-owned stable Actor identity with the following closed taxonomy:

- `HUMAN` — a Memoid human attribution identity; 10C later binds authenticated principals.
- `MEMOID_SYSTEM` — a Memoid-controlled policy/system process.
- `MEMOID_WORKER` — a Memoid-controlled background execution identity.
- `INTEGRATION` — an external Integration/service attribution identity.
- `DEVELOPER_CLIENT` — a programmatic/developer client attribution identity.
- `SOURCE_SYSTEM` — an external Source/provider system attribution identity.

`MEMOID_SYSTEM` and `MEMOID_WORKER` are privileged Memoid-controlled kinds. The pure domain layer exposes a separate untrusted-kind parser that rejects them. Database attribution always derives the snapshot kind/reference/label from the referenced Actor row; callers cannot forge audit snapshot fields. The schema grants no runtime insert path in 10B, so a future untrusted client cannot manufacture Actors before 10C defines authenticated creation/binding rules.

Actor identity is Workspace-scoped because one human or Integration may legitimately act in more than one Project in that Workspace. Every Project-owned attribution repeats Workspace/Project scope and uses composite foreign keys. The stable Actor row is not mutated or deleted by normal 10B paths. Future lifecycle work may mark an Actor unavailable and privacy work may introduce controlled erasure/pseudonymization, but retained Audit Events preserve an immutable occurrence-time attribution snapshot.

Automatic policy/system revisions must reference a `MEMOID_SYSTEM` Actor; worker execution must reference a `MEMOID_WORKER` Actor. Model/provider/configuration metadata remains separate provenance and can never satisfy Actor or approval authority.

### Rejected alternatives

- Reusing Account, session, OAuth subject, credential, Integration, or `clientInfo` as Actor destroys attribution when bindings rotate and mixes security authority with history.
- Free-form actor-type strings allow spoofed privileged identities.
- Project-local duplicate Actor identities fragment one stable attribution identity and complicate cross-Project history.
- Mutable audit-time joins without snapshots rewrite historical meaning.

## B2. Audit Event foundation

### Decision

Audit Events are immutable, append-oriented, Project-scoped history with:

- UUIDv7 event identity;
- Actor identity plus database-verified occurrence-time Actor kind/reference/label snapshot;
- category and bounded event-type key;
- distinct occurrence and persistence times;
- bounded target type/key;
- required opaque correlation ID and optional causation ID;
- optional same-Project Operation, provider receipt, and idempotency linkage;
- outcome plus bounded failure code;
- bounded sanitized metadata.

Normal updates and deletes are rejected by database triggers. Full tamper evidence/export and privacy-compatible administrative repair remain 10T/10S proof gates, but 10B prevents a mutable activity-log implementation.

Metadata is restricted to a JSON object with bounded depth, key count, key/value length, total serialized size, and forbidden secret-bearing key names. Values are scalar or bounded scalar arrays; nested arbitrary objects, raw payloads, exception objects, and unrestricted blobs are rejected. The same sanitizer contract is reused for safe failure/replay metadata.

Composite foreign keys reject cross-Project links. A database trigger verifies that linked Operation/receipt/idempotency rows use the same correlation ID. Correlation and causation are trace identifiers only and confer no authority.

### Deferred boundary

Audit retention duration, privacy erasure/redaction, cryptographic tamper evidence, export format, operator repair, and production support access remain later proof gates. 10B freezes durable semantics, not permanent retention.

## B3. Idempotency

### Canonical scope and identity

The canonical uniqueness scope is Workspace + Project + stable Actor + action key + SHA-256 hash of the opaque client key. Raw idempotency keys are not persisted. Actor scoping supplies stable attribution, but never bypasses current authorization; 10C/10Q later derive the Actor and recheck the authenticated principal/grant.

The request fingerprint is a SHA-256 digest of the canonical materially relevant request. Same scoped key + different fingerprint is always `CONFLICT`. Same key in a different Project/Workspace/Actor/action scope is independent.

### States and replay

The record states are:

- `IN_PROGRESS` — one current claim owns the logical request;
- `COMPLETED` — replay returns the stored safe result reference/status/fingerprint/metadata;
- `FAILED_RETRYABLE` — a later claim may retry after the claim lease expires or retry time arrives;
- `FAILED_TERMINAL` — replay returns the stable terminal failure semantics.

Claim acquisition is a database function using uniqueness plus row locking; it returns exactly one of `CLAIMED`, `IN_PROGRESS`, `REPLAY`, `RETRY_CLAIMED`, `TERMINAL_FAILURE`, or `CONFLICT`. It is not an application `SELECT` followed by `INSERT`. A random UUIDv7 claim token fences stale owners. State/result mutation requires that token.

Safe replay stores only a bounded result kind/reference, response fingerprint, status code, and sanitized metadata—not an arbitrary response body. Exact retention duration remains a later privacy/operations decision; each record carries an explicit expiry boundary, and cleanup is not exposed in 10B.

### Crash correctness

For a synchronous governed mutation, claim creation, mutation, and result completion must commit in one PostgreSQL transaction. A crash before commit rolls all three back. For long-running work, the transaction commits one stable Operation handle as the replay result; worker effects are separately fenced by Operation/processing leases and domain uniqueness. A committed `IN_PROGRESS` record is not permission to repeat an unguarded effect.

This is the strongest safe foundation without inventing later business mutations. Queue delivery or lease expiry never substitutes for an effect-level uniqueness/precondition.

## B4. Operation state machine

### States

- `PENDING`
- `RUNNING`
- `RETRY_WAIT`
- `CANCELLATION_REQUESTED`
- `SUCCEEDED` (terminal)
- `FAILED` (terminal)
- `CANCELLED` (terminal)

`PENDING → RUNNING`; `RUNNING → SUCCEEDED | RETRY_WAIT | FAILED`; `RETRY_WAIT → RUNNING`; `RUNNING → CANCELLATION_REQUESTED → CANCELLED`; and `PENDING | RETRY_WAIT → CANCELLED` are legal. Terminal states never transition. A successor workflow creates a successor Operation rather than reopening a terminal row.

### Ownership and recovery

Only a `MEMOID_WORKER` Actor may acquire a lease. Acquisition row-locks the Operation, creates one UUIDv7 lease token, increments the attempt count once, and records an attempt. A competing or duplicate delivery receives no lease. An expired `RUNNING` lease can be reclaimed deterministically while the prior token becomes stale. Renewal and completion require the current token and an unexpired lease.

Retry records a bounded failure code/metadata and `next_attempt_at`; it clears ownership and moves to `RETRY_WAIT`. When the maximum attempt count is exhausted, failure is terminal. A cancellation request serializes on the Operation row: if it commits before worker completion, only cancellation completion is permitted; if success/failure commits first, later cancellation cannot reopen the terminal state.

Operation rows carry initiator Actor, kind, correlation/causation IDs, optional authorization-basis hash/recheck timestamp attachment points, bounded progress stage, retry timing, and sanitized failure data. 10C later owns actual authorization snapshots and execution/final-commit rechecks.

## B5. Provider/event receipt foundation

Provider receipts are generic durable signals keyed by Project + provider key + receipt-scope key + external delivery ID. The external ID is bounded and the unique scope prevents one Project/provider/source unit from aliasing another. If no external ID exists, callers must supply a deterministic receipt key derived outside the raw payload; random fallback is not a dedupe guarantee.

The receipt stores first-seen/received time, optional provider occurrence time, payload SHA-256, a validation attachment state (`UNVALIDATED`, `AUTHENTICATED`, or `REJECTED`), processing disposition, correlation/causation, optional Operation linkage, and bounded sanitized metadata. It contains no raw payload column.

Registration is database-backed and returns `CREATED`, `DUPLICATE`, or `CONFLICT`; a repeated identity with a different payload hash is a conflict. Disposition may move through pending/processing/retry/terminal states under guarded updates without changing receipt identity or evidence metadata. Out-of-order occurrence and receipt times remain visible. Receipt creation never mutates Source Observation, Working Context, or Reviewed Context.

GitHub HMAC verification, GitHub schemas, installation/repository identity, authoritative refetch, and Source processing remain 10E/10F.

## B6. Candidate contiguous watermark

The accepted 10A representation is correct and remains unchanged: immutable Candidate Submissions, separate stable-disposition rows, a per-Project accepted frontier, and a database-guarded contiguous reconciled watermark.

10B will prove the exact 47/48 stable, 49 pending, 50 stable case; duplicate dispositions; concurrent 49/50 completion; rollback before disposition commit; committed disposition followed by worker crash; idempotent recomputation; and rejection of direct over-advance. A stable later sequence remains visible but cannot leap the gap. Completing 49 may atomically advance through 50.

## B7. Desired/processed lease and lost-wakeup foundation

Use a provider/source-neutral `processing_units` foundation with a stable Project-scoped unit identity, monotonic desired and processed sequence, one logical lease, a snapshotted lease target, retry timing, and a durable `follow_up_required` flag.

- Advancing desired state row-locks the unit and sets `follow_up_required` whenever desired exceeds processed.
- Acquisition is possible only when work is due, atomically grants one worker token, and snapshots the current desired target.
- Completion requires the current unexpired token, advances only through the snapshotted target, clears ownership, and rechecks current desired state in the same transaction.
- If desired moved from 105 to 106 during work, completion of 105 persists `processed=105`, `desired=106`, and `follow_up_required=true` before quiescence.
- The next acquisition observes target 106. Duplicate scheduling acquires no second concurrent lease.
- Expired ownership is reclaimable; stale tokens cannot renew or complete.

The generic unit does not ingest GitHub or interpret Source frontiers. 10F later maps Source/ref processing onto it and owns authoritative refetch/incremental ingestion.

## Correlation and causation

Correlation ID groups one request/workflow across receipt, Operation, Audit Event, and later jobs. Causation ID identifies the immediate prior event/action. Both are opaque UUIDv7 identifiers, not idempotency keys, Actor identities, or authorization evidence.

The propagation rule is:

`request/receipt correlation → Operation correlation → Audit Event correlation`

with `Operation.causation = receipt.id` when a receipt directly causes it and `AuditEvent.causation = Operation.id` when the Operation directly causes the event. Database checks reject mismatched correlation on linked rows; causation remains an opaque cross-boundary reference because its cause may be a request, receipt, Operation, or event.

## Failure/race contract coverage

10B directly establishes runtime proof for `S9C-FR-013`, `014` (foundation/coalescing), `022`, `031`, `038`, `046` (foundation), and `057`. It supplies attachment/fencing semantics used later for `001`, `017`, `030`, `037`, and `083`, whose full authorization, model, API, archive, or Source behavior remains with their co-owners.

## Migration and privilege conclusion

The Stage 10B migration is additive and deterministic after `002_stage10a_domain_schema`. It does not alter accepted 10A tables or functions. All new Project-owned relationships are composite scoped, product IDs are UUIDv7, controlled vocabularies fail closed, payloads are bounded, normal Audit/Actor history is immutable, and no privilege is granted to `memoid_app`. The down migration removes only 10B objects and returns the database to the accepted 10A state.

All 10B B gates are resolved sufficiently to begin the bounded migration and proof implementation.
