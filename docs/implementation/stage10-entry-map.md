# Stage 10 entry map

Status: Stage 9B audit artifact. Stage 10 remains blocked until Stage 9B is reconciled and explicitly authorized by HQ.

This is the repository execution companion to the canonical Notion CMS and roadmap. Notion retains authority. If this file conflicts with the canonical hierarchy, stop and reconcile through HQ before coding. It records implementation order and proof gates; it does not add product semantics.

## Entry rules

1. Read the canonical CMS, roadmap, evidence register, `README.md`, `AGENTS.md`, relevant ADRs, and this map.
2. Start each vertical from its named prerequisites. Security controls precede the data paths they govern.
3. Resolve every A gate before Stage 10 begins and every B gate before the affected vertical begins. C gates must close before production hardening completes. D items may remain provisional only where the canonical product behavior does not depend on them.
4. Use one bounded `stage10/<vertical>` branch and PR per workstream. Run required tests and return an evidence-backed handoff to HQ. Do not merge or start the next dependent vertical without HQ authorization.
5. Preserve the Stage 2 `DO NOT BUILD / KILL` evidence and the locked Founder Override separately. Execution is authorized; market validation is not implied.

## Canonical language and invariants

Use Project, Source, Evidence Reference, Authority Assignment, Context Identity, Context Record, Conflict, Change Proposal, Proposal Item, Context Revision, Context Pack, Context Delivery metadata, Integration, Developer Credential, Actor, Audit Event, and Operation. Memory Node, PR, and Commit are historical terms only.

- Context Delivery metadata is not a persisted Context Pack body.
- Current is not necessarily fresh; Conflict is not Uncertainty; Source is not Evidence.
- Source authority is not instruction authority; Integration identity is not `clientInfo`; Actor is not OAuth metadata.
- Archive is not Delete; Change Proposal is not Context Revision.
- Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1.
- External clients cannot approve proposals, change authority, perform destructive actions, impersonate Actors, or bypass Project grants.

## Decision and proof-gate register

Gate classes: **A** before Stage 10 starts; **B** before the named vertical; **C** before production hardening closes; **D** may remain provisional. “Latest” is the final point at which the item can be decided without avoidable rework.

