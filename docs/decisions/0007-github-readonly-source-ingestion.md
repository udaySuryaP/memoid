# ADR 0007: Read-only GitHub App and selective Source ingestion

Status: Accepted by Stages 5, 6, and 8; synchronized with the Stage 9C contract in Stage 9D.

## Decision status

- **LOCKED:** production GitHub integration is a GitHub App with selected-repository access and `Metadata: read` plus `Contents: read` only in V1.
- **LOCKED:** use provider-stable repository identity; owner/name/URL are mutable discovery/display data.
- **LOCKED:** ingest selectively through bounded tree/blob reads, path/size filters, secret detection, and incremental Source frontiers rather than retaining a full repository mirror.
- **LOCKED:** webhook input is HMAC-verified, allow-listed, schema-checked, durably receipted, deduplicated, quickly acknowledged, and never directly mutates reviewed Context. It is a signal for authoritative provider refetch and desired Source-frontier advancement.
- **LOCKED:** Source processing distinguishes observed/desired, ingested, reconciled, and Reviewed Context Source coverage. Reviewed coverage is a per-Source/scope/ref or record-level vector/relationship, not one global SHA.
- **LOCKED:** every provider delivery remains individually auditable while processing may coalesce contiguous work. Desired/processed frontier advancement, logical lease ownership, transactional completion, and a post-completion desired-frontier recheck prevent lost wakeups.
- **LOCKED:** scheduled integrity checks, reconnect comparison, stale detection, retry, and optional redelivery recovery provide server-controlled catch-up. Webhook delivery alone is not the correctness mechanism.
- **LOCKED:** default-branch evidence may be authoritative for current implementation; non-default branches remain branch-qualified candidate/future evidence; force push, default-branch change, branch deletion, and repository replacement retain explicit protected semantics and historical provenance.
- **LOCKED:** Git commit count is not Memoid semantic-change count.
- **PROVISIONAL:** exact webhook subscription set, REST/GraphQL optimization, thresholds, retries, and retained excerpt policy.
- **Proof-gated:** permission/API matrix, rename/transfer/reinstall behavior, event ordering, token handling, secret filtering, and rate-limit recovery require integration proof.
- **Implementation deferred:** GitHub connection and synchronization product behavior are not implemented in the foundation.

## Decision

GitHub remains authoritative for its repository state and acts as a Source adapter, not an AI-client adapter. `git push` means authoritative repository implementation evidence changed; a Memoid checkpoint means meaningful user/AI-session Project knowledge entered Candidate Evidence. The signals are independent. Short-lived installation tokens remain ephemeral and never enter logs, exports, Context Records, or model input. Source authority is evidence authority, not instruction authority: repository content remains untrusted control text.

Large-repository processing follows frontier/diff → changed path/file/hunk → deterministic filtering → structural extraction → semantic grouping → scoped metadata/FTS/context retrieval → compact reasoning packet. Never send an entire repository to a model, retain a full repository mirror, or introduce embeddings/vectors before measured retrieval evidence justifies them.
