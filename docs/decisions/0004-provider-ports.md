# ADR 0004: Constrained reconciliation and provider ports

Status: Accepted by Stage 8; synchronized with the Stage 9C contract in Stage 9D.

## Decision status

- **LOCKED:** provider types and credentials do not enter the Domain/Application Core.
- **LOCKED:** Memoid is a deterministic system with model-assisted semantic reasoning. Reconciliation uses deterministic authorization, Project binding, validation, secret scanning/redaction, size enforcement, normalization/minimization, deduplication, evidence retrieval, provenance/frontier checks, strict structured output, and evidence/schema validation around provider-neutral model calls.
- **LOCKED:** reconciliation and Resume Context Pack generation are separate semantic pipelines, not one generic summarization prompt.
- **LOCKED:** no autonomous agent loop and no model authority over Reviewed Durable Context, Source Authority, review policy, authorization, grants, destructive actions, or Change Proposal approval. A model never approves itself.
- **LOCKED:** model-provider failure may delay semantic reconciliation but cannot discard Source/Candidate intake or hide a successfully accepted checkpoint from explicitly lower-trust pending/unreconciled cross-client continuity.
- **LOCKED:** fallback is explicit, allowlisted, privacy-compatible, and auditable; private Project data is never silently routed to an arbitrary provider.
- **PROVISIONAL:** production model/provider, parameters, schema details, retry timing, provider roles, and regression-fixture winner.
- **Proof-gated:** a production model path must pass frozen reconciliation, compaction, prompt-injection, evidence-reference, provenance, privacy, cost/latency, invalid-output, provider-failure, and incorrect-automatic-acceptance fixtures.
- **Implementation deferred:** prompts, product reconciliation rules, and provider wiring are not implemented in the foundation.

## Decision

Keep model, WorkOS, GitHub, storage/KMS, analytics, MCP transport, logging, and tracing behind typed ports/adapters. Memoid owns reconciliation, qualification, policy evaluation, and Resume semantics. External models can produce schema-constrained candidate classifications only after deterministic access and provenance controls; output remains untrusted until Memoid validates it. A first-party human reviews protected changes; in an explicitly configured `AUTOMATIC` Project, only the Memoid policy engine may apply a positively proven eligible non-protected mutation after re-reading the current policy and relevant frontiers.

Every model-assisted Operation retains bounded audit/debug provenance such as provider/model/config/prompt-policy/schema versions, Source/Candidate frontier basis, evidence-packet hash, Operation/correlation/causation identity, provider role, timestamp, and usage/cost where available without persisting unnecessary sensitive raw prompts. Model metadata is provenance, not Actor identity.