| Item                                                          | Status / gate        | Owner       | Trigger and required evidence                               | Latest                      |
| ------------------------------------------------------------- | -------------------- | ----------- | ----------------------------------------------------------- | --------------------------- |
| Canonical taxonomy and invariants                             | LOCKED / A           | HQ + domain | CMS reconciliation and terminology contract tests           | 10A                         |
| Stable IDs, timestamps, version fields, tenant/project scope  | PROOF-GATED / A      | 10A         | schema spike, migration round trip, concurrency tests       | before 10A schema commit    |
| Context Identity uniqueness and Context Record currentness    | PROOF-GATED / A      | 10A         | canonical examples and database constraint tests            | before 10A schema commit    |
| Actor taxonomy and attribution snapshot                       | PROOF-GATED / A      | 10B         | human/system/worker/integration/developer threat cases      | before 10B                  |
| Audit Event minimum fields and tamper evidence                | PROVISIONAL / B      | 10B + 10T   | audit threat model, append-only proof, export sample        | before 10B; harden in 10T   |
| Idempotency key scope, retention, and replay result           | PROOF-GATED / B      | 10B         | duplicate/concurrent request tests                          | before 10B                  |
| Operation states, cancellation, retry, and terminal semantics | PROOF-GATED / B      | 10B         | worker crash/retry state-machine tests                      | before 10B                  |
| WorkOS subject mapping and verified-email policy              | PROOF-GATED / B      | 10C         | hosted-flow integration and account-link threat tests       | before 10C                  |
| Session lifetime, revocation, and step-up freshness           | PROVISIONAL / B      | 10C         | AuthKit capability proof and security test matrix           | before 10C                  |
| Capability names, role bundles, and grant precedence          | PROOF-GATED / B      | 10C         | deny-by-default authorization matrix                        | before 10C                  |
| RLS variables, transaction scope, pool reset, non-owner role  | LOCKED direction / B | 10C         | cross-tenant and pooled-connection integration tests        | before 10C data paths       |
| Workspace/Project membership lifecycle                        | PROOF-GATED / B      | 10D         | ownership, last-admin, archive, and invite cases            | before 10D                  |
| GitHub installation/repository identity                       | LOCKED direction / B | 10E         | provider ID rename/transfer/remove tests                    | before 10E                  |
| GitHub permissions and webhook authenticity/deduplication     | LOCKED direction / B | 10E         | least-privilege manifest and replay/out-of-order tests      | before 10E                  |
| Selective ingest frontier and no-repository-mirror boundary   | LOCKED / B           | 10F         | storage inspection and refetch tests                        | before 10F                  |
| Ingestion size, time, file-type, and retry thresholds         | PROVISIONAL / B      | 10F         | representative corpus benchmarks and abuse tests            | before 10F                  |
| Evidence Reference identity and duplicate handling            | PROOF-GATED / B      | 10F         | same-content/different-source and changed-content cases     | before 10F                  |
| Authority scope, precedence, and effective-time rules         | LOCKED semantics / B | 10G         | canonical conflict examples and authorization tests         | before 10G                  |
| Context provenance and current/fresh representation           | LOCKED semantics / B | 10H         | source-change and unavailable-source contract tests         | before 10H                  |
| Conflict versus Uncertainty classification                    | LOCKED / B           | 10I         | fixtures spanning both states and UI assertions             | before 10I                  |
| Reconciliation model/provider and deterministic fallback      | PROVISIONAL / B      | 10J         | quality, timeout, injection, and reproducibility evaluation | before 10J                  |
| Reconciliation parameters and evidence budget                 | PROVISIONAL / B      | 10J         | representative benchmark set and cost/latency record        | before 10J                  |
| Change Proposal/Proposal Item concurrency model               | LOCKED semantics / B | 10K         | stale-source and competing-proposal tests                   | before 10K                  |
| Review, partial acceptance, and revalidation rules            | LOCKED semantics / B | 10L         | canonical decision table and stale-review tests             | before 10L                  |
| Context Revision creation and history immutability            | LOCKED / B           | 10M         | atomicity and history integrity tests                       | before 10M                  |
| PostgreSQL FTS configuration, ranking, and language           | PROVISIONAL / B      | 10N         | relevance benchmark and explain plans                       | before 10N                  |
| Context Pack selection and token/size budgets                 | PROVISIONAL / B      | 10O         | retrieval evaluation, truncation fixtures, injection tests  | before 10O                  |
| Context Delivery metadata retention                           | PROVISIONAL / B      | 10O         | privacy review and delivery-audit proof                     | before 10O                  |
| MCP tools/resources, schemas, and OAuth scopes                | PROVISIONAL / B      | 10P         | multi-host contract tests and least-capability review       | before 10P                  |
| MCP protocol-version header enforcement                       | PROOF-GATED / B      | 10P         | missing/invalid/supported header conformance tests          | before 10P exposure         |
| Developer Credential reveal-once and rotation                 | LOCKED direction / B | 10Q         | secret non-retrievability and revocation tests              | before 10Q                  |
| Integration/Project grant revocation propagation              | PROOF-GATED / B      | 10Q         | live and queued-action revocation tests                     | before 10Q                  |
| Rate limits and abuse thresholds                              | PROVISIONAL / C      | 10P + 10T   | load/abuse test evidence                                    | before 10T closes           |
| Export schema and completeness contract                       | PROVISIONAL / B      | 10S         | round-trip fixture and access-control review                | before 10S                  |
| Archive, delete grace, restore, and deletion saga             | LOCKED semantics / B | 10S         | race, retry, backup anti-resurrection tests                 | before 10S                  |
| Retention schedule                                            | PROVISIONAL / C      | HQ + 10S    | privacy/legal review and restore constraints                | before production data      |
| Object storage, KMS, region, and key rotation                 | PROVISIONAL / C      | 10T         | provider proof, restore drill, threat model                 | before 10T closes           |
| Analytics minimization                                        | PROVISIONAL / C      | HQ + 10T    | event inventory and privacy review                          | before production telemetry |
| RPO/RTO, alerts, runbooks, and support ownership              | PROVISIONAL / C      | 10T         | failure drills and alert delivery proof                     | before production readiness |
| Final provider/model selection                                | PROVISIONAL / D      | HQ          | quality/cost/latency evidence                               | may remain replaceable      |

