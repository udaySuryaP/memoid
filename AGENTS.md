# Agent guide

This is the reconciled Stage 8B/8C foundation under the active Stage 9B final project-integrity gate. Stage 9 passed after the completed and HQ-reconciled Stage 9A corrections; Stage 10 is blocked until Stage 9B HQ reconciliation. Read the relevant linked document before changing an area.

Current stage state: Stage 8B **COMPLETE — HQ RECONCILED AFTER CORRECTION**; Stage 8C **COMPLETE — HQ RECONCILED**; Stage 9 **COMPLETE — PASS AFTER STAGE 9A CORRECTIONS**; Stage 9A **COMPLETE — HQ RECONCILED**; Stage 9B **ACTIVE — FINAL PROJECT INTEGRITY AND CONTINUITY GATE**; Stage 10 **BLOCKED UNTIL STAGE 9B HQ RECONCILIATION**.

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
- Context Pack bodies remain ephemeral by default. Source Authority changes are first-party, step-up-protected, high-integrity actions.
- Do not implement product verticals or product schema until Stage 10 is explicitly authorized after Stage 9B HQ reconciliation.
- Keep provider/framework imports out of `packages/domain` and infrastructure dependencies out of `packages/application`.
