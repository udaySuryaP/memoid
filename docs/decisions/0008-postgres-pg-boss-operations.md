# ADR 0008: PostgreSQL and pg-boss asynchronous operations

Status: Accepted by Stage 8; synthetic foundation executed in Stage 8B; synchronized with the Stage 9C contract in Stage 9D; provider-neutral Operation/idempotency/receipt/lease foundation executed in Stage 10B.

## Decision status

- **LOCKED:** use PostgreSQL-backed pg-boss with durable Memoid Operation state for initial V1 asynchronous work.
- **LOCKED:** queue claim/delivery semantics never substitute for application-level idempotency, transactional uniqueness, preconditions, or current authorization.
- **LOCKED:** long-running work rechecks authorization and Project/grant/deletion state at submission, protected access, and final commit.
- **LOCKED:** no Redis queue is introduced initially.
- **LOCKED:** provider deliveries and Candidate Submissions retain individually auditable/idempotent receipts even when downstream work is coalesced.
- **LOCKED:** Source processing uses a transactional desired-frontier/processed-frontier relationship, one logical lease per Source/ref processing unit, atomic processed advancement, and a post-completion desired-frontier recheck. If desired advances from 105 to 106 during work, follow-up work for 106 remains durably required.
- **LOCKED:** Candidate Intake Frontier may be the highest durably accepted sequence. Candidate Reconciled Frontier is the highest contiguous accepted sequence with stable dispositions, or an explicit gap-preserving equivalent; it is never `max(sequence processed)` when gaps exist.
- **LOCKED:** reconciliation may snapshot a Project review-policy version, but automatic durable mutation re-reads current policy and relevant Source/Candidate/Context frontiers and aborts/re-evaluates if any basis changed.
- **PROVISIONAL:** queue names, retry/backoff, retention, concurrency, cancellation, and operational thresholds.
- **PROVED IN 10B:** real PostgreSQL tests cover crash/retry/replay, idempotency claim and transactional effects, Operation cancellation/lease races, provider receipt deduplication, and 105→106 lost-wakeup protection.
- **Proof-gated downstream:** stale domain bases, current authorization/grant/deletion rechecks, external-provider side-effect idempotency, and provider-specific processing remain owned by the vertical that exposes each path.
- **Implementation boundary:** Stage 10B persists provider-neutral primitives only. Product jobs, provider adapters, protected handlers, and runtime grants remain deferred to their named later verticals.

## Decision

Keep queueing and transactional state in PostgreSQL to reduce initial distributed-system complexity. Business handlers own exactly-once effects through idempotent domain transitions; pg-boss provides durable delivery and claiming only. Coalescing may skip obsolete intermediate processing work but never erases accepted submissions, provider-event audit history, or known gaps. MCP Tasks or host-specific task primitives may map to Memoid Operation state but never define it.