## Ordered vertical workstreams

Each row inherits the entry rules. Screen IDs and exact responsive states remain governed by `docs/design/stage7-screen-traceability.json`; the screen groups below identify mandatory proof surfaces without renaming them.

| Vertical                                            | Prerequisites and gates                        | Required implementation proof                                                                                      | Downstream               |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 10A Domain kernel, schema, migrations               | A gates; ADRs 0001/0002                        | invariant tests, constraints, forward/backward migration proof; no UI                                              | all verticals            |
| 10B Actor, Audit Event, idempotency, Operation      | 10A; actor/audit/idempotency/operation B gates | attribution, duplicate request, crash/retry, immutable-event tests; Operations states                              | 10C–10T                  |
| 10C Identity, sessions, authorization, RLS          | 10A–B; WorkOS and RLS B gates                  | login/verified email/revocation/step-up, capability matrix, cross-tenant/pool tests; auth/error screens            | every protected vertical |
| 10D Workspace and Project                           | 10A–C; membership lifecycle gate               | tenant CRUD, membership/role denial, archive boundaries; workspace/project screens                                 | 10E onward               |
| 10E GitHub installation and Source identity         | 10A–D; GitHub identity/permission gates        | install/remove/rename/transfer/replay/out-of-order tests; connection/source screens                                | 10F                      |
| 10F Ingestion frontier and Evidence References      | 10A–E; ingestion/evidence gates                | selective refetch, no mirror, limits, duplicates, revoked/unavailable source; sync/evidence/provenance screens     | 10G–10O                  |
| 10G Authority Assignments                           | 10A–F; authority gate; first-party step-up     | precedence/effective-time/authz/audit tests; authority screens                                                     | 10H–10O                  |
| 10H Context Identities, Context Records, provenance | 10A–G; identity/currentness gate               | concurrency/current-vs-fresh/provenance tests; record/provenance screens                                           | 10I–10O                  |
| 10I Conflicts and Uncertainty                       | 10A–H; classification gate                     | deterministic fixtures, duplicate/conflict separation; conflict/uncertainty screens                                | 10J–10O                  |
| 10J Reconciliation                                  | 10A–I; model/parameter gates                   | constrained output, injection, timeout/fallback, evidence-link tests; reconciliation screens                       | 10K–10M                  |
| 10K Change Proposals and Proposal Items             | 10A–J; proposal concurrency gate               | candidate-only external submission, stale/competing proposal tests; proposal screens                               | 10L                      |
| 10L Review, revalidation, partial decisions         | 10A–K; review gate; first-party integrity      | approve/reject/partial/stale/source-changed tests; review/revalidation screens                                     | 10M                      |
| 10M Context Revisions and history                   | 10A–L; revision atomicity gate                 | accepted-items-only atomic revision and immutable history tests; history screens                                   | 10N–10O                  |
| 10N Search                                          | 10A–M; FTS gate                                | project isolation, ranking benchmark, stale-result labeling; search/empty/error screens                            | 10O–10P                  |
| 10O Context Packs and delivery metadata             | 10A–N; pack/delivery gates                     | ephemeral body, budget/truncation, conflict/provenance/injection tests; pack screens                               | 10P                      |
| 10P MCP and public API                              | 10A–O; OAuth/scope/schema/header/rate gates    | multi-host Streamable HTTP, issuer/audience/PKCE, grant/idempotency/header tests; developer/API states             | 10Q                      |
| 10Q Integrations and developer access               | 10A–P; credential/grant gates                  | reveal once, revoke/rotate, queued revocation, no impersonation; integration/credential screens                    | 10R                      |
| 10R Activity, audit, and Operations                 | 10A–Q; audit/operation gates                   | filtered activity, actor fidelity, sanitized failure, retry authorization; activity/audit/operations screens       | 10S–10T                  |
| 10S Export, archive, delete, restore                | 10A–R; export/deletion/retention gates         | complete authorized export, fencing, grace, restore race, backup anti-resurrection; archive/delete/pending screens | 10T                      |
| 10T Production hardening                            | all prior; all C gates                         | load/failure/security/accessibility/restore drills, observability, alerts, runbooks, RPO/RTO evidence              | release decision         |

