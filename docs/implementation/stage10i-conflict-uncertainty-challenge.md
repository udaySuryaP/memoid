# Stage 10I challenge record

Stage 10I is intentionally a representation and lifecycle vertical, not a reconciliation engine.

The adversarial proof covers:

- Conflict and Uncertainty as separate domain concepts and lifecycle streams;
- deterministic, order-independent multi-party participant normalization;
- active occurrence uniqueness and expected-version concurrency fencing;
- append-only participant changes, endings, recurrence hooks, and immutable audit history;
- Source ↔ Reviewed, Working ↔ Reviewed, Source ↔ Working-capable, and multi-party persistence;
- explicit current-authority versus shadowed Source qualification through the AUDIT-1A resolver;
- semantically identical Source fingerprints rejected as Conflict;
- Uncertainty without Conflict and current Reviewed Context plus active Uncertainty;
- Project RLS and known-ID rejection for foreign Evidence, Working Context, Context Records, and
  Context Revisions;
- idempotent replay and stale-version failure;
- empty upgrade/downgrade plus refusal to destroy populated integrity history;
- no raw claim body, model confidence, Change Proposal, policy engine, resolution engine, retrieval,
  pack, checkpoint, or MCP implementation.

Stage 10J owns production creation/reconciliation of Working Context and semantic comparison. Test
fixtures may construct existing Working Context rows only to prove that the durable 10I references
and Project-bound validation are real.
