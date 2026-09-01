# Stage 10 entry map

Repository implementation contract baseline: **HQ-reconciled Stage 9C**.

This repository defines gates, prerequisites, proof ownership, and durable implementation boundaries. It does not independently authorize a current workstream. Before implementing or merging any vertical, verify explicit authorization against the current canonical `00 - MEMOID HQ` / project state. The entry map must remain valid when HQ later authorizes 10A, 10B, or another vertical without a status-only repository patch.

This is the repository execution companion to the canonical specification and roadmap. Canonical project state retains authority. If this file conflicts with the canonical hierarchy, stop and reconcile through HQ before coding. It records implementation order and proof gates; it does not add product semantics.

## Entry rules

1. Read the canonical specification, roadmap, evidence register, `README.md`, `AGENTS.md`, relevant ADRs, and this map.
2. Start each vertical from its named prerequisites. Security controls precede the data paths they govern.
3. Resolve every A gate before the first irreversible 10A schema/domain commitment it protects. Resolve every B gate before the named affected vertical makes the governed implementation commitment/exposes the governed path. C gates must close before production hardening/release readiness completes. D items may remain provisional only where locked product behavior does not depend on the specific choice. An A label never makes a 10B-owned concern such as Actor taxonomy falsely block unrelated 10A work.
4. Use one bounded feature/workstream branch and PR. Run required tests and return an evidence-backed handoff to HQ. Do not merge or start the next dependent vertical without explicit current HQ authorization.
5. Preserve Stage 2 `DO NOT BUILD / KILL` evidence and the locked Founder Override separately. An execution authorization never implies market validation.

## Canonical language and invariants

Use Project, Source Observation, Candidate Submission, Working Context, Reviewed Durable Context, Source, Evidence Reference, Authority Assignment, Context Identity, Context Record, Conflict, Uncertainty, Change Proposal, Proposal Item, Context Revision, Context Pack, Context Delivery metadata, Integration, Developer Credential, Actor, Audit Event, and Operation. Memory Node, Memory PR, and Memory Commit are historical terms only.

- Context Delivery metadata is not a persisted Context Pack body.
- Current is not necessarily fresh; Conflict is not Uncertainty; Source is not Evidence.
- Source authority is not instruction authority; Integration identity is not `clientInfo`; Actor is not OAuth metadata.
- Archive is not Delete; Change Proposal is not Context Revision.
- Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1.
- External clients cannot approve proposals, change authority, perform destructive actions, impersonate Actors, or bypass Project grants.

## Primary continuity contract

Memoid is primarily a durable cross-AI Project-context continuity system:

**authorized client A → task-specific Resume Context Pack → work/decisions/implementation → explicit Memoid checkpoint → Candidate Submission → deterministic intake and reconciliation → Working Context → Project review-policy evaluation → Reviewed Durable Context when eligible → authorized client B/C/D → task-specific Resume Context Pack**

GitHub is complementary. `git push` means authoritative repository implementation evidence changed. A Memoid checkpoint means meaningful user/AI-session Project knowledge should enter Candidate Evidence. Git commit count is not Memoid semantic-change count.

Checkpoint submits minimum meaningful Project knowledge rather than raw transcript storage. Resume returns the minimum qualified context required for the current task rather than a Project dump.

## Four integrity planes

1. **Source Observation** — external Source state qualified by category/scope/ref/authority/freshness.
2. **Candidate Submission** — immutable intake envelope for what a client/user/session submitted; never trusted merely because received.
3. **Working Context** — recent normalized continuity knowledge that remains unreviewed and may be pending, uncertain, conflicting, stale, branch-scoped, or superseded.
4. **Reviewed Durable Context** — Context Records created through Context Revisions and trusted according to review policy, authority, provenance, and freshness.

No plane silently collapses into another. Resume may combine relevant material from all four only when each trust class remains visibly/semantically distinguishable. Pending/unreconciled material cannot override Reviewed Durable Context, authoritative Source state, Conflict, or Uncertainty.

## Candidate origin and review policy

Every candidate semantic item preserves sufficient provenance to distinguish explicit user-authored/sufficiently user-confirmed, AI-inferred, and Source/system-derived assertions. Exact enum/type names remain proof-gated. A checkpoint request authorizes submission of extracted candidate material; it does not confirm every AI-extracted assertion.

Each Project has exactly one active `MANUAL` or `AUTOMATIC` policy. `MANUAL` is fail-safe/default when omitted or legacy, while creation explicitly presents the choice. Policy has a monotonic version, effective timestamp, changing human Actor, and Audit Event; changes are first-party, high-integrity, and step-up protected.

