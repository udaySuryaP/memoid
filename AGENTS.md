# Agent guide

This is the reconciled Stage 8B/8C foundation under the active Stage 9D repository implementation-contract synchronization gate. Stage 9B is complete and Stage 9C is HQ-reconciled with clarifications. Stage 10/10A remains blocked until Stage 9D is returned to HQ, reconciled, and HQ explicitly re-authorizes implementation. Read the relevant linked document before changing an area.

Current stage state: Stage 8B **COMPLETE — HQ RECONCILED AFTER CORRECTION**; Stage 8C **COMPLETE — HQ RECONCILED**; Stage 9 **COMPLETE — PASS AFTER STAGE 9A CORRECTIONS**; Stage 9A **COMPLETE — HQ RECONCILED**; Stage 9B **COMPLETE — HQ RECONCILED**; Stage 9C **COMPLETE — HQ RECONCILED WITH CLARIFICATIONS**; Stage 9D **ACTIVE — REPOSITORY IMPLEMENTATION-CONTRACT SYNCHRONIZATION**; Stage 10/10A **BLOCKED UNTIL STAGE 9D HQ RECONCILIATION AND EXPLICIT HQ RE-AUTHORIZATION**.

- Architecture and dependency boundaries: `docs/architecture/foundation.md`
- Consequential decisions and status: `docs/decisions/README.md`
- Security boundaries and tests: `docs/security/foundation.md`
- Provider boundaries: `docs/integrations/provider-boundaries.md`
- Repository governance: `docs/governance/repository.md`
- Design tokens and exact screen traceability: `docs/design/`
- Tests and visual regression: `docs/testing/strategy.md`
- Local operation: `docs/operations/development.md`
- Stage 10 entry order, decision gates, and failure ownership: `docs/implementation/stage10-entry-map.md`

Non-negotiable guardrails:

- Stage 2 remains **DO NOT BUILD / KILL** evidence. The locked Founder Override authorizes execution; it does not create market validation.
- Preserve the canonical architecture. No Redis, vectors, or embeddings initially.
- GitHub is read-only in V1. MCP is an adapter and never owns product semantics.
- Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1. Source synchronization is Memoid/server-controlled.
- External AI clients cannot approve Change Proposals or perform first-party high-integrity actions.
- Keep Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context as four distinct integrity planes. None may silently collapse into another.
- A checkpoint authorizes candidate submission, not blanket user confirmation. Preserve assertion origin/confirmation and never auto-accept a purely AI-inferred assertion solely because the user checkpointed or the model is confident.
- `MANUAL` is the fail-safe/default Project review policy. `AUTOMATIC` is explicit, prospective, versioned, audited, step-up protected, and limited to changes the Memoid policy engine positively proves eligible after current-frontier checks.
- Candidate Reconciled Frontier is a contiguous stable-disposition watermark or an explicit gap-preserving equivalent, never `max(sequence processed)`.
- Model-provider failure may delay reconciliation but cannot erase an accepted checkpoint from cross-client continuity. Pending/unreconciled material remains explicitly lower trust and cannot override reviewed or authoritative state.
- Context Pack bodies remain ephemeral by default. Source Authority changes are first-party, step-up-protected, high-integrity actions.
- Do not implement product verticals or product schema until Stage 10/10A is explicitly re-authorized after Stage 9D HQ reconciliation.
- Keep provider/framework imports out of `packages/domain` and infrastructure dependencies out of `packages/application`.