## Failure ownership matrix

| Scenario                                | Canonical response                                                          | Owning proof vertical |
| --------------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| Stale client version                    | reject unsafe mutation; return current version/revalidation path            | 10B/10L               |
| Concurrent Source change                | preserve observed evidence; mark stale; revalidate before acceptance        | 10F/10L               |
| Pending proposal becomes stale          | block approval until item-level revalidation                                | 10K/10L               |
| Duplicate Evidence Reference            | deduplicate by canonical identity without collapsing distinct provenance    | 10F                   |
| Contradictory evidence                  | preserve both; create Conflict, never silently overwrite                    | 10I                   |
| Source unavailable                      | retain truthful last-observed metadata; mark freshness unavailable          | 10F/10H               |
| Source authorization revoked            | stop fetches, revoke access paths, fence queued work                        | 10C/10F/10Q           |
| GitHub installation removed             | disable affected Sources and refetch; do not invent deletion                | 10E/10F               |
| Repository renamed/transferred/replaced | resolve provider repository ID; never bind by display name alone            | 10E                   |
| Webhook replay/out of order             | authenticate, deduplicate, refetch authoritative state                      | 10E/10F               |
| Provider outage                         | bounded retry/backoff; expose degraded Operation without false freshness    | 10B/10E/10F           |
| Prompt injection in Source content      | treat as untrusted evidence, constrain model output, preserve provenance    | 10J/10O               |
| Malicious candidate evidence            | validate/grant-limit/quarantine; never auto-approve                         | 10K                   |
| False MCP `clientInfo`                  | retain as metadata only; authorize stable Integration/Credential identity   | 10P/10Q               |
| Project grant revoked mid-request       | recheck before side effect and fail closed                                  | 10C/10P/10Q           |
| Database pool connection reused         | transaction-local RLS context and reset proof prevent leakage               | 10C                   |
| Cross-Project identifier probing        | indistinguishable deny/not-found behavior and audited attempt               | 10C                   |
| Queued job executes after revocation    | reauthorize at execution and terminate denied Operation                     | 10B/10Q               |
| Duplicate side effect request           | same scoped idempotency key returns stable result                           | 10B                   |
| Delete pending with new writes          | fence writes and downstream jobs                                            | 10S                   |
| Restore races with delete               | serialized state machine; no partial resurrection                           | 10S                   |
| Deleted data in backups                 | expiry/tombstone process prevents restoration into active state             | 10S/10T               |
| Pack contains unresolved Conflict       | label/include according to canonical policy; never present as settled truth | 10O                   |
| Reconciliation partially succeeds       | retain item outcomes and retryable Operation state; no partial revision     | 10J/10L/10M           |
| Model timeout or invalid output         | bounded retry/fallback; no fabricated proposal                              | 10J                   |
| Worker crashes                          | leased/idempotent retry with visible Operation state                        | 10B                   |
| Migration fails                         | transactional/forward recovery plan; block readiness                        | 10A/10T               |
| Export fails midway                     | no misleading completion; retryable Operation and cleanup                   | 10S                   |
| Developer Credential compromised        | revoke/rotate, invalidate grants as applicable, audit response              | 10Q/10R               |
| Human session revoked                   | invalidate active access and require fresh authentication/step-up           | 10C                   |

## Completion boundary

This map makes Stage 10 executable in order, but it does not authorize Stage 10. HQ must reconcile Stage 9B, confirm all A gates are closed or explicitly assigned, and authorize 10A before product schema or product behavior begins.