- `MANUAL`: Source/Candidate intake, Working Context, reconciliation, and Resume continue; trusted durable semantic mutations wait for human review.
- `AUTOMATIC`: the Memoid policy engine may apply only a positively proven eligible non-protected change after deterministic validation, evidence/origin/provenance validation, structured-output validation, and final current policy/Source/Candidate/Context basis checks. The model never approves itself.

Protected classes include Conflict, Uncertainty, stale/revalidation-required state, Source Authority or material Source-topology/default-branch/repository change, security-sensitive or destructive change, insufficient origin/evidence/provenance, invalid/low-confidence output, stale freshness-sensitive Source, branch-only future state, authority disagreement, primary/verifier disagreement, and anything the policy engine cannot positively prove eligible.

Policy transitions are prospective. Manual → Automatic does not mass-accept pending items; they retain the original policy snapshot unless a later explicit first-party reevaluation occurs. Automatic → Manual preserves prior immutable Context Revisions and requires human review for future eligible changes. If policy or any relevant frontier/current-state version changes before automatic commit, abort and re-evaluate.

## Frontier, event, branch, outage, and scale semantics

- Source frontiers distinguish observed/desired, ingested, reconciled, and Reviewed Context Source coverage. Reviewed coverage is a vector/map/record-level relationship, not one global SHA.
- Candidate Intake Frontier may be the highest durably accepted submission sequence. Candidate Reconciled Frontier is the highest contiguous accepted sequence with stable disposition, or an explicit gap-preserving equivalent. With 47/48 stable, 49 processing, and 50 stable, it cannot report 50 as if 49 were complete.
- Provider deliveries remain individually authenticated, deduplicatable, and auditable while processing may coalesce contiguous work. Desired/processed frontier advancement, logical lease ownership, transactional completion, and a post-completion desired-frontier recheck prevent lost wakeups. If desired advances from 105 to 106 while 105 is processing, follow-up for 106 remains durably required.
- GitHub webhook payload is a signal, not authoritative semantic mutation: authenticate/deduplicate → durable receipt/fast acknowledgment → authoritative provider refetch → desired frontier → incremental ingest → reconciliation scheduling.
- Scheduled integrity checks, reconnect comparison, stale detection, retries, and optional redelivery recovery provide server-controlled catch-up; webhook delivery alone is not the correctness mechanism.
- Default branch is authoritative current implementation evidence where applicable. Non-default branches are branch-qualified candidate/future evidence. Merge, branch deletion, force push/non-ancestral rewrite, default-branch change, and repository replacement preserve provenance and explicit revalidation/protected semantics.
- Before model use, Candidate intake performs enough deterministic authorization, exact Project binding, validation, size enforcement, secret scanning, normalization/minimization, and qualification for safe pending continuity. Provider outage, quota exhaustion, 429, timeout, or invalid output may delay reconciliation but cannot make a successfully accepted checkpoint disappear.
- The Memoid Engine is deterministic plus model-assisted. A provider-neutral model port supplies untrusted semantic reasoning only. Reconciliation and Resume are separate pipelines.
- Large-repository processing uses frontier/diff → changed paths/files/hunks → deterministic filtering → structural extraction → semantic grouping → scoped metadata/FTS/context retrieval → compact reasoning packet → model. Never send an entire repository or raw transcript to a model; retain no full repository mirror; add no embeddings/vector database initially without measured retrieval evidence.

## Decision and proof-gate register

Gate classes: **A** foundational/entry gate resolved before the first irreversible 10A schema/domain commitment it protects; **B** before the owning/affected vertical makes its governed implementation commitment or exposes the governed path; **C** before production hardening/release readiness completes; **D** replaceable/provisional where locked product semantics do not depend on the specific choice.

