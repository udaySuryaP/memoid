# Stage 10F ingestion frontier and Evidence References

Stage 10F turns authenticated repository state into durable, bounded Source-side
evidence. It extends the accepted Stage 10A Source frontier, Stage 10B processing
lease, Stage 10C Actor/RLS, and Stage 10E GitHub identity contracts. It does not
perform semantic reconciliation, choose Source Authority, or write Working or
Reviewed Context.

## Deterministic flow

1. A Memoid system or worker Actor asks the provider adapter to refetch one
   canonical `refs/heads/...` ref using a short-lived, repository-restricted
   GitHub App installation token.
2. The adapter verifies the installation account and stable repository ID, then
   resolves the ref to an immutable commit. A verified missing ref is recorded
   explicitly; provider/access failures remain retryable and cannot imply
   deletion.
3. `schedule_source_observation` serializes the existing Source/ref frontier
   unit, deduplicates an identical latest observation, appends the next
   observation sequence, advances observed/desired, and updates the existing
   Stage 10B `SOURCE_INGESTION` processing unit in one transaction.
4. One bound `MEMOID_WORKER` Actor acquires the existing fenced processing
   lease. The leased target sequence cannot change underneath that worker.
5. The adapter performs an initial immutable tree read or a bounded incremental
   compare. Rewrites, non-forward ranges, large comparisons, and incomplete
   compare output use a bounded tree fallback.
6. Deterministic path/type/size/encoding/secret filters produce structured
   Evidence References containing identity and hashes only. Repository bytes,
   patches, provider payloads, and discovered secrets are not persisted.
7. `complete_source_ingestion` atomically records explicit coalesced/ingested/
   deleted dispositions, proves the disposed sequence range is contiguous,
   advances only the ingestion frontier, completes the Stage 10B processing
   lease, and writes a sanitized Audit Event. Desired movement during the lease
   leaves follow-up work durable.

## Persistence inventory

- `memoid.evidence_references` — immutable UUIDv7 references scoped to the exact
  Workspace, Project, Source, frontier unit, and Source Observation. Structured
  columns hold evidence kind, immutable repository revision, exact provider path,
  optional previous path, provider object ID, bounded byte size, SHA-256, and an
  optional structural locator. There is no raw-content or generic evidence JSON
  column.
- `memoid.source_ingestion_dispositions` — one immutable stable disposition per
  observation sequence. `COALESCED` points at the later observation that
  subsumed it; `INGESTED` and `REF_DELETED` are terminal for that sequence.

Both tables are owned by `memoid_owner`, use composite Project scope and forced
RLS, and grant `memoid_app` read-only table access. Mutation is available only
through fixed-search-path security-definer functions. `memoid_auth` and
`memoid_provider` receive no new privilege.

## Bounds and classifications

One run permits at most 10,000 candidate entries, 2,000 persisted references,
512 KiB per fetched UTF-8 text blob, 32 MiB fetched bytes, 1,024 characters per
path, and 500 non-recursive tree API calls. Binary/generated/vendor/lockfile,
oversized, unsupported-encoding, symlink, submodule, likely-secret, and policy-
excluded inputs become bounded counts only. The adapter never expands archives,
follows symlinks, initializes submodules, executes repository material, or calls
a model.

## Frontier and historical semantics

Observed, desired, ingested, reconciled, and Reviewed Source coverage remain
distinct. Ingestion completion requires an explicit disposition for every
sequence after the prior ingestion watermark through the leased target; a
`max(sequence)` shortcut is impossible. Force pushes, deletion, and recreation
append observations and never mutate historical references. Default-branch
qualification is recorded as observation evidence only. Stage 10G alone owns
authority assignment and precedence.

## Provider failure and catch-up

Webhooks are only one possible caller signal. Scheduled integrity scans,
reconnect, startup recovery, stale detection, and retries must invoke the same
authoritative refetch and scheduling path; no webhook field supplies a revision.
Dispatch cadence and queue tuning are provisional under ADR 0008 rather than a
second correctness model. Rate limits, timeouts, malformed responses, access
loss, and provider outages never advance ingestion. The existing retry contract
stores only controlled failure codes and sanitized metadata. Installation
tokens, authorization headers, repository paths, contents, provider payloads,
and stack traces never enter audit metadata.

## Production runtime

The Fastify GitHub webhook boundary authenticates push deliveries and enqueues
only stable repository/ref identity as a refetch signal. The pg-boss worker owns
the production consumer, reconstructs the Project-scoped worker context through
a narrow database function, and invokes the same `SourceIngestionService` used
by startup and five-minute recovery scans. Job retries and durable frontier
state recover process restarts, expired leases, duplicate deliveries, and lost
wakeups; webhook revision fields never bypass authoritative provider refetch.

See the [Stage 10F challenge](../implementation/stage10f-ingestion-evidence-challenge.md)
for the F1–F12 decisions and rejected alternatives.
