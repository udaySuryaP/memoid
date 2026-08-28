# Agent guide

This repository's implementation contract is synchronized through the **HQ-reconciled Stage 9C** baseline. Repository guidance defines durable implementation boundaries, proof gates, and engineering invariants; it does **not independently authorize a current workstream**.

Before implementing or merging any product vertical, verify explicit authorization against the current canonical `00 - MEMOID HQ` / project state. Do not infer live authorization from repository status prose, branch names, PR state, or the Stage 10 entry map.

- Architecture and dependency boundaries: `docs/architecture/foundation.md`
- Consequential decisions and status: `docs/decisions/README.md`
- Security boundaries and tests: `docs/security/foundation.md`
- Provider boundaries: `docs/integrations/provider-boundaries.md`
- Repository governance: `docs/governance/repository.md`
- Design tokens and exact screen traceability: `docs/design/`
- Tests and visual regression: `docs/testing/strategy.md`
- Local operation: `docs/operations/development.md`
- Stage 10 entry order and proof gates: `docs/implementation/stage10-entry-map.md`
- Complete Stage 9C failure/race contract: `docs/implementation/stage9c-failure-race-contract.json`

Non-negotiable guardrails:

- Stage 2 remains **DO NOT BUILD / KILL** evidence. The locked Founder Override authorizes execution; it does not create market validation.
- Preserve the canonical architecture. No Redis, vectors, or embeddings initially.
- GitHub is read-only in V1. MCP is an adapter and never owns product semantics.
- Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1. Source synchronization is Memoid/server-controlled.
- External AI clients cannot approve Change Proposals or perform first-party high-integrity actions.
- Keep Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context as four distinct integrity planes. None may silently collapse into another.
- A checkpoint authorizes candidate submission, not blanket user confirmation. Preserve assertion origin/confirmation and never auto-accept a purely AI-inferred assertion solely because the user checkpointed or the model is confident.
- `MANUAL` is the fail-safe/default Project review policy. `AUTOMATIC` is explicit, prospective, versioned, audited, step-up protected, and limited to changes the Memoid policy engine positively proves eligible after current-frontier checks.
- Candidate Reconciled Frontier is a contiguous stable-disposition watermark or an explicit gap-preserving equivalent, never `max(sequence processed)` when gaps exist.
- Model-provider failure may delay reconciliation but cannot erase an accepted checkpoint from cross-client continuity. Pending/unreconciled material remains explicitly lower trust and cannot override reviewed or authoritative state.
- Git commit count is not Memoid semantic-change count. Non-default branches remain branch-qualified future/candidate evidence until default-branch provider state establishes current implementation truth.
- Reconciliation and Resume/Context Pack generation are separate semantic pipelines.
- Context Pack bodies remain ephemeral by default. Source Authority changes are first-party, step-up-protected, high-integrity actions.
- Keep provider/framework imports out of `packages/domain` and infrastructure dependencies out of `packages/application`.
- Never start a workstream merely because its repository gate appears satisfiable; current execution authorization always comes from canonical HQ/project state.