| Item                                                          | Status / gate        | Owner       | Trigger and required evidence                              | Latest                                 |
| ------------------------------------------------------------- | -------------------- | ----------- | ---------------------------------------------------------- | -------------------------------------- |
| Canonical taxonomy and invariants                             | LOCKED / A           | HQ + domain | canonical reconciliation and terminology contract tests    | 10A                                    |
| Stable IDs, timestamps, version fields, tenant/project scope  | PROOF-GATED / A      | 10A         | schema spike, migration round trip, concurrency tests      | before 10A schema commit               |
| Context Identity uniqueness and Context Record currentness    | PROOF-GATED / A      | 10A         | canonical examples and database constraint tests           | before 10A schema commit               |
| Four-plane persistence without semantic conflation            | PROOF-GATED / A      | 10A         | Candidate/Working/Reviewed/Source examples and constraints | before 10A schema commit               |
| Candidate origin/confirmation provenance implications         | PROOF-GATED / A      | 10A         | origin-basis examples without freezing exact enum names    | before 10A schema commit               |
| Review-policy version/effective-time persistence implications | PROOF-GATED / A      | 10A         | Manual/default/Automatic snapshots and migration proof     | before 10A schema commit               |
| Source/Candidate frontiers and reviewed coverage persistence  | PROOF-GATED / A      | 10A         | gap/vector examples and monotonic/concurrency constraints  | before 10A schema commit               |
| Model/policy provenance persistence implications              | PROOF-GATED / A      | 10A         | bounded audit fields and privacy-minimization examples     | before 10A schema commit               |
| Actor taxonomy and attribution snapshot                       | PROOF-GATED / B      | 10B         | human/system/worker/integration/developer threat cases     | before 10B                             |
| Audit Event minimum fields and tamper evidence                | PROVISIONAL / B      | 10B + 10T   | audit threat model, append-only proof, export sample       | before 10B; harden in 10T              |
| Idempotency key scope, retention, and replay result           | PROOF-GATED / B      | 10B         | duplicate/concurrent request tests                         | before 10B                             |
| Operation states, cancellation, retry, and terminal semantics | PROOF-GATED / B      | 10B         | worker crash/retry state-machine tests                     | before 10B                             |
| Desired/processed frontier lease and lost-wakeup behavior     | PROOF-GATED / B      | 10B + 10F   | 105→106 race, crash/retry, duplicate-job integration tests | before 10F processing                  |
| Candidate contiguous/gap-preserving reconciliation watermark  | PROOF-GATED / B      | 10B         | 47/48/50 complete with 49 pending concurrency tests        | before 10B frontier code               |
| WorkOS subject mapping and verified-email policy              | PROOF-GATED / B      | 10C         | hosted-flow integration and account-link threat tests      | before 10C                             |
| Session lifetime, revocation, and step-up freshness           | PROVISIONAL / B      | 10C         | AuthKit capability proof and security test matrix          | before 10C                             |
| Capability names, role bundles, and grant precedence          | PROOF-GATED / B      | 10C         | deny-by-default authorization matrix                       | before 10C                             |
| RLS variables, transaction scope, pool reset, non-owner role  | LOCKED direction / B | 10C         | cross-tenant and pooled-connection integration tests       | before 10C data paths                  |
| Workspace/Project membership lifecycle                        | PROOF-GATED / B      | 10D         | ownership, last-admin, archive, and invite cases           | before 10D                             |
| GitHub installation/repository identity                       | LOCKED direction / B | 10E         | provider ID rename/transfer/remove tests                   | before 10E                             |
| GitHub permissions and webhook authenticity/deduplication     | LOCKED direction / B | 10E         | least-privilege manifest and replay/out-of-order tests     | before 10E                             |
| Selective ingest frontier and no-repository-mirror boundary   | LOCKED / B           | 10F         | storage inspection and refetch tests                       | before 10F                             |
| Ingestion size, time, file-type, and retry thresholds         | PROVISIONAL / B      | 10F         | representative corpus benchmarks and abuse tests           | before 10F                             |
| Evidence Reference identity and duplicate handling            | PROOF-GATED / B      | 10F         | same-content/different-source and changed-content cases    | before 10F                             |
| Authority scope, precedence, and effective-time rules         | LOCKED semantics / B | 10G         | canonical conflict examples and authorization tests        | before 10G                             |
| Context provenance and current/fresh representation           | LOCKED semantics / B | 10H         | source-change and unavailable-source contract tests        | before 10H                             |
| Conflict versus Uncertainty classification                    | LOCKED / B           | 10I         | fixtures spanning both states and UI assertions            | before 10I                             |
| Provider-neutral model port and explicit allowlisted fallback | LOCKED direction / B | 10J         | adapter swap, privacy, outage, invalid-output tests        | before 10J                             |
| Reconciliation output/compaction contract and evidence budget | PROVISIONAL / B      | 10J         | representative benchmark, provenance, cost/latency record  | before 10J                             |
| Change Proposal/Proposal Item concurrency model               | LOCKED semantics / B | 10K         | stale-source and competing-proposal tests                  | before 10K                             |
| Review, partial acceptance, and revalidation rules            | LOCKED semantics / B | 10L         | canonical decision table and stale-review tests            | before 10L                             |
| Manual/Automatic eligibility, protected classes, transitions  | LOCKED semantics / B | 10L         | origin, policy/frontier race, transition decision fixtures | before enabling Automatic              |
| Context Revision creation and history immutability            | LOCKED / B           | 10M         | atomicity and history integrity tests                      | before 10M                             |
| Automatic Context Revision atomicity                          | PROOF-GATED / B      | 10M         | final re-read/abort and exactly-one revision tests         | before enabling Automatic              |
| PostgreSQL FTS configuration, ranking, and language           | PROVISIONAL / B      | 10N         | relevance benchmark and explain plans                      | before 10N                             |
| Context Pack selection and token/size budgets                 | PROVISIONAL / B      | 10O         | retrieval evaluation, truncation fixtures, injection tests | before 10O                             |
| Resume trust qualification and outage pending continuity      | LOCKED semantics / B | 10O         | provider-down accepted-checkpoint and precedence fixtures  | before 10O                             |
| Context Delivery metadata retention                           | PROVISIONAL / B      | 10O         | privacy review and delivery-audit proof                    | before 10O                             |
| MCP tools/resources, schemas, and OAuth scopes                | PROVISIONAL / B      | 10P         | multi-host contract tests and least-capability review      | before 10P                             |
| Host user-confirmation signal trustworthiness                 | PROOF-GATED / B      | 10P + 10L   | two-host explicit-confirmation interoperability proof      | before host-confirmed auto eligibility |
| MCP protocol-version header enforcement                       | PROOF-GATED / B      | 10P         | missing/invalid/supported header conformance tests         | before 10P exposure                    |
| Developer Credential reveal-once and rotation                 | LOCKED direction / B | 10Q         | secret non-retrievability and revocation tests             | before 10Q                             |
| Integration/Project grant revocation propagation              | PROOF-GATED / B      | 10Q         | live and queued-action revocation tests                    | before 10Q                             |
| Rate limits and abuse thresholds                              | PROVISIONAL / C      | 10P + 10T   | load/abuse test evidence                                   | before 10T closes                      |
| Export schema and completeness contract                       | PROVISIONAL / B      | 10S         | round-trip fixture and access-control review               | before 10S                             |
| Archive, delete grace, restore, and deletion saga             | LOCKED semantics / B | 10S         | race, retry, backup anti-resurrection tests                | before 10S                             |
| Retention schedule                                            | PROVISIONAL / C      | HQ + 10S    | privacy/legal review and restore constraints               | before production data                 |
| Object storage, KMS, region, and key rotation                 | PROVISIONAL / C      | 10T         | provider proof, restore drill, threat model                | before 10T closes                      |
| Analytics minimization                                        | PROVISIONAL / C      | HQ + 10T    | event inventory and privacy review                         | before production telemetry            |
| RPO/RTO, alerts, runbooks, and support ownership              | PROVISIONAL / C      | 10T         | failure drills and alert delivery proof                    | before production readiness            |
| Final provider/model selection                                | PROVISIONAL / D      | HQ          | quality/cost/latency evidence                              | may remain replaceable                 |

