# Stage 10B actor, audit, idempotency, and operation foundations

Stage 10B establishes provider-neutral persistence and concurrency primitives. It does not add authentication, authorization, RLS product policies, Workspace/Project lifecycle, provider adapters, reconciliation behavior, review behavior, MCP/API product routes, UI, export, deletion, or production operations. Those attachments remain owned by 10C–10T.

The pre-implementation challenge and B-gate resolutions are recorded in `docs/implementation/stage10b-actor-audit-operation-challenge.md`.

## Domain vocabulary

`packages/domain` adds controlled, fail-closed values for:

- Workspace-stable Actor kinds: `HUMAN`, `MEMOID_SYSTEM`, `MEMOID_WORKER`, `INTEGRATION`, `DEVELOPER_CLIENT`, and `SOURCE_SYSTEM`;
- append-oriented Audit Event category/outcome keys and bounded sanitized metadata;
- idempotency record states and claim outcomes;
- Operation lifecycle, terminal-state detection, and legal transitions;
- provider receipt dispositions; and
- opaque correlation, causation, and lease identifiers.

Actor is attribution, not authentication or authorization. Untrusted callers cannot claim system or worker Actor kinds. An Audit Event stores a database-derived Actor-kind/reference/display snapshot so later Actor lifecycle changes cannot rewrite historical attribution.

## Migration order and rollback

1. `001_foundation_rls` retains the Stage 8B synthetic RLS probe.
2. `002_stage10a_domain_schema` retains the accepted Stage 10A four-plane and Project-scope foundation.
3. `003_stage10b_actor_audit_operation` adds the Stage 10B tables, guards, claim/lease functions, indexes, comments, and deny-by-default privileges.

Migration 003 rolls back independently to the exact 002 surface. Blank-to-latest, 002→003, repeated migration, migration-003 down/up, and full down/up behavior are proved against real PostgreSQL 18.

## Persistence inventory

| Table                     | Integrity role and principal invariant                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actors`                  | Workspace-stable attribution identity. Immutable after creation and deliberately independent from sessions, OAuth metadata, `clientInfo`, roles, and grants.                 |
| `audit_events`            | Append-only, Project-scoped event with database-derived Actor snapshot, bounded sanitized metadata, and correlation/causation links. Distinct from Context Revision history. |
| `idempotency_records`     | Project + Actor + controlled action + key-hash claim. Binds a request hash, replay result reference/digest, expiry, and retry/terminal state.                                |
| `operations`              | Durable Project-scoped asynchronous state, cancellation request, attempt count, lease, retry schedule, sanitized failure, and trace linkage.                                 |
| `operation_attempts`      | Immutable attempt history tied to one Operation and lease token.                                                                                                             |
| `provider_event_receipts` | Provider-neutral deduplication/audit receipt keyed by provider/type/delivery identity. Stores a payload digest and sanitized metadata, never a raw payload.                  |
| `processing_units`        | Provider-neutral logical unit with monotonic desired/processed sequences, one renewable lease, retry state, and trace linkage.                                               |

Every Project-owned row repeats non-null Workspace and Project scope. Composite foreign keys reject cross-Project associations even if another object's UUID is known.

## Transactional protocols

### Idempotency

`claim_idempotency` serializes competing claims for one Workspace/Project/Actor/action/key scope. The first matching request claims the record; an equal replay returns the stable result; a different request hash conflicts; retryable or expired work can be reclaimed with a new token; terminal failures remain terminal. `finish_idempotency` accepts only the current claim token and records only a bounded result reference/digest and sanitized metadata.

The claim and the protected domain mutation must commit in the same database transaction. Rollback removes both; commit preserves both. Queue delivery is not an exactly-once substitute.

### Operations and attempts

`acquire_operation` locks one Operation, rejects non-worker attribution, recovers expired work, creates the next immutable attempt, and returns a fresh lease token. Renewal and completion require that exact token. Stale workers cannot finish after lease loss. Retry is represented as `RETRY_WAIT`; terminal states cannot reopen. A cancellation request races safely with completion: whichever transaction commits first leaves one legal state, and a running handler must observe `CANCELLATION_REQUESTED` before any later side effect.

Authorization and Project/grant/deletion state rechecks are mandatory attachments when 10C and later verticals add protected handlers. Stage 10B does not grant any runtime path access to these tables.

### Provider receipts

`register_provider_event_receipt` atomically inserts or returns an existing provider/type/delivery receipt. Duplicate and out-of-order delivery cannot directly mutate semantic state. Later provider-specific verticals must authenticate first, persist the receipt, acknowledge promptly, authoritatively refetch, and then advance the relevant desired frontier.

### Lost-wakeup processing

`processing_units` keeps `desired_sequence` separate from `processed_sequence`. Desired advancement is monotonic. Completion advances only the sequence covered by the current lease and clears that lease atomically. If desired moves from 105 to 106 while 105 is processing, completion leaves 106 durably pending and reacquirable. Lease expiry and stale-token completion are database-enforced.

The Stage 10A Candidate frontier representation is unchanged. Stage 10B proves again that completing sequence 50 before 49 cannot advance the contiguous reconciled watermark past the gap.

## Trace semantics and privacy

Correlation identifies one cross-boundary flow; causation points to the immediately causing event when one exists. Receipt, Operation, idempotency, processing, and Audit Event rows carry opaque UUIDv7 trace identifiers. Database triggers reject linked rows whose correlation is inconsistent.

Operational and audit metadata is intentionally small and structural: controlled uppercase keys, at most 32 keys, bounded scalar arrays, and an 8 KiB encoded limit. Keys associated with credentials, tokens, sessions, raw payloads, prompts/transcripts, repository blobs, exceptions, or stacks are rejected in both the domain and database layers. Raw provider bodies remain outside this foundation.

## Proof boundary

Real-PostgreSQL concurrency tests cover duplicate and conflicting idempotency requests, rollback/commit exactly-once effects, retry/expiry/terminal behavior, provider receipt deduplication, immutable Actor/Audit/attempt history, Operation lease races and stale owners, cancellation/completion and failure/retry races, 105→106 lost-wakeup behavior, Candidate 48/49/50 gap safety, cross-Project rejection, and receipt→Operation→Audit correlation propagation.

Stage 10C remains responsible for identity, sessions, authorization, product RLS policies, and least-privilege runtime grants. Provider-specific receipt authentication/refetch belongs to 10E/10F. Product handlers and review/reconciliation attachments belong to their named later verticals. Audit/operations UI and production hardening remain 10R/10T.
