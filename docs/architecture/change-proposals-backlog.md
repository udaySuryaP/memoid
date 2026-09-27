# Stage 10K change proposals and backlog

Stage 10K turns accepted, persisted Stage 10J reconciliation records into inspectable review work. It does not classify semantic changes, evaluate review policy, persist review decisions, or mutate Reviewed Context.

## Proposal and Proposal Item

A Change Proposal is a deterministic review grouping. A Proposal Item is one independently reviewable semantic mutation candidate. Proposal identity is a UUIDv7 durable record; grouping is versioned as `proposal-grouping.v1` and hashes Project, Candidate Submission, Context Identity scope, and facet. This groups compatible assertions from one causal submission without collapsing unrelated Projects, scopes, or facets. Conflict, uncertainty, obsolete/destructive meaning, semantic class, and provenance remain item fields and are never collapsed by grouping.

The item semantic fingerprint is versioned as `proposal-item-identity.v1`. It includes Project, Context Identity, the unchanged Stage 10J reconciliation class, normalized assertion, Reviewed Context basis, sorted Evidence references, and Source Authority, Evidence frontier, and integrity versions. Raw text equality is therefore insufficient for deduplication. The fingerprint answers whether two records propose the same semantic work; basis currentness independently answers whether an existing item is still safe to review. Replay requires the same fingerprint, stored `CURRENT` lifecycle, and an observably current basis. `ReconciliationClass.SUPERSEDED` remains semantic meaning; proposal/item `SUPERSEDED` remains backlog lifecycle state.

`UNCHANGED` reconciliation records return no Proposal Item. The same reconciliation replays through a unique composite key. A different reconciliation with the same semantic fingerprint replays only an observably current item; an observably stale match remains historical and receives one monotonic successor. Materialization retains Project-and-Context serialization for lineage and also serializes open-Proposal selection and creation on the final Project + Candidate Submission + scope + facet grouping hash.

## History and current backlog

`change_proposals` and `change_proposal_items` are immutable snapshots. `proposal_current_states` and `proposal_item_current_states` are explicit current projections. `proposal_state_events` is append-only lifecycle history and records when and why an object became current, stale, or superseded. The default backlog order is current/open first, then state-change time, creation time, and UUID; there is no inferred priority or confidence score.

Current items are deterministically re-evaluated against their persisted 10J basis. A changed Reviewed Context record/version, Source Authority aggregate, Evidence frontier aggregate, integrity aggregate, non-current reconciliation, or relevant Working Context advancement makes the old item stale. Working currentness uses the Stage 10J committed fence: reconciliation records are written after Stage 10J updates their own Working item, so only a same-Context-Identity Working timestamp later than the reconciliation record stales the item. This keeps a freshly reconciled proposal current and ignores unrelated identities. Refresh is monotonic: `CURRENT`/`OPEN` may become `STALE`, never silently refresh in place.

Read-time and persisted backlog semantics are identical: an `OPEN` Proposal stays reviewable while at least one stored-`CURRENT` item is observably current, and its actionable count includes only those items. With zero observably current items it reads as `STALE`; refresh persists the same result. `SUPERSEDED` remains authoritative and independent.

When a newer reconciliation represents the same Context Identity concern, materialization creates a new immutable item and links the prior current item to it. A proposal with no remaining current items is linked to the successor proposal. Project-scoped composite foreign keys reject foreign links; self-links are constrained; only the security-definer materializer can write projections; serialized creation plus one terminal transition prevents cycles and multiple current successors.

## Semantic diff and provenance

The read model exposes the reconciliation class, normalized proposed assertion, current Reviewed Context record reference, Working Context item reference, Evidence references, conflict/uncertainty/destructive qualifications, lifecycle, and successor. This supports a bounded semantic diff between referenced Reviewed Context and the normalized proposal without copying repository content. Provenance remains traceable through Proposal Item → Reconciliation Record → Candidate Assertion → Working Context → Evidence → Source/Authority, while the exact accepted 10J basis versions are frozen on the item.

## Security and operation boundary

All five Project-owned tables use forced RLS and Project-scoped composite foreign keys. The application role receives read access only; writes are limited to fixed-search-path security-definer functions. Materialization and refresh require `MEMOID_SYSTEM` or `MEMOID_WORKER`, create terminal Stage 10B Operations, and append audit/state events. First-party readers require `PROJECT_READ`; internal generation requires `PROJECT_MANAGE_CONTEXT`. There is no generic CRUD or external review mutation API.

## Deferred ownership

- Stage 10L owns MANUAL/AUTOMATIC review-policy evaluation and eligibility.
- Stage 10M owns approve/edit/reject/defer decisions, accepted Context Revisions, Reviewed Context mutation, and reviewed conflict resolution.
- Stage 10N+ owns retrieval, Context Packs, and client delivery.

The lifecycle schema can later retain a deferred historical item and link a new reconciliation to a successor without reopening or rewriting the old item.
