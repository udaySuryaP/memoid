# Stage 10H Context records and provenance challenge

Stage 10H is founder-directed, unvalidated production work under the locked Founder Override. Stage 2 remains **DO NOT BUILD / KILL**. The verified base is `f0c48f612ed81ced895081ca45a8f42e3cc1652f`.

## H1 — Stable identity

Context Identity is Project + normalized subject/scope/facet/predicate, not a value, title, filename, or provider object. Revisions preserve the identity UUID.

## H2 — Four-plane separation

Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context remain separate tables and trust classes. 10H mutation cannot turn an Authority Assignment into Context or overwrite Working Context.

## H3 — Immutable record history

Every accepted value appends a Context Record, Context Revision, origin row, and provenance edges. The current pointer is a projection. A unique identity-local version and predecessor edge prohibit forks and last-writer-wins loss.

## H4 — Explicit origin

User-native Context has Actor/operation provenance and no fabricated Source. Source-derived Context requires an exact immutable Evidence Reference and current applicable Authority Assignment. A reserved Memoid-operation class is not callable until its later trusted worker owner exists.

## H5 — Current versus fresh

Reviewed currentness and Source freshness are orthogonal. Newer ingested evidence, Source loss, default-branch drift, or authority replacement changes qualification without rewriting the reviewed record.

## H6 — Lifecycle

Ending is append-only and soft. The last current record remains addressable. End/revise races serialize and only one expected-version transition commits.

## H7 — Authorization

RLS is forced and Project-scoped. Reads require Project read authority; mutations require the closed owner-only context capability plus a live session and exact human Actor. Runtime roles have no direct Context-history writes.

## H8 — Audit and idempotency

Every create, revise, and end transaction reuses Stage 10B idempotency and appends an Actor-attributed Audit Event. Replay returns the original stable result and a changed request fingerprint conflicts.

## H9 — Evidence and authority validation

Cross-Project references fail through composite keys and scoped lookup. Source-backed commits fail closed for unavailable/replaced authority, inactive provider access, scope/ref mismatch, default-branch drift, missing evidence, or a behind ingestion frontier.

## H10 — Deferred behavior

Conflict/Uncertainty, reconciliation/model execution, proposals, automatic eligibility, multi-item revision application, search, Context Packs, MCP/public API, UI expansion, deletion, and production operations remain with 10I–10T.
