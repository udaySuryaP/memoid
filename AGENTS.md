# Agent guide

This is the Stage 8B foundation repository. Keep this file navigational and read the relevant linked document before changing an area.

- Architecture and allowed dependencies: `docs/architecture/foundation.md`
- Security boundaries: `docs/security/foundation.md`
- Provider boundaries: `docs/integrations/provider-boundaries.md`
- Design tokens and screen traceability: `docs/design/`
- Tests and visual regression: `docs/testing/strategy.md`
- Local operation: `docs/operations/development.md`
- Consequential decisions: `docs/decisions/`

Do not implement Projects, Context Records, Sources, Change Proposals, Context Revisions, reconciliation behavior, GitHub synchronization, MCP product tools, exports, deletion behavior, or other product verticals until a later authorized stage. Do not place framework/provider imports in `packages/domain` or infrastructure dependencies in `packages/application`.
