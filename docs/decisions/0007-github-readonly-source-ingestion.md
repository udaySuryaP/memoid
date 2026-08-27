# ADR 0007: Read-only GitHub App and selective Source ingestion

Status: Accepted by Stages 5, 6, and 8; repository record added in Stage 8C.

## Decision status

- **LOCKED:** production GitHub integration is a GitHub App with selected-repository access and `Metadata: read` plus `Contents: read` only in V1.
- **LOCKED:** use provider-stable repository identity; owner/name/URL are mutable discovery/display data.
- **LOCKED:** ingest selectively through bounded tree/blob reads, path/size filters, secret detection, and incremental Source frontiers rather than retaining a full repository mirror.
- **LOCKED:** webhook input is HMAC-verified, allow-listed, schema-checked, deduplicated, and never directly mutates reviewed Context.
- **PROVISIONAL:** exact webhook subscription set, REST/GraphQL optimization, thresholds, retries, and retained excerpt policy.
- **Proof-gated:** permission/API matrix, rename/transfer/reinstall behavior, event ordering, token handling, secret filtering, and rate-limit recovery require integration proof.
- **Implementation deferred:** GitHub connection and synchronization product behavior are not implemented in the foundation.

## Decision

GitHub remains authoritative for its repository state and acts as a Source adapter, not an AI-client adapter. Short-lived installation tokens remain ephemeral and never enter logs, exports, Context Records, or model input. Source authority is evidence authority, not instruction authority: repository content remains untrusted control text.
