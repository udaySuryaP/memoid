# Conflict and uncertainty

Stage 10I adds integrity history for disagreement and insufficient certainty across Source,
Working, and Reviewed planes. It deliberately does not perform semantic reconciliation.

## Independent dimensions

Conflict means two or more relevant claims cannot simultaneously represent the same current
semantic truth. Uncertainty means Memoid lacks sufficient or unambiguous justification for an
interpretation. They are independent of Context currentness, Source freshness, review state, and
Source qualification. A current Context Record can therefore remain current while an active
uncertainty or conflict qualifies it.

## Stable identity and append-only history

A Conflict is Project-scoped and keyed by the existing Context Identity. `integrity_conflicts`
holds that stable identity. Every discovery, participant change, recurrence, or ending appends a
`conflict_occurrences` row. `conflict_current_states` is only a monotonic projection. Participants
are immutable occurrence snapshots and may contain two through sixteen Source Evidence, Working
Context, or Reviewed Context references. Claim bodies are not copied into the Conflict model.

An Uncertainty is independently keyed by Context Identity plus an affected semantic identity,
Source Evidence reference, Working Context item, or Reviewed Context Record. Each change or ending
appends an `uncertainty_occurrences` row. An Uncertainty requires no competing participant.

Both histories use expected-version compare-and-swap, semantic idempotency, Actor attribution,
correlation/causation, immutable Audit Events, forced Project RLS, and narrow security-definer
operations. Populated rollback is refused because it would destroy integrity history.

## Provenance and Source Authority

Participants retain durable foreign keys to existing Evidence References, Working Context items,
and Context Records. Source participation calls the AUDIT-1A
`resolve_effective_source_authority` function. The occurrence snapshot records whether that
Evidence was `AUTHORITATIVE_CURRENT`, `SHADOWED`, or degraded. This preserves explicit Source
identity in multi-Source Projects and does not create a second resolver or infer authority from
provenance.

Working Context uses the minimum persistence already present in Stage 10A. Stage 10I can reference
a real Working Context item, but it does not produce or reconcile one. Candidate Submission remains
outside the production 10I mutation boundary; the complete producer/reconciliation path belongs to
Stage 10J.

## Lifecycle and resolution boundary

An active Conflict may append a changed participant occurrence. Ending appends another occurrence
and copies the final participant snapshot so history remains inspectable. A later recurrence reuses
the stable Conflict identity. Uncertainty follows the same append-only active/ended pattern.

`REVIEWED_RESOLUTION` endings require a Context Revision belonging to the same Context Identity.
That nullable linkage is the hook for a later reviewed resolution. Stage 10I does not create that
revision, mutate a Context Record, apply a review decision, or resolve history directly. Non-review
endings describe inputs that no longer conflict or uncertainty that no longer applies; they also
remain historical facts.

The following remain deferred:

- Stage 10J: Working Context production, deterministic/model comparison, and hybrid reconciliation.
- Stage 10K: Change Proposal grouping and backlog behavior.
- Stage 10L: review-policy evaluation and review decisions.
- Stage 10M: accepted Context Revision application and reviewed Conflict resolution.
- Stage 10N+: retrieval, Context/Resume Packs, checkpoints, MCP, and external AI delivery.

No Conflict or Uncertainty operation automatically changes authoritative Source state, current
Reviewed Context, or ordinary freshness/currentness qualification.
