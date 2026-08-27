# ADR 0004: Constrained reconciliation and provider ports

Status: Accepted by Stage 8; repository record aligned in Stage 8C.

## Decision status

- **LOCKED:** provider types and credentials do not enter the Domain/Application Core.
- **LOCKED:** reconciliation uses deterministic preprocessing, authorization, provenance, and frontier checks around one constrained structured-model call.
- **LOCKED:** no autonomous agent loop and no model authority over reviewed Context, Source Authority, authorization, or Change Proposal approval.
- **PROVISIONAL:** production model/provider, parameters, schema details, retry policy, and regression-fixture winner.
- **Proof-gated:** a production model path must pass frozen reconciliation, prompt-injection, provenance, privacy, and failure-mode fixtures.
- **Implementation deferred:** prompts, product reconciliation rules, and provider wiring are not implemented in the foundation.

## Decision

Keep model, WorkOS, GitHub, storage/KMS, analytics, MCP transport, logging, and tracing behind typed ports/adapters. Memoid owns reconciliation semantics. External models can produce schema-constrained candidate classifications only after deterministic access and provenance controls; their output remains untrusted until validated and, where it would mutate reviewed context, accepted by an authorized first-party human workflow.
