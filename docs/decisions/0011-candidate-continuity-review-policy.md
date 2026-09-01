# ADR 0011: Candidate continuity and Project review policy

Status: Accepted from the Stage 9C canonical contract; repository record added in Stage 9D; foundational persistence implemented in Stage 10A. Runtime behavior remains deferred.

## Decision status

- **LOCKED:** Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context are four distinct integrity planes.
- **LOCKED:** a Candidate Submission is an immutable intake envelope and never trusted merely because received. Working Context is recent normalized continuity knowledge that remains unreviewed and qualified. Reviewed Durable Context consists of Context Records created through Context Revisions under the applicable Project policy.
- **LOCKED:** every candidate semantic item preserves sufficient origin/confirmation provenance to distinguish explicit user-authored or sufficiently user-confirmed, AI-inferred, and Source/system-derived assertions. Exact enum/type names are proof-gated.
- **LOCKED:** a checkpoint request authorizes submission of extracted material; it does not confirm every AI-extracted assertion.
- **LOCKED:** each Project has one active `MANUAL` or `AUTOMATIC` review policy. `MANUAL` is fail-safe/default for omitted or legacy policy. Creation presents the choice explicitly; policy changes are monotonic-versioned, effective-timestamped, first-party, step-up protected, and audited.
- **LOCKED:** `MANUAL` does not stop Source intake, Candidate intake, Working Context, reconciliation, or Resume. It only requires first-party human review before trusted durable semantic mutation.
- **LOCKED:** `AUTOMATIC` permits only Memoid policy-engine actions positively proven eligible after deterministic validation, evidence/origin/provenance checks, current-frontier checks, and current policy re-read. The model never approves itself.
- **LOCKED:** Conflict, Uncertainty, stale/revalidation-required state, Source Authority or material topology change, security-sensitive or destructive change, insufficient evidence/origin/provenance, invalid/low-confidence output, stale freshness-sensitive Source, branch-only future state, authority disagreement, verifier disagreement, and anything not positively proven eligible remain protected.
- **LOCKED:** Manual → Automatic and Automatic → Manual changes are prospective. Pending items retain their original policy snapshot; no mass acceptance occurs; accepted revision history remains immutable; corrections create successors.
- **LOCKED:** a successfully accepted checkpoint remains available as explicitly pending/unreconciled lower-trust continuity during model-provider failure after deterministic safe intake. It cannot override reviewed truth, authoritative Source state, Conflict, or Uncertainty.
- **Implemented in 10A:** separate plane tables, orthogonal Candidate origin/confirmation fields, append-oriented review-policy versions, and gap-safe Candidate frontier representation. Resume presentation, policy UI/runtime mechanics, and host-specific user-confirmation signals remain proof-gated.
- **Proof-gated:** 10A proves persistence without plane conflation; 10L/10M prove eligibility, transitions, concurrent policy/frontier change, and atomic application; 10O proves trust-qualified Resume; 10P/10L prove whether a host can supply a trustworthy explicit user-confirmation signal.
- **Runtime deferred:** no policy engine, Candidate/API intake path, Working Context behavior, Resume Pack, reconciliation, MCP tool, or UI behavior is implemented by this ADR or Stage 10A.

## Decision

Memoid's primary product loop is durable cross-AI Project-context continuity. An authorized client obtains a task-specific Resume Context Pack, the user works, an explicit checkpoint submits minimum meaningful Candidate Evidence, deterministic intake makes the accepted material safe and attributable, reconciliation develops Working Context, and the Project review policy controls eligible durable mutation. Another authorized client can resume with each trust class visibly qualified.

Checkpoint consent and assertion confirmation are intentionally different. Purely AI-inferred planning claims remain Working Context/review candidates unless an allowed origin/evidence basis is independently established. Provider failure may postpone semantic reasoning, but it cannot make accepted recent work disappear from cross-client continuity.