## Ordered vertical workstreams

Each row inherits the entry rules. Screen IDs and exact responsive states remain governed by `docs/design/stage7-screen-traceability.json`; this ordering does not alter the exact 59-screen contract.

| Vertical                                             | Prerequisites and gates                                  | Required implementation proof                                                                                                            | Downstream               |
| ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 10A Domain kernel, schema, migrations                | A gates; ADRs 0001/0002/0011                             | four-plane separation; policy/version; Candidate/Working; Source/Candidate frontier and reviewed-coverage persistence; migrations; no UI | all verticals            |
| 10B Actor, Audit Event, idempotency, Operation       | 10A; actor/audit/idempotency/operation/frontier B gates  | attribution; provider-event receipts; gap-preserving candidate watermark; lease/retry/lost-wakeup; correlation/causation tests           | 10C–10T                  |
| 10C Identity, sessions, authorization, RLS           | 10A–B; WorkOS and RLS B gates                            | login/verified email/revocation/step-up, capability matrix, cross-tenant/pool tests; auth/error screens                                  | every protected vertical |
| 10D Workspace and Project                            | 10A–C; membership lifecycle gate                         | tenant CRUD, membership/role denial, archive boundaries, explicit review-policy choice/state; workspace/project screens                  | 10E onward               |
| 10E GitHub installation and Source identity          | 10A–D; GitHub identity/permission gates                  | install/remove/rename/transfer/replay/out-of-order/default-branch/force-push tests; connection/source screens                            | 10F                      |
| 10F Source frontiers, ingestion, Evidence References | 10A–E; ingestion/evidence/lost-wakeup gates              | observed/desired/ingested/reconciled frontiers; refetch/catch-up/coalescing; large-range filters; no mirror; evidence/provenance screens | 10G–10O                  |
| 10G Authority Assignments                            | 10A–F; authority gate; first-party step-up               | branch/default authority effects, topology protection, precedence/effective-time/authz/audit tests; authority screens                    | 10H–10O                  |
| 10H Working and Reviewed Context, provenance         | 10A–G; plane/identity/currentness gates                  | Candidate/Working/Reviewed distinction, origin/provenance, concurrency/current-vs-fresh tests; context screens                           | 10I–10O                  |
| 10I Conflicts and Uncertainty                        | 10A–H; classification gate                               | deterministic fixtures across Source/Working/Reviewed planes; duplicate/conflict separation; screens                                     | 10J–10O                  |
| 10J Hybrid engine and reconciliation                 | 10A–I; model/compaction/parameter gates                  | provider-neutral port, deterministic funnel, compaction, injection, evidence validation, outage/fallback, usage/cost, benchmark harness  | 10K–10M                  |
| 10K Change Proposals and Proposal Items              | 10A–J; proposal concurrency gate                         | semantic-lineage grouping/deduplication, stale/superseded backlog, candidate-only external submission; proposal screens                  | 10L                      |
| 10L Review, policy, revalidation, partial decisions  | 10A–K; policy/review gates; first-party integrity        | Manual/Automatic transitions, origin eligibility, protected classes, policy/frontier race, batch/partial/stale tests; screens            | 10M                      |
| 10M Context Revisions and history                    | 10A–L; manual/automatic revision atomicity gates         | policy/current-frontier re-read, accepted-items-only atomic revision, exactly-once automatic application, immutable correction history   | 10N–10O                  |
| 10N Search                                           | 10A–M; FTS gate                                          | Project-isolated scoped FTS across relevant Source/Working/Reviewed evidence, ranking benchmark, trust/stale labeling                    | 10O–10P                  |
| 10O Resume Context Packs and delivery metadata       | 10A–N; pack/delivery/outage gates                        | task-specific bounded trust qualification, pending continuity, ephemeral body, budget, Conflict/provenance/injection tests               | 10P                      |
| 10P MCP and public API                               | 10A–O; OAuth/scope/schema/header/rate/confirmation gates | checkpoint + resume + status/search, two-host fail-closed Project/idempotency/confirmation/header tests; exact schemas proof-gated       | 10Q                      |
| 10Q Integrations and developer access                | 10A–P; credential/grant gates                            | reveal once, revoke/rotate, queued revocation, no impersonation; integration/credential screens                                          | 10R                      |
| 10R Activity, audit, and Operations                  | 10A–Q; audit/operation gates                             | Source/review/working freshness, proposal backlog, provider degradation/usage, actor fidelity, sanitized failure, retry authorization    | 10S–10T                  |
| 10S Export, archive, delete, restore                 | 10A–R; export/deletion/retention gates                   | policy/working/frontier coverage without secrets, pending-job fencing, grace/restore/backup anti-resurrection tests                      | 10T                      |
| 10T Production hardening                             | all prior; all C gates                                   | 50-push/race/load, catch-up, provider failure/privacy, model benchmark, security/accessibility/restore/deletion drills                   | release decision         |

## Complete Stage 9C failure/race contract

The complete repository-native canonical source for the **83 Stage 9C failure/race scenarios** is:

`docs/implementation/stage9c-failure-race-contract.json`

That machine-readable source is authoritative for scenario identity, trigger, detection, required canonical behavior, user-visible behavior, recovery, idempotency/concurrency, audit expectation, Stage 10 owner(s), proof/test, and proof-gated mechanism status. This map may summarize/group scenarios but must never replace or truncate the complete 83-case source.

Controlling examples include push bursts/worker races/lost wakeups; Source newer than Reviewed; Working-versus-Reviewed and Working-versus-Source disagreement; duplicate/out-of-order/missing GitHub events; force push/default-branch behavior; candidate frontier gaps; model outage/invalid output after accepted checkpoint; policy/frontier change before automatic commit; grant revocation; delete/archive fencing; and Resume while Source/review/model state is degraded.

## Completion boundary

This map makes Stage 10 implementation dependencies explicit in order. It defines gates, prerequisites, and proof ownership; it **does not independently authorize Stage 10 or any current vertical**. Current execution authorization must always be verified against canonical `00 - MEMOID HQ` / project state before implementation or merge.
