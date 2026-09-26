# Stage 10J hybrid reconciliation

Stage 10J implements the reconciliation engine between immutable Candidate Assertions and unreviewed Working Context. It does not create Change Proposals, evaluate review policy, apply Context Revisions, or expose retrieval/checkpoint APIs.

## Decision path

The engine first evaluates closed, structured facts. Duplicate candidates and exact normalized hashes become `UNCHANGED`; a missing current record becomes `NEW`; known historical replacement becomes `SUPERSEDED`; active Stage 10I integrity state remains `CONFLICTING` or `UNCERTAIN`; missing or disqualified authority/evidence fails closed as `UNCERTAIN`. Authority is input from Stage 10G and is never delegated to a model. Only unresolved semantic comparisons reach a model.

The seven output classes are `NEW`, `CHANGED`, `SUPERSEDED`, `CONFLICTING`, `OBSOLETE`, `UNCERTAIN`, and `UNCHANGED`. Text difference alone does not decide the model-only classes. Normalization uses a versioned canonical object representation, bounded strings and objects, stable ordering, and SHA-256 assertion hashes.

## Provider boundary and structured output

`ReconciliationModelProvider` is the application port. Domain and application code import no provider SDK. Configuration supplies provider ID, model ID, privacy class, pricing version, and a literal fallback allowlist. A fallback with a different privacy class fails before invocation; provider switching is never implicit.

The versioned `reconciliation-output.v1` schema accepts exactly eight product fields. Unknown fields, unknown classes/reasons, mismatched flags, foreign semantic identities, and evidence IDs outside the packet allowlist fail closed. Provider, model, latency, usage, and cost remain accounting metadata and never become semantic truth. No response can mutate Reviewed Context.

## Reasoning packet, budgets, and compaction

Packets contain one Candidate Assertion, the current Reviewed record if any, bounded Working Context, allowlisted Evidence, effective authority qualification, integrity basis, and version fences. Budgets limit Evidence count, Working items, per-item characters, nesting, and total serialized bytes. Selection and truncation are deterministic and every omission is recorded. A total-budget overrun refuses the request.

The PostgreSQL material loader resolves a Source-derived Candidate's bounded `source_frontier_basis` only by joining its Evidence Reference IDs back to same-Project Stage 10F `evidence_references`. It exposes canonical Evidence metadata and Source identity, never repository bytes. Each reference is qualified with the Stage 10G/AUDIT-1A `resolve_effective_source_authority` function and the 10H/10I winning-Source check; origin, provider metadata, provenance presence, and assignment version are not authority signals. Relevant Working Context is restricted to the same Context Identity, deduplicated by Candidate, newest-first, and capped before the packet budget applies. A Candidate is known historical only when its hash matches a record on the explicit `supersedes_context_record_id` predecessor chain from the current Reviewed record.

Evidence has an explicit transmission classification. Only `PUBLIC_PROJECT_TEXT` is eligible; `SECRET`, `CREDENTIAL`, and `UNKNOWN_SENSITIVE` are excluded. A second detector rejects recognizable private keys, provider tokens, bearer credentials, JWT-like material, and credential-bearing database URLs. This detector is defense in depth, not the security boundary: explicit upstream content classification is mandatory.

Evidence is placed only in the packet's untrusted-data section. The adapter's fixed instruction says it is data, cannot change authority or configuration, and cannot supply instructions. Compaction never merges claims, rewrites authority, clears uncertainty, or removes current-versus-historical identity.

## Persistence, Working Context, and stale basis

Migration `012-stage10j-hybrid-reconciliation.ts` adds immutable `reconciliation_records`, immutable `model_invocation_attempts`, and the guarded `reconciliation_current_states` projection. All are Project-scoped, forced-RLS tables owned by the narrow database owner. The application role has read access and execute access only to the commit function; auth/provider roles have neither.

At commit, the function verifies Candidate Assertion and Context Identity ownership plus the current Reviewed record, Working currentness, Source Authority scope-version aggregate, all Source frontier watermarks, and the Stage 10I current-state version aggregate. These fences are separate from effective Source Authority resolution and change when any constituent Source or integrity state advances, avoiding unsafe project-wide `max(version)` shortcuts. A mismatch fails closed. A matching candidate/basis replays idempotently. Non-`UNCHANGED` results create or transition a Candidate-linked item to `RECONCILED_UNREVIEWED`; `UNCHANGED` creates no duplicate Working item. Working state is provenance-linked and never becomes Reviewed state. Records preserve schema, prompt, compaction, normalization, and engine versions; private model reasoning is not stored.

`CONFLICTING` and `UNCERTAIN` are normalized engine outcomes compatible with the existing 10I identities, participants, occurrences, and current projections. Stage 10J does not create another integrity subsystem and never emits `REVIEWED_RESOLUTION`, which remains exclusively Stage 10M causal work.

## Usage, retries, and cost

Every model attempt records provider/model, configuration/pricing version, input/output/total usage, timestamp, latency, success/failure, retry ordinal, and configured estimated cost. Pricing is configuration, not durable product meaning. Retryable failures are timeout, transport, rate limit, and provider unavailability; malformed/schema-invalid output, refusal, safety rejection, invalid configuration, context overflow, and budget failure do not receive blind retries. Completed logical work commits once per candidate and basis even when attempts are multiple.

## Benchmark and production gate

`pnpm benchmark:reconciliation` runs the frozen repository corpus. It covers all seven classes, equivalence, staleness, shadowed authority, missing evidence, source disagreement, ambiguity, false-conflict, and false-certainty risks. The corpus is synthetic engineering validation, not market evidence. The checked-in harness proves deterministic and structured-output contracts against a reference result. No external provider/model is encoded as a production default; a real configuration may be promoted only after the same frozen corpus reports 100% structured validity, no authority/security failures, no critical failures, and the accepted semantic thresholds with recorded usage/cost.

## Deferred ownership

- Stage 10K owns Change Proposal grouping, ordering, deduplication, and backlog behavior.
- Stage 10L owns review-policy and automatic/manual eligibility.
- Stage 10M owns accepted Context Revision application and reviewed resolution.
- Stage 10N+ owns retrieval, Context Packs, MCP, and client delivery.
